-- Billing the way venues really work.
--   1. No pay later. Every bill is paid at the counter, so the "most a player can owe" limit goes
--      and nothing blocks a new session. (A session that has ended still waits under "To collect"
--      on the Floor until it's paid or written off.)
--   2. Each kind of station is charged per person or per station (a setting, under Billing).
--      Per person: the station's price × the people playing, happy-hour and weekend rates included.
--      Default: consoles per person, tables and PCs per station. "Player choices" on a rate go.
--   3. Online booking is off for now. Staff still add phone bookings under Bookings.
-- Apply after 20261130000001_tamper_vouchers_shifts.sql.

-- 1. No pay-later limit -------------------------------------------------------------------
create or replace function private.check_credit(p_customer public.customers, p_branch_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  return;
end $$;

update public.branch_settings set credit_limit = null where credit_limit is not null;
update public.customers set credit_limit = null where credit_limit is not null;

-- 2. Per person or per station ---------------------------------------------------------------
alter table public.branch_settings
  add column per_person_types public.station_type[] not null default '{ps5,xbox}';

-- How many people a session is charged for: its player count on a per-person station type, else 1.
create function private.charge_people(p_branch_id uuid, p_type public.station_type, p_players int) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when p_type = any (bs.per_person_types) then greatest(coalesce(p_players, 1), 1) else 1 end
       from public.branch_settings bs where bs.branch_id = p_branch_id),
    1);
$$;
revoke execute on function private.charge_people(uuid, public.station_type, int) from public, anon, authenticated;

-- Rates lose their player choices and "extra player" prices. A console rate priced by choice
-- becomes a price per person (its smallest choice ÷ its count, so "2 controllers ₹200" = ₹100 each).
update public.rate_plans
   set per_hour = case when station_type in ('ps5', 'xbox') and jsonb_array_length(player_choices) > 0
                       then round(per_hour / greatest(included_players, 1), 2) else per_hour end,
       per_frame = case when per_frame is not null and station_type in ('ps5', 'xbox') and jsonb_array_length(player_choices) > 0
                        then round(per_frame / greatest(included_players, 1), 2) else per_frame end,
       player_choices = '[]', extra_player_per_hour = 0, included_players = 1
 where jsonb_array_length(player_choices) > 0 or extra_player_per_hour > 0;

-- The charge: the station's own charge (renamed below), times the people on a per-person type.
-- Everything that bills (end, checkout, the QR page) calls private.session_charge, so it all follows.
alter function private.session_charge(uuid, timestamptz) rename to session_charge_station;

create function private.session_charge(p_session_id uuid, p_at timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb;
  n int;
  v_sum numeric;
begin
  c := private.session_charge_station(p_session_id, p_at);
  if c is null then
    return null;
  end if;
  select private.charge_people(s.branch_id, st.type, s.players) into n
    from public.sessions s join public.stations st on st.id = s.station_id
   where s.id = p_session_id;
  if coalesce(n, 1) <= 1 then
    return c;
  end if;
  v_sum := coalesce((c ->> 'prepaid_amount')::numeric, 0) + coalesce((c ->> 'time_amount')::numeric, 0)
           + coalesce((c ->> 'extra_amount')::numeric, 0);
  c := c || jsonb_build_object(
    'people', n,
    'prepaid_amount', round(coalesce((c ->> 'prepaid_amount')::numeric, 0) * n, 2),
    'time_amount', round(coalesce((c ->> 'time_amount')::numeric, 0) * n, 2),
    'extra_amount', round(coalesce((c ->> 'extra_amount')::numeric, 0) * n, 2),
    'total', greatest(round(v_sum * n), 0));
  if c ? 'frame_price' then
    c := c || jsonb_build_object('frame_price', (c ->> 'frame_price')::numeric * n);
  end if;
  return c;
end $$;

revoke execute on function private.session_charge_station(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.session_charge(uuid, timestamptz) from public, anon, authenticated;

-- Collecting up front (fixed time, extend) takes the same per-person amount the bill will.
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
  v_collect := greatest(round((v_price + private.player_extra(plan, v_players, 'hour') * v_minutes / 60.0)
                               * private.charge_people(st.branch_id, st.type, v_players)), 0);
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

  v_collect := greatest(round((q.price + private.player_extra(plan, s.players, 'hour') * q.minutes / 60.0)
                               * private.charge_people(s.branch_id, st.type, s.players)), 0);
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

-- 3. Online booking off (the public page's functions refuse while it's off) ---------------
update public.branch_settings set booking_enabled = false where booking_enabled;
