-- Phase 3: the PC app ("agent") on each gaming PC.
--
-- Pairing: the owner creates a one-time code for a PC station; the app on that PC trades it for a
-- random device key (only its SHA-256 is stored). Every agent call carries that key, so a PC can
-- only read its own station and acknowledge its own commands. No Supabase secret key is involved.
--
-- What the PC does follows the session on its station: running → unlocked; paused / none /
-- fixed time over → locked; station in maintenance → unlocked for staff. Commands cover the rest:
-- show a message, restart, shut down, and wake a sleeping PC (sent through another PC on the LAN).
--
-- Changes reach the PC instantly through a Realtime broadcast "poke" when available; the app also
-- checks in every 15 seconds, so nothing is lost without it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  station_id uuid not null unique references public.stations (id) on delete cascade,
  token_hash text not null unique,
  -- Realtime topic for this PC's pokes. Not readable by the dashboard.
  channel uuid not null default gen_random_uuid(),
  hostname text check (hostname is null or char_length(hostname) <= 64),
  agent_version text check (agent_version is null or char_length(agent_version) <= 20),
  os text check (os is null or char_length(os) <= 64),
  ip text check (ip is null or char_length(ip) <= 45),
  mac text check (mac is null or mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  screen_locked boolean,
  last_seen_at timestamptz,
  paired_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index devices_branch_idx on public.devices (branch_id);

create table public.pairing_codes (
  code text primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);

create table public.station_commands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  kind text not null check (kind in ('message', 'restart', 'shutdown', 'wake')),
  payload jsonb not null default '{}',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  done_at timestamptz,
  result text check (result is null or char_length(result) <= 200)
);
create index station_commands_pending_idx on public.station_commands (station_id, created_at) where done_at is null;

-- What the PC app enforces while a player is on it.
alter table public.branch_settings
  add column blocked_apps text[] not null default '{}'
    check (cardinality(blocked_apps) <= 100),
  add column lock_message text check (lock_message is null or char_length(lock_message) <= 200);

-- ---------------------------------------------------------------------------
-- Access: the dashboard reads device status and commands; writes go through functions.
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.station_commands enable row level security;

create policy devices_select on public.devices for select to authenticated
  using (private.has_org_role(org_id));
create policy station_commands_select on public.station_commands for select to authenticated
  using (private.has_org_role(org_id));

revoke all on public.devices, public.pairing_codes, public.station_commands from anon, authenticated;
-- The device key hash and Realtime topic stay private.
grant select (id, org_id, branch_id, station_id, hostname, agent_version, os, ip, mac, screen_locked, last_seen_at, created_at)
  on public.devices to authenticated;
grant select on public.station_commands to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.sha256(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex');
$$;

create function private.device_for_token(p_token text) returns public.devices
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.devices;
begin
  select * into d from public.devices where token_hash = private.sha256(coalesce(p_token, ''));
  if not found then
    raise exception 'This PC is not paired. Pair it again from Stations.' using errcode = '28000';
  end if;
  return d;
end $$;

-- Nudge a station's PC to check in now. Silently skipped if Realtime broadcast isn't available.
create function private.poke_station(p_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_channel uuid;
begin
  select channel into v_channel from public.devices where station_id = p_station_id;
  if v_channel is null then
    return;
  end if;
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'sync', 'qs-device-' || v_channel::text, false);
  exception when others then
    null; -- the app polls every 15 s anyway
  end;
end $$;

create function private.poke_on_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.poke_station(new.station_id);
  if tg_op = 'UPDATE' then
    if old.station_id <> new.station_id then
      perform private.poke_station(old.station_id); -- moved: the old PC locks
    end if;
  end if;
  return new;
end $$;
create trigger sessions_poke_pc after insert or update on public.sessions
  for each row execute function private.poke_on_session();

create function private.poke_on_command() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.poke_station(new.station_id);
  return new;
end $$;
create trigger station_commands_poke_pc after insert on public.station_commands
  for each row execute function private.poke_on_command();

create function private.poke_on_station() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status or old.name is distinct from new.name then
    perform private.poke_station(new.id);
  end if;
  return new;
end $$;
create trigger stations_poke_pc after update on public.stations
  for each row execute function private.poke_on_station();

create function private.poke_on_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if old.blocked_apps is distinct from new.blocked_apps or old.lock_message is distinct from new.lock_message then
    for r in select station_id from public.devices where branch_id = new.branch_id loop
      perform private.poke_station(r.station_id);
    end loop;
  end if;
  return new;
end $$;
create trigger branch_settings_poke_pc after update on public.branch_settings
  for each row execute function private.poke_on_settings();

-- ---------------------------------------------------------------------------
-- Dashboard functions (signed-in staff / owner)
-- ---------------------------------------------------------------------------

-- Owner: a one-time code to type into the PC app. 8 characters, lasts 15 minutes.
create function public.create_pairing_code(p_station_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  v_code text;
begin
  select * into st from public.stations where id = p_station_id;
  if not found then
    raise exception 'Station not found.' using errcode = '22023';
  end if;
  perform private.assert_member(st.org_id, array['owner']::public.member_role[]);
  if st.type <> 'pc' then
    raise exception 'The PC app is for PC stations.' using errcode = '22023';
  end if;

  delete from public.pairing_codes where station_id = st.id or expires_at < now() - interval '1 day';
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
    into v_code
    from extensions.gen_random_bytes(8) b, generate_series(0, 7) i;
  insert into public.pairing_codes (code, org_id, station_id, created_by) values (v_code, st.org_id, st.id, auth.uid());
  return v_code;
end $$;

create function public.unpair_device(p_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.stations where id = p_station_id;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  delete from public.devices where station_id = p_station_id;
end $$;

-- Staff: message / restart / shut down a PC; wake a PC that is off (needs another PC in the branch online).
create function public.send_station_command(p_station_id uuid, p_kind text, p_payload jsonb default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  target public.devices;
  helper public.devices;
  v_id uuid;
begin
  select * into st from public.stations where id = p_station_id;
  if not found then
    raise exception 'Station not found.' using errcode = '22023';
  end if;
  perform private.assert_member(st.org_id);
  select * into target from public.devices where station_id = st.id;
  if target.id is null then
    raise exception '% has no PC app paired.', st.name using errcode = '22023';
  end if;

  if p_kind = 'message' then
    if char_length(trim(coalesce(p_payload ->> 'text', ''))) not between 1 and 140 then
      raise exception 'Write a message of up to 140 characters.' using errcode = '22023';
    end if;
  elsif p_kind = 'wake' then
    if target.mac is null then
      raise exception '% hasn''t reported its network address yet. Turn it on by hand once.', st.name using errcode = '22023';
    end if;
    -- A sleeping PC can't receive anything: another online PC on the same network sends the wake signal.
    select * into helper from public.devices
     where branch_id = st.branch_id and station_id <> st.id and last_seen_at > now() - interval '90 seconds'
     order by last_seen_at desc limit 1;
    if helper.id is null then
      raise exception 'No other PC in this branch is online to wake %.', st.name using errcode = '22023';
    end if;
    insert into public.station_commands (org_id, station_id, kind, payload)
    values (st.org_id, helper.station_id, 'wake', jsonb_build_object('mac', target.mac, 'for', st.name))
    returning id into v_id;
    return v_id;
  elsif p_kind not in ('restart', 'shutdown') then
    raise exception 'Unknown command.' using errcode = '22023';
  end if;

  insert into public.station_commands (org_id, station_id, kind, payload)
  values (st.org_id, st.id, p_kind, coalesce(p_payload, '{}'))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Agent functions (the PC app; called with the publishable key + its device key)
-- ---------------------------------------------------------------------------

create function public.agent_pair(p_code text, p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pc public.pairing_codes;
  st public.stations;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_channel uuid := gen_random_uuid();
begin
  select * into pc from public.pairing_codes
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'That code is wrong or has expired. Create a new one under Stations.' using errcode = '22023';
  end if;
  select * into st from public.stations where id = pc.station_id;

  update public.pairing_codes set used_at = now() where code = pc.code;
  -- One PC app per station: pairing again replaces the old one (its key stops working).
  delete from public.devices where station_id = st.id;
  insert into public.devices (org_id, branch_id, station_id, token_hash, channel, hostname, agent_version, os, paired_by)
  values (st.org_id, st.branch_id, st.id, private.sha256(v_token), v_channel,
          left(p_info ->> 'hostname', 64), left(p_info ->> 'version', 20), left(p_info ->> 'os', 64), pc.created_by);

  return jsonb_build_object('token', v_token, 'channel', v_channel, 'station', st.name);
end $$;

-- Check-in: reports this PC's details, returns everything the app needs to decide lock/unlock.
create function public.agent_sync(p_token text, p_info jsonb default '{}') returns jsonb
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

create function public.agent_ack(p_token text, p_command_id uuid, p_result text default 'done') returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  d := private.device_for_token(p_token);
  update public.station_commands set done_at = now(), result = left(coalesce(p_result, 'done'), 200)
   where id = p_command_id and station_id = d.station_id;
end $$;

-- Things worth the owner's attention, shown in Activity.
create function public.agent_report(p_token text, p_kind text, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  d := private.device_for_token(p_token);
  -- blocked_app: the PC closed a blocked program. staff_unlock: someone used the staff PIN on the PC.
  if p_kind not in ('blocked_app', 'staff_unlock') then
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (d.org_id, null, p_kind, 'devices', d.station_id::text,
          jsonb_build_object('name', (select name from public.stations where id = d.station_id))
            || jsonb_strip_nulls(jsonb_build_object('app', left(p_details ->> 'app', 80))));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.create_pairing_code(uuid),
  public.unpair_device(uuid),
  public.send_station_command(uuid, text, jsonb),
  public.agent_pair(text, jsonb),
  public.agent_sync(text, jsonb),
  public.agent_ack(text, uuid, text),
  public.agent_report(text, text, jsonb)
from public;

grant execute on function
  public.create_pairing_code(uuid),
  public.unpair_device(uuid),
  public.send_station_command(uuid, text, jsonb)
to authenticated;

-- The PC app is not a signed-in user: it calls these with the publishable key (anon role).
-- Each one checks the code or device key itself.
grant execute on function
  public.agent_pair(text, jsonb),
  public.agent_sync(text, jsonb),
  public.agent_ack(text, uuid, text),
  public.agent_report(text, text, jsonb)
to anon, authenticated;
