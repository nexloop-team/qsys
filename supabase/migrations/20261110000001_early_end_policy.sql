-- Fixed time ended early (booked 2 h, played 1 h): owner chooses what to charge.
--   full   = the booking price (default)
--   played = the played minutes at the hourly rate (minimum + rounding apply), never more than the booking.
-- A booking paid up front stays final either way, so no refunds are ever owed.

alter table public.branch_settings
  add column early_end_policy text not null default 'full' check (early_end_policy in ('full', 'played'));

-- Same as before, plus the early-end rule. Returns 'early' = true when it applied.
create or replace function private.session_charge(p_session_id uuid, p_at timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sessions;
  p public.rate_plans;
  v_tz text;
  v_grace int;
  v_policy text;
  v_end timestamptz;
  v_active_sec numeric;
  v_rates numeric[];
  v_len int;
  v_skip int := 0;
  v_billable int := 0;
  v_player_minutes int := 0;
  v_base numeric := 0;
  v_time numeric := 0;
  v_extra numeric := 0;
  v_rate numeric;
  v_over_sec numeric;
  v_early boolean := false;
  v_played_total numeric;
  v_booked_total numeric;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then
    return null;
  end if;
  select * into p from public.rate_plans where id = s.rate_plan_id;
  select b.timezone, bs.overtime_grace_minutes, bs.early_end_policy into v_tz, v_grace, v_policy
    from public.branches b
    join public.branch_settings bs on bs.branch_id = b.id
   where b.id = s.branch_id;

  v_end := coalesce(s.ended_at, p_at, now());

  select extract(epoch from (v_end - s.started_at))
         - coalesce(sum(greatest(0, extract(epoch from (
             least(coalesce(ps.ended_at, v_end), v_end) - greatest(ps.started_at, s.started_at))))), 0)
    into v_active_sec
    from public.session_pauses ps
   where ps.session_id = s.id;
  v_active_sec := greatest(v_active_sec, 0);

  select coalesce(array_agg(private.rate_at(p.id, m, v_tz) order by m), '{}')
    into v_rates
    from generate_series(s.started_at, v_end - interval '1 microsecond', interval '1 minute') as m
   where not exists (
     select 1 from public.session_pauses ps
      where ps.session_id = s.id and m >= ps.started_at and m < coalesce(ps.ended_at, v_end)
   );
  v_len := coalesce(array_length(v_rates, 1), 0);

  -- Early end, pay for what was played (only if nothing was collected up front).
  if s.mode = 'prepaid' and v_policy = 'played' and s.billed_amount = 0
     and v_active_sec < s.prepaid_minutes * 60 then
    v_early := true;
    if v_active_sec > 0 then
      v_billable := greatest(p.min_minutes, (ceil(v_active_sec / 60.0 / p.rounding_minutes) * p.rounding_minutes)::int);
    end if;
    v_rate := coalesce(v_rates[v_len], p.per_hour);
    for i in 1 .. v_billable loop
      if i <= v_len then
        v_rate := v_rates[i];
      end if;
      v_time := v_time + v_rate / 60.0;
    end loop;
    v_extra := greatest(s.players - p.included_players, 0) * p.extra_player_per_hour / 60.0;
    v_played_total := v_time + v_extra * v_billable;
    v_booked_total := s.prepaid_amount + v_extra * s.prepaid_minutes;

    return jsonb_build_object(
      'active_seconds', floor(v_active_sec)::int,
      'billable_minutes', v_billable,
      'prepaid_amount', 0,
      'time_amount', round(least(v_played_total, v_booked_total), 2),
      'extra_amount', 0,
      'early', true,
      'total', round(least(v_played_total, v_booked_total))
    );
  end if;

  if s.mode = 'prepaid' then
    v_base := s.prepaid_amount;
    v_over_sec := v_active_sec - s.prepaid_minutes * 60;
    if v_over_sec > v_grace * 60 then
      v_billable := (ceil(v_over_sec / 60.0 / p.rounding_minutes) * p.rounding_minutes)::int;
      v_skip := s.prepaid_minutes;
    end if;
    v_player_minutes := s.prepaid_minutes + v_billable;
  elsif v_active_sec > 0 then
    v_billable := greatest(p.min_minutes, (ceil(v_active_sec / 60.0 / p.rounding_minutes) * p.rounding_minutes)::int);
    v_player_minutes := v_billable;
  end if;

  v_rate := coalesce(v_rates[v_len], p.per_hour);
  for i in 1 .. v_billable loop
    if v_skip + i <= v_len then
      v_rate := v_rates[v_skip + i];
    end if;
    v_time := v_time + v_rate / 60.0;
  end loop;

  v_extra := greatest(s.players - p.included_players, 0) * p.extra_player_per_hour / 60.0 * v_player_minutes;

  return jsonb_build_object(
    'active_seconds', floor(v_active_sec)::int,
    'billable_minutes', v_billable,
    'prepaid_amount', v_base,
    'time_amount', round(v_time, 2),
    'extra_amount', round(v_extra, 2),
    'early', v_early,
    'total', round(v_base + v_time + v_extra)
  );
end $$;

-- Bill line text for an early stop: "PC-03 · stopped early, 62 min played".
create or replace function public.checkout(
  p_session_ids uuid[],
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_org uuid;
  v_count int;
  v_lines jsonb;
begin
  select min(branch_id::text)::uuid, min(org_id::text)::uuid, count(distinct branch_id)
    into v_branch, v_org, v_count
    from public.sessions where id = any (p_session_ids);
  if v_count <> 1 then
    raise exception 'Pick sessions from one branch.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);

  perform 1 from public.sessions where id = any (p_session_ids) for update;
  if exists (select 1 from public.sessions where id = any (p_session_ids) and (status <> 'ended' or written_off)) then
    raise exception 'End the sessions before billing them.' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
           'session_id', s.id,
           'description', st.name || ' · ' ||
             case
               when s.mode = 'open' then 'open time ' || (ch ->> 'billable_minutes') || ' min'
               when (ch ->> 'early')::boolean then
                 'stopped early, ' || (ch ->> 'billable_minutes') || ' of ' || s.prepaid_minutes || ' min'
               when s.billed_amount > 0 then 'extra time ' || (ch ->> 'billable_minutes') || ' min'
               when (ch ->> 'billable_minutes')::int > 0 then
                 s.prepaid_minutes || ' min booked + ' || (ch ->> 'billable_minutes') || ' min extra'
               else s.prepaid_minutes || ' min booked'
             end,
           'minutes', case
               when s.mode = 'prepaid' and not (ch ->> 'early')::boolean and s.billed_amount = 0
                 then s.prepaid_minutes + (ch ->> 'billable_minutes')::int
               else (ch ->> 'billable_minutes')::int
             end,
           'amount', s.charge_amount - s.billed_amount,
           'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id))
         order by s.started_at)
    into v_lines
    from public.sessions s
    join public.stations st on st.id = s.station_id
    cross join lateral private.session_charge(s.id) ch
   where s.id = any (p_session_ids) and s.charge_amount > s.billed_amount;

  if v_lines is null then
    raise exception 'These sessions are already paid.' using errcode = '22023';
  end if;

  return private.create_invoice(v_branch, v_lines, p_discount, p_payments,
    coalesce(p_customer_name, (select customer_name from public.sessions where id = p_session_ids[1])),
    coalesce(p_customer_phone, (select customer_phone from public.sessions where id = p_session_ids[1])));
end $$;

revoke execute on function private.session_charge(uuid, timestamptz) from public, anon, authenticated;
