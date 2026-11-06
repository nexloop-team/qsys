begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixture: one venue, staff, two paired PCs (device keys 'key-1' / 'key-2'), PC price ₹60/hr,
-- and a player with mobile 9876500001.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e2', 'staff@login.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000e0', 'Login Arena');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'pc', 'PC-01'),
  ('30000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'pc', 'PC-02');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'PC', 'pc', 60);
insert into public.devices (org_id, branch_id, station_id, token_hash, channel) values
  ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', '30000000-0000-0000-0000-0000000000e1',
   encode(extensions.digest('key-1', 'sha256'), 'hex'), gen_random_uuid()),
  ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', '30000000-0000-0000-0000-0000000000e2',
   encode(extensions.digest('key-2', 'sha256'), 'hex'), gen_random_uuid());
insert into public.customers (id, org_id, phone, name)
  values ('40000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e0', '9876500001', 'Asha');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_pc() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- Setting the PIN (staff, at the counter) --------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select public.set_player_pin('40000000-0000-0000-0000-0000000000e1', '12a4') $$,
  '22023', null, 'the PIN must be 4 digits');
select throws_ok($$ select public.set_player_pin('40000000-0000-0000-0000-0000000000e1', '1111') $$,
  '22023', null, 'an easy PIN is refused');
select lives_ok($$ select public.set_player_pin('40000000-0000-0000-0000-0000000000e1', '4826') $$,
  'staff set a player''s PIN');
select is((select pin_set from public.customers where id = '40000000-0000-0000-0000-0000000000e1'), true,
  'the player page can see a PIN is set');
select throws_ok($$ select pin_hash from public.customers $$, '42501', null, 'staff cannot read the PIN hash');
reset role;

select pg_temp.as_pc();
select throws_ok($$ select public.set_player_pin('40000000-0000-0000-0000-0000000000e1', '5555') $$,
  '42501', null, 'the PC app cannot set PINs');

-- Logging in on the PC ---------------------------------------------------------
select is(public.agent_sync('key-1') -> 'player_login', 'true'::jsonb, 'the lock screen shows the player login');
select is(public.agent_player_login('key-1', '98765 00001', '0000') ->> 'ok', 'false', 'a wrong PIN is refused');
select is(public.agent_player_login('key-1', '9876500999', '4826') ->> 'error',
  public.agent_player_login('key-1', '9876500001', '0000') ->> 'error',
  'an unknown number gets the same answer as a wrong PIN');
select is(public.agent_player_login('key-1', '+91 98765 00001', '4826') ->> 'name', 'Asha', 'the right PIN logs in');
select is(public.agent_sync('key-1') #>> '{session,mode}', 'open', 'an open-time session runs on the PC');
select is(public.agent_sync('key-1') #>> '{session,customer_name}', 'Asha', 'in the player''s name');
select is(public.agent_player_login('key-1', '9876500001', '4826') ->> 'ok', 'false', 'a PC with a session refuses another login');
reset role;

select is((select customer_id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000e1' and status <> 'ended'),
  '40000000-0000-0000-0000-0000000000e1'::uuid, 'the session is on the player''s account (for billing)');
select is((select details ->> 'source' from public.session_events
            where kind = 'start' and org_id = '10000000-0000-0000-0000-0000000000e0'), 'pc_login', 'the start is logged as a PC login');

-- 5 wrong PINs lock the number for 15 minutes (on another PC too) ---------------
select pg_temp.as_pc();
select public.agent_player_login('key-2', '9876500001', '0000') from generate_series(1, 5);
select ok(public.agent_player_login('key-2', '9876500001', '4826') ->> 'error' like 'Too many wrong PINs%',
  'after 5 wrong PINs even the right one waits');
reset role;

-- The owner can turn player login off -------------------------------------------
update public.customers set pin_locked_until = null where id = '40000000-0000-0000-0000-0000000000e1';
update public.branch_settings set pc_player_login = false where branch_id = '20000000-0000-0000-0000-0000000000e0';
select pg_temp.as_pc();
select is(public.agent_sync('key-2') -> 'player_login', 'false'::jsonb, 'login hidden when turned off');
select is(public.agent_player_login('key-2', '9876500001', '4826') ->> 'ok', 'false', 'and refused');
reset role;

select * from finish();
rollback;
