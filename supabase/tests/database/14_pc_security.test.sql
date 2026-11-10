begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixture: one venue, staff, one paired PC (device key 'key-s'), a player with a PIN.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'staff@sec.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000a9', 'Secure Arena');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', 'pc', 'PC-09');
insert into public.devices (id, org_id, branch_id, station_id, token_hash, channel)
  values ('50000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9',
          '30000000-0000-0000-0000-0000000000a9', encode(extensions.digest('key-s', 'sha256'), 'hex'), gen_random_uuid());
insert into public.customers (id, org_id, phone, name, pin_hash)
  values ('40000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '9876500009', 'Ravi',
          extensions.crypt('4826', extensions.gen_salt('bf', 4)));

create function pg_temp.as_pc() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Staff PIN on the server --------------------------------------------------------
select pg_temp.as_pc();
select is(public.agent_check_staff_pin('key-s', '482615') ->> 'unset', 'true',
  'a PC paired before server PINs falls back to its own copy');
select throws_ok($$ select public.agent_set_staff_pin('key-s', '4826') $$, '22023', null,
  'the staff PIN must be at least 6 digits');
select throws_ok($$ select public.agent_set_staff_pin('wrong-key', '482615') $$, '28000', null,
  'only the paired PC can set it');
select lives_ok($$ select public.agent_set_staff_pin('key-s', '482615') $$, 'the PC sets its staff PIN after pairing');
select throws_ok($$ select public.agent_set_staff_pin('key-s', '111111') $$, '22023', null,
  'the device key alone can''t change it later');
select is(public.agent_check_staff_pin('key-s', '000000') ->> 'ok', 'false', 'a wrong staff PIN is refused');
select is(public.agent_check_staff_pin('key-s', '482615') ->> 'ok', 'true', 'the right one opens the PC');
reset role;

select is((select count(*)::int from public.audit_log
            where org_id = '10000000-0000-0000-0000-0000000000a9' and action = 'staff_unlock'), 1,
  'the unlock is logged in Activity');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select throws_ok($$ select staff_pin_hash from public.devices $$, '42501', null, 'staff cannot read the PIN hash');
reset role;

-- 5 wrong staff PINs lock it, for longer each time --------------------------------
select pg_temp.as_pc();
select public.agent_check_staff_pin('key-s', '000000') from generate_series(1, 5);
select ok(public.agent_check_staff_pin('key-s', '482615') ->> 'error' like 'Too many wrong PINs%',
  'after 5 wrong staff PINs even the right one waits');
reset role;
select ok((select staff_pin_locked_until between now() + interval '14 minutes' and now() + interval '16 minutes'
             from public.devices where id = '50000000-0000-0000-0000-0000000000a9'), 'the first lock is 15 minutes');
select is((select count(*)::int from public.audit_log
            where org_id = '10000000-0000-0000-0000-0000000000a9' and action = 'staff_pin_locked'), 1,
  'the lock shows in Activity');

update public.devices set staff_pin_locked_until = now() - interval '1 second' where id = '50000000-0000-0000-0000-0000000000a9';
select pg_temp.as_pc();
select public.agent_check_staff_pin('key-s', '000000') from generate_series(1, 5);
reset role;
select ok((select staff_pin_locked_until between now() + interval '59 minutes' and now() + interval '61 minutes'
             from public.devices where id = '50000000-0000-0000-0000-0000000000a9'), 'the second lock is an hour');

update public.devices set staff_pin_locked_until = now() - interval '1 second' where id = '50000000-0000-0000-0000-0000000000a9';
select pg_temp.as_pc();
select is(public.agent_check_staff_pin('key-s', '482615') ->> 'ok', 'true', 'the right PIN works once the lock ends');
reset role;
select is((select staff_pin_lockouts from public.devices where id = '50000000-0000-0000-0000-0000000000a9'), 0,
  'and past locks are forgotten');

-- Player PINs: 5 wrong lock 15 minutes, then an hour --------------------------------
select pg_temp.as_pc();
select public.agent_player_login('key-s', '9876500009', '0000') from generate_series(1, 5);
reset role;
select ok((select pin_locked_until between now() + interval '14 minutes' and now() + interval '16 minutes'
             from public.customers where id = '40000000-0000-0000-0000-0000000000a9'), 'a player''s first lock is 15 minutes');

update public.customers set pin_locked_until = now() - interval '1 second' where id = '40000000-0000-0000-0000-0000000000a9';
select pg_temp.as_pc();
select public.agent_player_login('key-s', '9876500009', '0000') from generate_series(1, 5);
reset role;
select ok((select pin_locked_until between now() + interval '59 minutes' and now() + interval '61 minutes'
             from public.customers where id = '40000000-0000-0000-0000-0000000000a9'), 'the next lock is an hour');

-- Staff resetting the PIN clears the history.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.set_player_pin('40000000-0000-0000-0000-0000000000a9', '5937');
reset role;
select is((select pin_lockouts from public.customers where id = '40000000-0000-0000-0000-0000000000a9'), 0,
  'a new PIN from staff clears past locks');
select is((select pin_locked_until from public.customers where id = '40000000-0000-0000-0000-0000000000a9'), null,
  'and the lock itself');

select * from finish();
rollback;
