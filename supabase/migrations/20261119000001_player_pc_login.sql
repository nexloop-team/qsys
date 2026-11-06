-- Players log in on a free PC with their mobile number + a 4-digit PIN. That starts an
-- open-time session on that PC in their name. They pay at the counter at the end, like any
-- other session. Staff set or reset the PIN on the player's page.

-- ---------------------------------------------------------------------------
-- Player PINs (customers.pin_hash already exists and is never readable by the app)
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists pin_failed int not null default 0,
  add column if not exists pin_locked_until timestamptz,
  add column if not exists pin_set boolean generated always as (pin_hash is not null) stored;
grant select (pin_set) on public.customers to authenticated;

-- Owner switch, per branch (Settings › PC app).
alter table public.branch_settings
  add column if not exists pc_player_login boolean not null default true;

-- Wrong tries per PC, so one PC can't be used to guess PINs across many mobile numbers.
create table if not exists private.pc_login_failures (
  device_id uuid not null references public.devices (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists pc_login_failures_idx on private.pc_login_failures (device_id, at);
revoke all on private.pc_login_failures from public, anon, authenticated;

-- Staff: set (or replace) a player's PIN. 4 digits, chosen by the player at the counter.
create or replace function public.set_player_pin(p_customer_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cu public.customers;
begin
  select * into cu from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(cu.org_id);
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be 4 digits.' using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1{3}$' or p_pin in ('1234', '4321', '0123', '9876') then
    raise exception 'That PIN is too easy to guess. Pick another one.' using errcode = '22023';
  end if;
  update public.customers
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_failed = 0, pin_locked_until = null
   where id = cu.id;
end $$;

create or replace function public.clear_player_pin(p_customer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.customers where id = p_customer_id;
  perform private.assert_member(v_org);
  update public.customers set pin_hash = null, pin_failed = 0, pin_locked_until = null where id = p_customer_id;
end $$;

-- ---------------------------------------------------------------------------
-- The PC app: log a player in on this PC
-- ---------------------------------------------------------------------------
-- Returns {ok: true, name} or {ok: false, error}. Wrong tries are answered (not raised), so the
-- try counters are saved.
create or replace function public.agent_player_login(p_token text, p_mobile text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  st public.stations;
  bs public.branch_settings;
  plan public.rate_plans;
  cu public.customers;
  v_tz text;
  v_phone text;
  v_session uuid;
begin
  d := private.device_for_token(p_token);
  select * into st from public.stations where id = d.station_id;
  select * into bs from public.branch_settings where branch_id = d.branch_id;
  select timezone into v_tz from public.branches where id = d.branch_id;

  if not coalesce(bs.pc_player_login, false) then
    return jsonb_build_object('ok', false, 'error', 'Ask at the counter to start your session.');
  end if;
  if st.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'This PC is out of service.');
  end if;
  if exists (select 1 from public.sessions where station_id = st.id and status <> 'ended') then
    return jsonb_build_object('ok', false, 'error', 'This PC already has a session. Ask at the counter.');
  end if;
  if (select count(*) from private.pc_login_failures where device_id = d.id and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries on this PC. Wait 10 minutes or ask at the counter.');
  end if;

  begin
    v_phone := private.normalize_phone(p_mobile);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Enter your 10-digit mobile number.');
  end;

  select * into cu from public.customers where org_id = d.org_id and phone = v_phone for update;
  if cu.id is not null and cu.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error',
      'Too many wrong PINs. Try again after ' || to_char(cu.pin_locked_until at time zone v_tz, 'FMHH12:MI AM')
      || ', or ask at the counter.');
  end if;

  if cu.id is null or cu.pin_hash is null or extensions.crypt(coalesce(p_pin, ''), cu.pin_hash) <> cu.pin_hash then
    delete from private.pc_login_failures where at < now() - interval '1 day';
    insert into private.pc_login_failures (device_id) values (d.id);
    if cu.pin_hash is not null then
      -- 5 wrong PINs lock this mobile number for 15 minutes.
      update public.customers
         set pin_failed = case when pin_failed + 1 >= 5 then 0 else pin_failed + 1 end,
             pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' end
       where id = cu.id;
    end if;
    -- Same answer for an unknown number and a wrong PIN.
    return jsonb_build_object('ok', false, 'error', 'Wrong mobile number or PIN. No PIN yet? Ask at the counter.');
  end if;

  update public.customers set pin_failed = 0, pin_locked_until = null where id = cu.id;

  plan := private.resolve_rate_plan(st.id);
  if plan.id is null or not coalesce((bs.allowed_modes_by_type -> st.type::text) ? 'open', false) then
    return jsonb_build_object('ok', false, 'error', 'Ask at the counter to start your session.');
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_id, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, 'open', cu.id, cu.name, cu.phone, 1,
      null, 0, 0, null)
    returning id into v_session;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'This PC already has a session. Ask at the counter.');
  end;

  perform private.log_session_event(st.org_id, v_session, 'start',
    jsonb_build_object('mode', 'open', 'minutes', 0, 'price', 0, 'customer_id', cu.id, 'source', 'pc_login'));
  return jsonb_build_object('ok', true, 'name', cu.name);
end $$;

-- ---------------------------------------------------------------------------
-- Check-in now also says whether the lock screen shows the player login.
-- ---------------------------------------------------------------------------
create or replace function public.agent_sync(p_token text, p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  v_mac text := upper(replace(coalesce(p_info ->> 'mac', ''), '-', ':'));
begin
  d := private.device_for_token(p_token);
  select * into st from public.stations where id = d.station_id;
  select * into bs from public.branch_settings where branch_id = d.branch_id;
  select * into s from public.sessions where station_id = d.station_id and status <> 'ended';

  update public.devices
     set last_seen_at = now(),
         hostname = coalesce(left(p_info ->> 'hostname', 64), hostname),
         agent_version = coalesce(left(p_info ->> 'version', 20), agent_version),
         os = coalesce(left(p_info ->> 'os', 64), os),
         ip = coalesce(left(p_info ->> 'ip', 45), ip),
         mac = case when v_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then v_mac else mac end,
         screen_locked = coalesce((p_info ->> 'locked')::boolean, screen_locked)
   where id = d.id;

  update public.station_commands set delivered_at = now()
   where station_id = d.station_id and done_at is null and delivered_at is null;

  return jsonb_build_object(
    'server_now', now(),
    'channel', d.channel,
    'venue', (select name from public.orgs where id = d.org_id),
    'branch', (select name from public.branches where id = d.branch_id),
    'station', jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status),
    'lock_message', bs.lock_message,
    'blocked_apps', to_jsonb(bs.blocked_apps),
    'player_login', coalesce(bs.pc_player_login, false),
    'session', case when s.id is null then null else jsonb_build_object(
        'id', s.id,
        'mode', s.mode,
        'status', s.status,
        'started_at', s.started_at,
        'planned_end_at', s.planned_end_at,
        'paused_at', s.paused_at,
        'customer_name', s.customer_name) end,
    -- Only recent commands: a restart queued an hour ago must not fire when the PC comes back.
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'payload', c.payload) order by c.created_at)
        from public.station_commands c
       where c.station_id = d.station_id and c.done_at is null and c.created_at > now() - interval '10 minutes'), '[]')
  );
end $$;

-- Turning player login on/off updates the lock screens right away.
create or replace function private.poke_on_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if old.blocked_apps is distinct from new.blocked_apps
     or old.lock_message is distinct from new.lock_message
     or old.pc_player_login is distinct from new.pc_player_login then
    for r in select station_id from public.devices where branch_id = new.branch_id loop
      perform private.poke_station(r.station_id);
    end loop;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.set_player_pin(uuid, text),
  public.clear_player_pin(uuid),
  public.agent_player_login(text, text, text)
from public;
grant execute on function public.set_player_pin(uuid, text), public.clear_player_pin(uuid) to authenticated;
grant execute on function public.agent_player_login(text, text, text) to anon, authenticated;
