-- Snooker and console billing the way Indian venues run it.
--   1. Player choices: a rate can have one price for any number of players, or a price per choice
--      ("2 players ₹200/hr, 4 players ₹300/hr"; "2 controllers / 4 controllers"). Happy-hour and
--      weekend rates move the smallest choice; the others keep the same gap above it.
--   2. Frames: a timer mode billed per frame (snooker, pool). Staff tap + Frame as each one starts.
--   3. Who pays: the bill (or the khata) can move to another player, e.g. the losing side.
--   4. Khata limit: how much a player may owe. Over it, staff can't start them a new session.
-- Apply after 20261123000001_frames_mode.sql.

-- ---------------------------------------------------------------------------
-- 1. Player choices on a rate
-- ---------------------------------------------------------------------------
create function private.valid_player_choices(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb;
  v_seen int[] := '{}';
  v_n numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then
    return false;
  end if;
  for c in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'players') is distinct from 'number'
       or jsonb_typeof(c -> 'per_hour') is distinct from 'number'
       or coalesce(jsonb_typeof(c -> 'per_frame'), 'null') not in ('number', 'null') then
      return false;
    end if;
    v_n := (c ->> 'players')::numeric;
    if v_n <> trunc(v_n) or v_n not between 1 and 16 or v_n::int = any (v_seen) then
      return false;
    end if;
    v_seen := v_seen || v_n::int;
    if (c ->> 'per_hour')::numeric not between 0 and 100000
       or coalesce((c ->> 'per_frame')::numeric, 0) not between 0 and 100000 then
      return false;
    end if;
  end loop;
  return true;
end $$;

alter table public.rate_plans
  -- [] = one price for any number of players. Otherwise [{players, per_hour, per_frame?}].
  add column player_choices jsonb not null default '[]'
    constraint rate_plans_player_choices_check check (private.valid_player_choices(player_choices)),
  -- Price per frame; null = this rate can't be billed by frame.
  add column per_frame numeric(10, 2) check (per_frame is null or per_frame between 0 and 100000);

-- Keeps a rate with choices consistent: sorted, and its base price = the smallest choice.
create function private.normalize_rate_plan() returns trigger
language plpgsql set search_path = '' as $$
declare
  c0 jsonb;
begin
  if jsonb_array_length(new.player_choices) = 0 then
    return new;
  end if;
  select jsonb_agg(c order by (c ->> 'players')::int) into new.player_choices
    from jsonb_array_elements(new.player_choices) c;
  c0 := new.player_choices -> 0;
  new.per_hour := (c0 ->> 'per_hour')::numeric;
  new.included_players := (c0 ->> 'players')::int;
  new.extra_player_per_hour := 0;
  if new.per_frame is not null then
    if exists (select 1 from jsonb_array_elements(new.player_choices) c
                where jsonb_typeof(c -> 'per_frame') is distinct from 'number') then
      raise exception 'Give every choice a frame price, or turn frame billing off.' using errcode = '22023';
    end if;
    new.per_frame := (c0 ->> 'per_frame')::numeric;
  else
    select jsonb_agg(c - 'per_frame' order by (c ->> 'players')::int) into new.player_choices
      from jsonb_array_elements(new.player_choices) c;
  end if;
  return new;
end $$;

create trigger rate_plans_normalize before insert or update on public.rate_plans
  for each row execute function private.normalize_rate_plan();

-- Rates that charged "per extra player" become choices with the same prices, so no bill changes.
update public.rate_plans rp
   set player_choices = (
     select jsonb_agg(jsonb_build_object(
              'players', n,
              'per_hour', rp.per_hour + (n - rp.included_players) * rp.extra_player_per_hour) order by n)
       from generate_series(
              rp.included_players,
              least(16, greatest(rp.included_players + 3, coalesce(
                (select max(s.players) from public.sessions s where s.rate_plan_id = rp.id and s.status <> 'ended'), 0)))
            ) n)
 where rp.extra_player_per_hour > 0 and rp.station_type <> 'pc';

-- The choice that applies to a player count: the largest at or below it, else the smallest.
create function private.player_choice(p_choices jsonb, p_players int) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(
    (select c from jsonb_array_elements(p_choices) c
      where (c ->> 'players')::int <= p_players
      order by (c ->> 'players')::int desc limit 1),
    (select c from jsonb_array_elements(p_choices) c order by (c ->> 'players')::int limit 1));
$$;

-- What a player count adds on top of the base price, per hour ('hour') or per frame ('frame').
create function private.player_extra(p public.rate_plans, p_players int, p_unit text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb;
begin
  if jsonb_array_length(coalesce(p.player_choices, '[]')) = 0 then
    if p_unit = 'frame' then
      return 0;
    end if;
    -- Older rates: "extra player per hour" over the included count.
    return greatest(p_players - p.included_players, 0) * p.extra_player_per_hour;
  end if;
  c := private.player_choice(p.player_choices, p_players);
  if p_unit = 'frame' then
    return coalesce((c ->> 'per_frame')::numeric, p.per_frame, 0) - coalesce(p.per_frame, 0);
  end if;
  return (c ->> 'per_hour')::numeric - p.per_hour;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Frames
-- ---------------------------------------------------------------------------
alter table public.sessions add column frames int not null default 0 check (frames between 0 and 999);

-- Same as before, plus frames and player choices. Frames: frames × frame price for the choice.
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
  v_played_total numeric;
  v_booked_total numeric;
  v_frame_price numeric;
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

  -- Billed by frame: the clock is only for information.
  if s.mode::text = 'frames' then
    v_frame_price := greatest(coalesce(p.per_frame, 0) + private.player_extra(p, s.players, 'frame'), 0);
    return jsonb_build_object(
      'active_seconds', floor(v_active_sec)::int,
      'billable_minutes', 0,
      'frames', s.frames,
      'frame_price', v_frame_price,
      'prepaid_amount', 0,
      'time_amount', round(s.frames * v_frame_price, 2),
      'extra_amount', 0,
      'early', false,
      'total', round(s.frames * v_frame_price)
    );
  end if;

  select coalesce(array_agg(private.rate_at(p.id, m, v_tz) order by m), '{}')
    into v_rates
    from generate_series(s.started_at, v_end - interval '1 microsecond', interval '1 minute') as m
   where not exists (
     select 1 from public.session_pauses ps
      where ps.session_id = s.id and m >= ps.started_at and m < coalesce(ps.ended_at, v_end)
   );
  v_len := coalesce(array_length(v_rates, 1), 0);
  v_extra := private.player_extra(p, s.players, 'hour') / 60.0;

  -- Early end, pay for what was played (only if nothing was collected up front).
  if s.mode = 'prepaid' and v_policy = 'played' and s.billed_amount = 0
     and v_active_sec < s.prepaid_minutes * 60 then
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
    v_played_total := greatest(v_time + v_extra * v_billable, 0);
    v_booked_total := greatest(s.prepaid_amount + v_extra * s.prepaid_minutes, 0);

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

  v_extra := v_extra * v_player_minutes;

  return jsonb_build_object(
    'active_seconds', floor(v_active_sec)::int,
    'billable_minutes', v_billable,
    'prepaid_amount', v_base,
    'time_amount', round(v_time, 2),
    'extra_amount', round(v_extra, 2),
    'early', false,
    'total', greatest(round(v_base + v_time + v_extra), 0)
  );
end $$;

revoke execute on function private.session_charge(uuid, timestamptz) from public, anon, authenticated;

-- + Frame / − Frame. A change, not a total, so two taps from two screens both count.
create function public.change_session_frames(p_session_id uuid, p_delta int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  v_frames int;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'This session has ended.' using errcode = '22023';
  end if;
  if s.mode::text <> 'frames' then
    raise exception 'This session isn''t billed by frame.' using errcode = '22023';
  end if;
  if p_delta is null or p_delta not in (-1, 1) then
    raise exception 'Add or remove one frame at a time.' using errcode = '22023';
  end if;
  v_frames := s.frames + p_delta;
  if v_frames < 0 or v_frames > 999 then
    raise exception 'Frames must be between 0 and 999.' using errcode = '22023';
  end if;
  update public.sessions set frames = v_frames where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'frames', jsonb_build_object('from', s.frames, 'to', v_frames));
  return v_frames;
end $$;

revoke execute on function public.change_session_frames(uuid, int) from public, anon;
grant execute on function public.change_session_frames(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Khata limit (used by start_session below)
-- ---------------------------------------------------------------------------
alter table public.branch_settings
  -- Most a player may owe before staff can't start them a new session. null = no limit.
  add column credit_limit numeric(10, 2) check (credit_limit is null or credit_limit between 0 and 1000000);
alter table public.customers
  -- This player's own limit; null = the venue's.
  add column credit_limit numeric(10, 2) check (credit_limit is null or credit_limit between 0 and 1000000);
grant select (credit_limit) on public.customers to authenticated;

create function private.customer_owed(p_customer_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(outstanding), 0) from public.sessions
   where customer_id = p_customer_id and status = 'ended' and not written_off and outstanding > 0;
$$;

-- Staff can't start a session for a player who owes more than their limit. The owner can.
create function private.check_credit(p_customer public.customers, p_branch_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit numeric;
  v_owed numeric;
begin
  v_limit := coalesce(p_customer.credit_limit,
    (select credit_limit from public.branch_settings where branch_id = p_branch_id));
  if v_limit is null or private.has_org_role(p_customer.org_id, array['owner']::public.member_role[]) then
    return;
  end if;
  v_owed := private.customer_owed(p_customer.id);
  if v_owed > v_limit then
    raise exception '% owes ₹% (khata limit ₹%). Collect the dues first, or ask the owner.',
      p_customer.name, round(v_owed), round(v_limit) using errcode = '22023';
  end if;
end $$;

create function public.set_player_credit_limit(p_customer_id uuid, p_limit numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.customers where id = p_customer_id;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  if p_limit is not null and p_limit not between 0 and 1000000 then
    raise exception 'Enter a limit between ₹0 and ₹10,00,000.' using errcode = '22023';
  end if;
  update public.customers set credit_limit = p_limit where id = p_customer_id;
end $$;

revoke execute on function public.set_player_credit_limit(uuid, numeric) from public, anon;
grant execute on function public.set_player_credit_limit(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Start: player choices, frames, khata limit
-- ---------------------------------------------------------------------------
create function private.assert_player_choice(p public.rate_plans, p_players int) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_players is null or p_players not between 1 and 16 then
    raise exception 'Players must be between 1 and 16.' using errcode = '22023';
  end if;
  if jsonb_array_length(p.player_choices) > 0
     and not exists (select 1 from jsonb_array_elements(p.player_choices) c where (c ->> 'players')::int = p_players) then
    raise exception 'Pick one of the choices: %.',
      (select string_agg(c ->> 'players', ', ' order by (c ->> 'players')::int) from jsonb_array_elements(p.player_choices) c)
      using errcode = '22023';
  end if;
end $$;

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
  v_players int := coalesce(p_players, 1);
  v_collect numeric;
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
  if p_mode::text = 'frames' and plan.per_frame is null then
    raise exception 'No frame price for %. Add one under Pricing.', st.name using errcode = '22023';
  end if;
  perform private.assert_player_choice(plan, v_players);

  cu := private.get_or_create_customer(st.org_id, p_phone, p_name);
  perform private.check_credit(cu, st.branch_id);

  if p_mode = 'prepaid' then
    select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);
    v_minutes := q.minutes;
    v_price := q.price;
    v_label := q.label;
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_id, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, frames, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, p_mode, cu.id, cu.name, cu.phone, v_players,
      case when p_mode = 'prepaid' then now() + make_interval(mins => v_minutes) end,
      v_minutes, v_price,
      -- Frames: the first frame starts with the session.
      case when p_mode::text = 'frames' then 1 else 0 end,
      auth.uid())
    returning id into v_session_id;
  exception when unique_violation then
    raise exception '% already has a running session.', st.name using errcode = '23505';
  end;

  -- Optional: collect the booked price up front, with what the player choice adds for that time
  -- (the same amount the session charges at the end, so nothing is left to pay).
  v_collect := greatest(round(v_price + private.player_extra(plan, v_players, 'hour') * v_minutes / 60.0), 0);
  if v_collect > 0 and jsonb_array_length(coalesce(p_payments, '[]')) > 0 then
    perform private.create_invoice(
      st.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', v_session_id,
        'description', st.name || ' · ' || v_label,
        'minutes', v_minutes,
        'amount', v_collect,
        'gst_rate', private.line_gst_rate(st.branch_id, plan.id))),
      0, p_payments, cu.name, cu.phone, cu.id);
  end if;

  perform private.log_session_event(st.org_id, v_session_id, 'start',
    jsonb_build_object('mode', p_mode, 'minutes', v_minutes, 'price', v_price, 'customer_id', cu.id, 'players', v_players));
  return v_session_id;
end $$;

-- Same as before; collecting now also takes what the player choice adds for the added time.
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
  v_collect numeric;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Session has ended.' using errcode = '22023';
  end if;
  if s.mode <> 'prepaid' then
    raise exception 'Only fixed-time sessions take extra time.' using errcode = '22023';
  end if;

  select * into st from public.stations where id = s.station_id;
  select * into plan from public.rate_plans where id = s.rate_plan_id;
  select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);

  update public.sessions
     set prepaid_minutes = prepaid_minutes + q.minutes,
         prepaid_amount = prepaid_amount + q.price,
         planned_end_at = planned_end_at + make_interval(mins => q.minutes)
   where id = s.id;

  v_collect := greatest(round(q.price + private.player_extra(plan, s.players, 'hour') * q.minutes / 60.0), 0);
  if v_collect > 0 and jsonb_array_length(coalesce(p_payments, '[]')) > 0 then
    perform private.create_invoice(
      s.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', s.id,
        'description', st.name || ' · extend ' || q.label,
        'minutes', q.minutes,
        'amount', v_collect,
        'gst_rate', private.line_gst_rate(s.branch_id, plan.id))),
      0, p_payments, s.customer_name, s.customer_phone, s.customer_id);
  end if;

  perform private.log_session_event(s.org_id, s.id, 'extend', jsonb_build_object('minutes', q.minutes, 'price', q.price));
end $$;

create or replace function public.set_session_players(p_session_id uuid, p_players int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  plan public.rate_plans;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'This session has ended.' using errcode = '22023';
  end if;
  select * into plan from public.rate_plans where id = s.rate_plan_id;
  perform private.assert_player_choice(plan, p_players);
  if p_players = s.players then
    return;
  end if;
  update public.sessions set players = p_players where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'players',
    jsonb_build_object('from', s.players, 'to', p_players));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Who pays
-- ---------------------------------------------------------------------------
-- Moves unpaid sessions (or a live one) to another player: their wallet pays and their khata owes.
create function public.set_session_payer(p_session_ids uuid[], p_phone text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_count int;
  cu public.customers;
begin
  select min(org_id::text)::uuid, count(distinct org_id) into v_org, v_count
    from public.sessions where id = any (p_session_ids);
  if v_count <> 1 then
    raise exception 'Pick sessions from one venue.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);

  perform 1 from public.sessions where id = any (p_session_ids) for update;
  if exists (select 1 from public.sessions where id = any (p_session_ids)
              and (written_off or (status = 'ended' and outstanding <= 0))) then
    raise exception 'These sessions are already settled.' using errcode = '22023';
  end if;

  cu := private.get_or_create_customer(v_org, p_phone, p_name);
  -- Logged first, while the rows still carry the previous player's name.
  perform private.log_session_event(v_org, s.id, 'payer',
            jsonb_build_object('from', s.customer_name, 'to', cu.name, 'customer_id', cu.id))
     from public.sessions s where s.id = any (p_session_ids);
  update public.sessions
     set customer_id = cu.id, customer_name = cu.name, customer_phone = cu.phone
   where id = any (p_session_ids);
  return cu.id;
end $$;

revoke execute on function public.set_session_payer(uuid[], text, text) from public, anon;
grant execute on function public.set_session_payer(uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Checkout: bill lines for frames ("SNOOKER-1 · 5 frames")
-- ---------------------------------------------------------------------------
create or replace function public.checkout(
  p_session_ids uuid[],
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null,
  p_discount_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_org uuid;
  v_count int;
  v_lines jsonb;
  v_items jsonb;
  v_customer uuid;
  v_invoice uuid;
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
           'session_id', si.session_id,
           'description', si.name || case when si.quantity > 1 then ' × ' || si.quantity else '' end,
           'amount', si.price * si.quantity,
           'gst_rate', (select gst_rate from public.branch_settings where branch_id = v_branch)))
    into v_items
    from public.session_items si
   where si.session_id = any (p_session_ids) and si.invoice_id is null;

  select jsonb_agg(line order by started_at)
    into v_lines
    from (
      select s.started_at, jsonb_build_object(
               'session_id', s.id,
               'description', st.name || ' · ' ||
                 case
                   when s.mode::text = 'frames' then
                     s.frames || case when s.frames = 1 then ' frame' else ' frames' end
                   when s.mode = 'open' then 'open time ' || (ch ->> 'billable_minutes') || ' min'
                   when (ch ->> 'early')::boolean then
                     'stopped early, ' || (ch ->> 'billable_minutes') || ' of ' || s.prepaid_minutes || ' min'
                   when s.billed_amount > 0 then 'extra time ' || (ch ->> 'billable_minutes') || ' min'
                   when (ch ->> 'billable_minutes')::int > 0 then
                     s.prepaid_minutes || ' min booked + ' || (ch ->> 'billable_minutes') || ' min extra'
                   else s.prepaid_minutes || ' min booked'
                 end
                 || case when s.players > 1 and s.mode::text <> 'frames' and st.type <> 'pc'
                      then ' · ' || s.players || case when st.type in ('ps5', 'xbox') then ' controllers' else ' players' end
                      else '' end,
               'minutes', case
                   when s.mode::text = 'frames' then null
                   when s.mode = 'prepaid' and not (ch ->> 'early')::boolean and s.billed_amount = 0
                     then s.prepaid_minutes + (ch ->> 'billable_minutes')::int
                   else (ch ->> 'billable_minutes')::int
                 end,
               'amount', greatest(0, coalesce(s.charge_amount, 0) - s.billed_amount - coalesce(
                   (select sum(si.price * si.quantity) from public.session_items si
                     where si.session_id = s.id and si.invoice_id is null), 0)),
               'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id)) as line
        from public.sessions s
        join public.stations st on st.id = s.station_id
        cross join lateral private.session_charge(s.id) ch
       where s.id = any (p_session_ids)
    ) t
   where (line ->> 'amount')::numeric > 0;

  v_lines := coalesce(v_lines, '[]'::jsonb) || coalesce(v_items, '[]'::jsonb);
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'These sessions are already paid.' using errcode = '22023';
  end if;

  select customer_id into v_customer from public.sessions
   where id = any (p_session_ids) and customer_id is not null
   order by started_at limit 1;

  v_invoice := private.create_invoice(v_branch, v_lines, p_discount, p_payments,
    coalesce(p_customer_name, (select customer_name from public.sessions where id = p_session_ids[1])),
    coalesce(p_customer_phone, (select customer_phone from public.sessions where id = p_session_ids[1])),
    v_customer, p_discount_reason);

  update public.session_items set invoice_id = v_invoice
   where session_id = any (p_session_ids) and invoice_id is null;

  return v_invoice;
end $$;
