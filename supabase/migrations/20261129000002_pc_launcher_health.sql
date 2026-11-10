-- PC app, round two:
--   1. Games menu: the owner lists games (name + program or launcher link) in Settings › PC app.
--      While a player has the PC, a menu window shows them, with the player's wallet balance,
--      snack ordering, "30 more minutes" and "Call staff" (the same requests as the QR page).
--   2. Restrictions: turn off Task Manager, Control Panel / Settings, the command line and
--      registry editor, and USB drives while a player has the PC.
--   3. Health: each check-in carries CPU, memory, GPU and disk readings, shown on the floor.

alter table public.branch_settings
  -- [{"id": "a1b2c3", "name": "Valorant", "target": "C:\\Riot Games\\Riot Client\\RiotClientServices.exe"}]
  add column pc_games jsonb not null default '[]'
    check (jsonb_typeof(pc_games) = 'array' and jsonb_array_length(pc_games) <= 40),
  add column pc_restrictions text[] not null default '{}'
    check (pc_restrictions <@ array['task_manager', 'control_panel', 'command_line', 'usb_drives']::text[]);

alter table public.devices
  add column health jsonb,
  add column health_at timestamptz;
grant select (health, health_at) on public.devices to authenticated;

-- ---------------------------------------------------------------------------
-- Requests from a station (QR page or PC app), one set of rules for both
-- ---------------------------------------------------------------------------
create function private.create_station_request(
  p_station_id uuid,
  p_kind text,
  p_product_id uuid,
  p_quantity int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  pr public.products;
  v_qty int := coalesce(p_quantity, 1);
  v_label text;
  v_minutes int;
  v_id uuid;
begin
  select * into st from public.stations where id = p_station_id;
  select * into bs from public.branch_settings where branch_id = st.branch_id;
  select * into s from public.sessions where station_id = st.id and status <> 'ended' for update;
  if not found then
    raise exception 'No session is running here. Ask at the counter.' using errcode = '22023';
  end if;

  if (select count(*) from public.station_requests where session_id = s.id and status = 'pending') >= 5 then
    raise exception 'Staff haven''t seen your earlier requests yet. Please wait a moment.' using errcode = '22023';
  end if;
  if (select count(*) from public.station_requests
       where session_id = s.id and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many requests. Try again in a few minutes.' using errcode = '22023';
  end if;

  if p_kind = 'snack' then
    if not coalesce(bs.qr_orders, false) then
      raise exception 'Please order at the counter.' using errcode = '22023';
    end if;
    if v_qty not between 1 and 10 then
      raise exception 'Order 1 to 10 at a time.' using errcode = '22023';
    end if;
    select * into pr from public.products where id = p_product_id and branch_id = st.branch_id and is_active;
    if not found or (pr.stock is not null and pr.stock < v_qty) then
      raise exception 'Sorry, that item isn''t available right now.' using errcode = '22023';
    end if;
    v_label := v_qty || ' × ' || pr.name;
  elsif p_kind = 'extend' then
    if s.mode <> 'prepaid' then
      raise exception 'Your timer keeps running until you stop. No need to add time.' using errcode = '22023';
    end if;
    if exists (select 1 from public.station_requests where session_id = s.id and kind = 'extend' and status = 'pending') then
      raise exception 'You''ve already asked for more time. Staff will confirm it.' using errcode = '22023';
    end if;
    v_minutes := 30;
    v_label := '30 more minutes';
    v_qty := null;
  elsif p_kind = 'call' then
    if exists (select 1 from public.station_requests where session_id = s.id and kind = 'call' and status = 'pending') then
      raise exception 'Staff have been called. They''ll be with you shortly.' using errcode = '22023';
    end if;
    v_label := 'Call staff';
    v_qty := null;
  else
    raise exception 'Unknown request.' using errcode = '22023';
  end if;

  insert into public.station_requests (org_id, branch_id, station_id, session_id, kind, product_id, label, quantity, minutes)
  values (st.org_id, st.branch_id, st.id, s.id, p_kind, pr.id, v_label, v_qty, v_minutes)
  returning id into v_id;
  return v_id;
end $$;

-- The QR page: same as before, now through the shared rules.
create or replace function public.public_station_request(
  p_code text,
  p_kind text,
  p_product_id uuid default null,
  p_quantity int default 1
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
begin
  select * into st from public.stations where public_code = lower(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'This QR code isn''t valid any more. Ask at the counter.' using errcode = '22023';
  end if;
  if not coalesce((select qr_enabled from public.branch_settings where branch_id = st.branch_id), false) then
    raise exception 'This page is turned off. Ask at the counter.' using errcode = '22023';
  end if;
  return private.create_station_request(st.id, p_kind, p_product_id, p_quantity);
end $$;

-- The PC app's menu window. Works whether or not the QR page is on.
create function public.agent_request(
  p_token text,
  p_kind text,
  p_product_id uuid default null,
  p_quantity int default 1
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  d := private.device_for_token(p_token);
  return private.create_station_request(d.station_id, p_kind, p_product_id, p_quantity);
end $$;

-- ---------------------------------------------------------------------------
-- Check-in: stores health; returns games, restrictions and the menu window's data
-- ---------------------------------------------------------------------------
create or replace function public.agent_sync(p_token text, p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  v_mac text := upper(replace(coalesce(p_info ->> 'mac', ''), '-', ':'));
  v_health jsonb := p_info -> 'health';
  v_wallet numeric;
  v_menu jsonb := '[]';
  v_requests jsonb := '[]';
begin
  d := private.device_for_token(p_token);
  select * into st from public.stations where id = d.station_id;
  select * into bs from public.branch_settings where branch_id = d.branch_id;
  select * into s from public.sessions where station_id = d.station_id and status <> 'ended';

  -- Health is display-only: keep it small and an object, or ignore it.
  if jsonb_typeof(v_health) <> 'object' or length(v_health::text) > 2000 then
    v_health := null;
  end if;

  update public.devices
     set last_seen_at = now(),
         hostname = coalesce(left(p_info ->> 'hostname', 64), hostname),
         agent_version = coalesce(left(p_info ->> 'version', 20), agent_version),
         os = coalesce(left(p_info ->> 'os', 64), os),
         ip = coalesce(left(p_info ->> 'ip', 45), ip),
         mac = case when v_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then v_mac else mac end,
         screen_locked = coalesce((p_info ->> 'locked')::boolean, screen_locked),
         health = coalesce(v_health, health),
         health_at = case when v_health is not null then now() else health_at end
   where id = d.id;

  update public.station_commands set delivered_at = now()
   where station_id = d.station_id and done_at is null and delivered_at is null;

  if s.id is not null then
    -- The player at this PC sees their own balance.
    if s.customer_id is not null then
      select wallet_balance into v_wallet from public.customers where id = s.customer_id;
    end if;
    if coalesce(bs.qr_orders, false) then
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'category', category)
                                order by category, name), '[]')
        into v_menu
        from (select * from public.products
               where branch_id = d.branch_id and is_active and (stock is null or stock > 0)
               order by category, name limit 100) pr;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'status', r.status)
                              order by r.created_at desc), '[]')
      into v_requests
      from (select * from public.station_requests where session_id = s.id order by created_at desc limit 5) r;
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'channel', d.channel,
    'venue', (select name from public.orgs where id = d.org_id),
    'branch', (select name from public.branches where id = d.branch_id),
    'station', jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status),
    'lock_message', bs.lock_message,
    'blocked_apps', to_jsonb(bs.blocked_apps),
    'player_login', coalesce(bs.pc_player_login, false),
    'games', coalesce(bs.pc_games, '[]'),
    'restrictions', to_jsonb(coalesce(bs.pc_restrictions, '{}')),
    'orders', coalesce(bs.qr_orders, false),
    'wallet', v_wallet,
    'menu', v_menu,
    'requests', v_requests,
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

-- Changing games or restrictions updates the PCs right away.
create or replace function private.poke_on_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if old.blocked_apps is distinct from new.blocked_apps
     or old.lock_message is distinct from new.lock_message
     or old.pc_player_login is distinct from new.pc_player_login
     or old.pc_games is distinct from new.pc_games
     or old.pc_restrictions is distinct from new.pc_restrictions
     or old.qr_orders is distinct from new.qr_orders then
    for r in select station_id from public.devices where branch_id = new.branch_id loop
      perform private.poke_station(r.station_id);
    end loop;
  end if;
  return new;
end $$;

-- A handled request shows up on the PC within a second, not at the next 15-second check-in.
create function private.poke_on_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.poke_station(new.station_id);
  end if;
  return new;
end $$;

create trigger station_requests_poke after update of status on public.station_requests
  for each row execute function private.poke_on_request();

-- ---------------------------------------------------------------------------
-- Reports from the PC: a USB drive plugged in while a player has the PC
-- ---------------------------------------------------------------------------
create or replace function public.agent_report(p_token text, p_kind text, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  d := private.device_for_token(p_token);
  -- blocked_app: the PC closed a blocked program. staff_unlock: the staff PIN was used offline.
  -- usb_drive: a USB drive was plugged in during a player's time.
  if p_kind not in ('blocked_app', 'staff_unlock', 'usb_drive') then
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (d.org_id, null, p_kind, 'devices', d.station_id::text,
          jsonb_build_object('name', (select name from public.stations where id = d.station_id))
            || jsonb_strip_nulls(jsonb_build_object(
                 'app', left(p_details ->> 'app', 80),
                 'drive', left(p_details ->> 'drive', 80),
                 'blocked', case when jsonb_typeof(p_details -> 'blocked') = 'boolean' then p_details -> 'blocked' end)));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  private.create_station_request(uuid, text, uuid, int),
  private.poke_on_request()
from public, anon, authenticated;
revoke execute on function public.agent_request(text, text, uuid, int) from public;
grant execute on function public.agent_request(text, text, uuid, int) to anon, authenticated;
