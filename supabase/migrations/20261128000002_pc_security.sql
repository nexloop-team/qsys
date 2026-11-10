-- PC app hardening.
--
-- 1. Staff PIN checked on the server. The PC app keeps a copy of the staff PIN hash in a settings
--    file the player's Windows account can write to, so a player could put in their own PIN during
--    a paid session and unlock the PC for free later. Now the PIN is also stored here (bcrypt), set
--    once right after pairing, and the app asks the server whenever it is online. Changing it needs
--    a new pairing (a new one-time code from the owner).
-- 2. Escalating lockouts. Wrong PINs used to lock for a fixed 15 minutes (player) and then start
--    over, which allows about 480 guesses a day against one 4-digit PIN. Each lockout now lasts
--    longer: 15 minutes, 1 hour, 4 hours, then 24 hours, until a correct PIN or a staff reset.

-- ---------------------------------------------------------------------------
-- Player PINs: escalating lockout
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists pin_lockouts int not null default 0;

-- agent_player_login sets pin_failed = 0 and pin_locked_until = now() + 15 min on the 5th wrong PIN,
-- and clears both on a correct PIN; set_player_pin / clear_player_pin clear both too. This trigger
-- turns the fixed 15 minutes into a growing lock, and forgets past lockouts once the PIN works.
create function private.escalate_pin_lockout() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.pin_locked_until is not null
     and new.pin_locked_until > now()
     and (old.pin_locked_until is null or old.pin_locked_until <= now()) then
    new.pin_lockouts := old.pin_lockouts + 1;
    new.pin_locked_until := now() + case new.pin_lockouts
      when 1 then interval '15 minutes'
      when 2 then interval '1 hour'
      when 3 then interval '4 hours'
      else interval '24 hours'
    end;
  elsif new.pin_locked_until is null and new.pin_failed = 0 then
    new.pin_lockouts := 0;
  end if;
  return new;
end $$;

create trigger customers_escalate_pin_lockout before update of pin_locked_until, pin_failed on public.customers
  for each row execute function private.escalate_pin_lockout();

-- ---------------------------------------------------------------------------
-- Staff PIN on the server
-- ---------------------------------------------------------------------------
alter table public.devices
  add column staff_pin_hash text,
  add column staff_pin_failed int not null default 0,
  add column staff_pin_lockouts int not null default 0,
  add column staff_pin_locked_until timestamptz;

-- The new columns stay private, like the device key hash: no grant to authenticated.

-- Set once, right after pairing. A device that already has one can't change it: whoever holds the
-- device key (it lives on the PC) must not be able to swap the staff PIN.
create function public.agent_set_staff_pin(p_token text, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  d := private.device_for_token(p_token);
  if coalesce(p_pin, '') !~ '^[0-9]{6,8}$' then
    raise exception 'The staff PIN must be 6 to 8 digits.' using errcode = '22023';
  end if;
  if d.staff_pin_hash is not null then
    raise exception 'This PC already has a staff PIN. Pair it again to change it.' using errcode = '22023';
  end if;
  update public.devices set staff_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = d.id;
end $$;

-- Check the staff PIN. Every successful use is logged in Activity. Wrong PINs lock the staff
-- unlock on this PC for longer each time (5 tries, then 15 min, 1 h, 4 h, 24 h).
create function public.agent_check_staff_pin(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  v_tz text;
begin
  d := private.device_for_token(p_token);
  select * into d from public.devices where id = d.id for update;

  if d.staff_pin_hash is null then
    -- Paired before this check existed: the app falls back to its own copy.
    return jsonb_build_object('ok', false, 'unset', true, 'error', 'No staff PIN on the server yet.');
  end if;
  if d.staff_pin_locked_until > now() then
    select timezone into v_tz from public.branches where id = d.branch_id;
    return jsonb_build_object('ok', false, 'error',
      'Too many wrong PINs. Try again after ' || to_char(d.staff_pin_locked_until at time zone v_tz, 'FMHH12:MI AM')
      || ', or unlock from the floor.');
  end if;

  if extensions.crypt(coalesce(p_pin, ''), d.staff_pin_hash) <> d.staff_pin_hash then
    if d.staff_pin_failed + 1 >= 5 then
      update public.devices
         set staff_pin_failed = 0,
             staff_pin_lockouts = staff_pin_lockouts + 1,
             staff_pin_locked_until = now() + case staff_pin_lockouts + 1
               when 1 then interval '15 minutes'
               when 2 then interval '1 hour'
               when 3 then interval '4 hours'
               else interval '24 hours'
             end
       where id = d.id;
      insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
      values (d.org_id, null, 'staff_pin_locked', 'devices', d.station_id::text,
              jsonb_build_object('name', (select name from public.stations where id = d.station_id)));
    else
      update public.devices set staff_pin_failed = staff_pin_failed + 1 where id = d.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN.');
  end if;

  update public.devices set staff_pin_failed = 0, staff_pin_lockouts = 0, staff_pin_locked_until = null where id = d.id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (d.org_id, null, 'staff_unlock', 'devices', d.station_id::text,
          jsonb_build_object('name', (select name from public.stations where id = d.station_id)));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function private.escalate_pin_lockout() from public, anon, authenticated;
revoke execute on function
  public.agent_set_staff_pin(text, text),
  public.agent_check_staff_pin(text, text)
from public;
-- Like the other agent functions: called by the PC app with the publishable key; each checks the
-- device key itself.
grant execute on function
  public.agent_set_staff_pin(text, text),
  public.agent_check_staff_pin(text, text)
to anon, authenticated;
