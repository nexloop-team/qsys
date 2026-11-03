-- 1. Everything is pay-at-end. "prepaid" now means *fixed time* (timer counts down);
--    collecting money at the start is optional. The enum value keeps its name.
-- 2. Floor map: stations get a position on the venue layout.
-- 3. Richer reports.

-- ---------------------------------------------------------------------------
-- Floor map layout (grid cells on a 48 × 32 canvas)
-- ---------------------------------------------------------------------------
alter table public.stations
  add column layout_x smallint check (layout_x between 0 and 200),
  add column layout_y smallint check (layout_y between 0 and 200),
  add column layout_rot smallint not null default 0 check (layout_rot in (0, 90));

-- Saves many positions at once: [{id, x, y, rot}]. Owners and managers only.
create function public.save_station_layout(p_branch_id uuid, p_layout jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  perform private.assert_member(v_org, array['owner', 'manager']::public.member_role[]);

  update public.stations st
     set layout_x = (x ->> 'x')::smallint,
         layout_y = (x ->> 'y')::smallint,
         layout_rot = coalesce((x ->> 'rot')::smallint, 0)
    from jsonb_array_elements(p_layout) x
   where st.id = (x ->> 'id')::uuid and st.branch_id = p_branch_id;
end $$;

-- ---------------------------------------------------------------------------
-- Pay at end: start/extend no longer require a payment for fixed time.
-- ---------------------------------------------------------------------------
create or replace function public.start_session(
  p_station_id uuid,
  p_mode public.session_mode,
  p_phone text,
  p_name text default null,
  p_players int default 1,
  p_package_id uuid default null,
  p_minutes int default null,
  p_payments jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  plan public.rate_plans;
  bs public.branch_settings;
  cu public.customers;
  q record;
  v_minutes int := 0;
  v_price numeric := 0;
  v_label text;
  v_session_id uuid;
begin
  select * into st from public.stations where id = p_station_id;
  perform private.assert_member(st.org_id);
  if st.status <> 'active' then
    raise exception '% is in %.', st.name, st.status using errcode = '22023';
  end if;

  plan := private.resolve_rate_plan(st.id);
  if plan.id is null then
    raise exception 'No price is set for %. Add one under Pricing.', st.name using errcode = '22023';
  end if;

  select * into bs from public.branch_settings where branch_id = st.branch_id;
  if not (bs.allowed_modes_by_type -> st.type::text) ? p_mode::text then
    raise exception 'That timer mode is turned off for this station type.' using errcode = '22023';
  end if;

  cu := private.get_or_create_customer(st.org_id, p_phone, p_name);

  if p_mode = 'prepaid' then
    select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);
    v_minutes := q.minutes;
    v_price := q.price;
    v_label := q.label;
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_id, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, p_mode, cu.id, cu.name, cu.phone, coalesce(p_players, 1),
      case when p_mode = 'prepaid' then now() + make_interval(mins => v_minutes) end,
      v_minutes, v_price, auth.uid())
    returning id into v_session_id;
  exception when unique_violation then
    raise exception '% already has a running session.', st.name using errcode = '23505';
  end;

  -- Optional: collect the booked price up front.
  if v_price > 0 and jsonb_array_length(coalesce(p_payments, '[]')) > 0 then
    perform private.create_invoice(
      st.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', v_session_id,
        'description', st.name || ' · ' || v_label,
        'minutes', v_minutes,
        'amount', v_price,
        'gst_rate', private.line_gst_rate(st.branch_id, plan.id))),
      0, p_payments, cu.name, cu.phone);
  end if;

  perform private.log_session_event(st.org_id, v_session_id, 'start',
    jsonb_build_object('mode', p_mode, 'minutes', v_minutes, 'price', v_price, 'customer_id', cu.id));
  return v_session_id;
end $$;

create or replace function public.extend_session(
  p_session_id uuid,
  p_package_id uuid default null,
  p_minutes int default null,
  p_payments jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  st public.stations;
  plan public.rate_plans;
  q record;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Session has ended.' using errcode = '22023';
  end if;
  if s.mode <> 'prepaid' then
    raise exception 'Open-time sessions run until you end them.' using errcode = '22023';
  end if;

  select * into st from public.stations where id = s.station_id;
  select * into plan from public.rate_plans where id = s.rate_plan_id;
  select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);

  update public.sessions
     set prepaid_minutes = prepaid_minutes + q.minutes,
         prepaid_amount = prepaid_amount + q.price,
         planned_end_at = planned_end_at + make_interval(mins => q.minutes)
   where id = s.id;

  if q.price > 0 and jsonb_array_length(coalesce(p_payments, '[]')) > 0 then
    perform private.create_invoice(
      s.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', s.id,
        'description', st.name || ' · extend ' || q.label,
        'minutes', q.minutes,
        'amount', q.price,
        'gst_rate', private.line_gst_rate(s.branch_id, plan.id))),
      0, p_payments, s.customer_name, s.customer_phone);
  end if;

  perform private.log_session_event(s.org_id, s.id, 'extend', jsonb_build_object('minutes', q.minutes, 'price', q.price));
end $$;

-- Checkout line text now reflects pay-at-end fixed time.
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
               when s.billed_amount > 0 then 'extra time ' || (ch ->> 'billable_minutes') || ' min'
               when (ch ->> 'billable_minutes')::int > 0 then
                 s.prepaid_minutes || ' min booked + ' || (ch ->> 'billable_minutes') || ' min extra'
               else s.prepaid_minutes || ' min booked'
             end,
           'minutes', s.prepaid_minutes * (s.mode = 'prepaid' and s.billed_amount = 0)::int + (ch ->> 'billable_minutes')::int,
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

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Played seconds of a session (wall time minus pauses), without pricing work.
create function private.session_active_seconds(p_session_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0,
           extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))
           - coalesce((select sum(extract(epoch from (coalesce(p.ended_at, s.ended_at, now()) - p.started_at)))
                         from public.session_pauses p where p.session_id = s.id), 0))
    from public.sessions s where s.id = p_session_id;
$$;

create function public.report_insights(p_branch_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_tz text;
  v_open time;
  v_close time;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_days int := (p_to - p_from) + 1;
  v_open_minutes numeric; -- venue open minutes per day
begin
  select b.org_id, b.timezone, b.opening_time, b.closing_time into v_org, v_tz, v_open, v_close
    from public.branches b where b.id = p_branch_id;
  perform private.assert_member(v_org, array['owner', 'manager']::public.member_role[]);

  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  -- Opening hours define 100% utilisation; without them, assume 24h. Handles closing past midnight.
  v_open_minutes := case
    when v_open is null or v_close is null then 1440
    when v_close > v_open then extract(epoch from (v_close - v_open)) / 60
    else 1440 - extract(epoch from (v_open - v_close)) / 60
  end;

  return (
    with s as (
      select s.*, st.type as station_type, st.name as station_name,
             private.session_active_seconds(s.id) / 60.0 as played_min
        from public.sessions s
        join public.stations st on st.id = s.station_id
       where s.branch_id = p_branch_id and s.started_at >= v_start and s.started_at < v_end
    ),
    inv as (
      select * from public.invoices where branch_id = p_branch_id and created_at >= v_start and created_at < v_end
    ),
    prev as (
      select
        (select coalesce(sum(total), 0) from public.invoices
          where branch_id = p_branch_id and created_at >= v_prev_start and created_at < v_start) as revenue,
        (select count(*) from public.sessions
          where branch_id = p_branch_id and started_at >= v_prev_start and started_at < v_start) as sessions
    ),
    station_counts as (
      select type, count(*) as n from public.stations
       where branch_id = p_branch_id and status = 'active' group by type
    )
    select jsonb_build_object(
      'previous', (select jsonb_build_object('revenue', revenue, 'sessions', sessions) from prev),
      'avg_session_minutes', (select round(avg(played_min)) from s where s.status = 'ended'),
      'avg_bill', (select round(avg(total)) from inv),
      'discounts', (select coalesce(sum(discount), 0) from inv),
      'played_minutes', (select coalesce(round(sum(played_min)), 0) from s),
      'utilisation_by_type', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'type', sc.type,
                 'stations', sc.n,
                 'minutes', coalesce(round(x.m), 0),
                 'pct', round(100 * coalesce(x.m, 0) / (sc.n * v_open_minutes * v_days), 1))
               order by sc.type)
          from station_counts sc
          left join (select station_type, sum(played_min) as m from s group by station_type) x
            on x.station_type = sc.type), '[]'),
      'top_stations', coalesce((
        select jsonb_agg(t order by t.revenue desc, t.minutes desc)
          from (select station_name as name, station_type as type, count(*) as sessions,
                       round(sum(played_min)) as minutes,
                       coalesce(sum(coalesce(charge_amount, 0)), 0) as revenue,
                       round(100 * sum(played_min) / (v_open_minutes * v_days), 1) as pct
                  from s group by station_name, station_type
                 order by 5 desc, 4 desc limit 10) t), '[]'),
      'top_players', coalesce((
        select jsonb_agg(t order by t.spent desc)
          from (select c.id, c.name, c.phone, count(*) as visits,
                       coalesce(sum(coalesce(s.charge_amount, 0)), 0) as spent,
                       round(sum(s.played_min)) as minutes
                  from s join public.customers c on c.id = s.customer_id
                 group by c.id order by 5 desc limit 10) t), '[]'),
      'players', (
        select jsonb_build_object(
          'total', count(distinct s.customer_id),
          'new', count(distinct s.customer_id) filter (where not exists (
            select 1 from public.sessions o
             where o.customer_id = s.customer_id and o.started_at < v_start)))
          from s where s.customer_id is not null),
      'heatmap', coalesce((
        select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'sessions', n))
          from (select extract(dow from started_at at time zone v_tz)::int as dow,
                       extract(hour from started_at at time zone v_tz)::int as hour,
                       count(*) as n
                  from s group by 1, 2) h), '[]'),
      'by_mode', coalesce((
        select jsonb_object_agg(mode, n) from (select mode, count(*) as n from s group by mode) m), '{}')
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.save_station_layout(uuid, jsonb),
  public.report_insights(uuid, date, date)
from public, anon;
grant execute on function
  public.save_station_layout(uuid, jsonb),
  public.report_insights(uuid, date, date)
to authenticated;
