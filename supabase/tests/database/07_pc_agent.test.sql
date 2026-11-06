begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixture: owner + staff, two PCs and a pool table at ₹60/hr.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@pc.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff@pc.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000f0', 'PC Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id, blocked_apps)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', '{taskmgr.exe}');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'pc', 'PC-01'),
  ('30000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'pc', 'PC-02'),
  ('30000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'pool', 'Table 1');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'PC', 'pc', 60);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- The PC app: publishable key, no signed-in user.
create function pg_temp.as_pc() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- Pairing codes ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.create_pairing_code('30000000-0000-0000-0000-0000000000f1') $$,
  '42501', null, 'staff cannot pair PCs');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select set_config('qs.code1', public.create_pairing_code('30000000-0000-0000-0000-0000000000f1'), true);
select set_config('qs.code2', public.create_pairing_code('30000000-0000-0000-0000-0000000000f2'), true);
select matches(current_setting('qs.code1'), '^[A-HJ-NP-Z2-9]{8}$', 'code is 8 easy-to-read characters');
select throws_ok($$ select public.create_pairing_code('30000000-0000-0000-0000-0000000000f3') $$,
  '22023', null, 'only PC stations get the PC app');
reset role;

select pg_temp.as_pc();
select throws_ok($$ select public.agent_pair('WRONG123') $$, '22023', null, 'a wrong code is refused');
-- Typed in lower case with a space, as people do.
select set_config('qs.token1',
  public.agent_pair(lower(substr(current_setting('qs.code1'), 1, 4)) || ' ' || substr(current_setting('qs.code1'), 5),
                    '{"hostname":"GAMER-01","version":"0.1.0"}') ->> 'token', true);
select ok(length(current_setting('qs.token1')) = 64, 'pairing returns a device key');
select throws_ok(format('select public.agent_pair(%L)', current_setting('qs.code1')), '22023', null,
  'a code works only once');
select set_config('qs.token2', public.agent_pair(current_setting('qs.code2')) ->> 'token', true);

-- Check-in -----------------------------------------------------------------
select throws_ok($$ select public.agent_sync('not-a-real-key') $$, '28000', null, 'an unknown key is refused');
select is(public.agent_sync(current_setting('qs.token1'), '{"mac":"aa-bb-cc-dd-ee-01","locked":true}') #>> '{station,name}',
  'PC-01', 'the PC sees its own station');
select is(public.agent_sync(current_setting('qs.token1')) -> 'session', 'null'::jsonb, 'no session: stays locked');
select is(public.agent_sync(current_setting('qs.token1')) -> 'blocked_apps', '["taskmgr.exe"]'::jsonb,
  'the blocked-apps list reaches the PC');
select throws_ok($$ select * from public.devices $$, '42501', null, 'the PC app cannot read the devices table');
reset role;

-- A session on PC-01 shows up on its next check-in.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin perform public.start_session('30000000-0000-0000-0000-0000000000f1', 'open', '9876500077', 'Asha'); end $$;
reset role;
select pg_temp.as_pc();
select is(public.agent_sync(current_setting('qs.token1')) #>> '{session,status}', 'running', 'session running: unlock');
select is(public.agent_sync(current_setting('qs.token2')) -> 'session', 'null'::jsonb, 'PC-02 does not see PC-01''s session');
reset role;

-- Commands -----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.send_station_command('30000000-0000-0000-0000-0000000000f1', 'message', '{"text":""}') $$,
  '22023', null, 'an empty message is refused');
select set_config('qs.cmd', public.send_station_command('30000000-0000-0000-0000-0000000000f1', 'message',
  '{"text":"10 minutes left"}')::text, true);
select throws_ok($$ select token_hash from public.devices $$, '42501', null, 'staff cannot read device keys');
reset role;

select pg_temp.as_pc();
select is(jsonb_array_length(public.agent_sync(current_setting('qs.token1')) -> 'commands'), 1, 'the PC receives the message');
-- PC-02 cannot acknowledge PC-01's command.
do $$ begin perform public.agent_ack(current_setting('qs.token2'), current_setting('qs.cmd')::uuid); end $$;
select is(jsonb_array_length(public.agent_sync(current_setting('qs.token1')) -> 'commands'), 1, 'another PC cannot ack it');
do $$ begin perform public.agent_ack(current_setting('qs.token1'), current_setting('qs.cmd')::uuid, 'shown'); end $$;
select is(jsonb_array_length(public.agent_sync(current_setting('qs.token1')) -> 'commands'), 0, 'acknowledged: not sent again');

-- Turning on PC-01 from off: PC-02 (online, same network) gets the wake signal with PC-01's address.
do $$ begin perform public.agent_sync(current_setting('qs.token2')); end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin perform public.send_station_command('30000000-0000-0000-0000-0000000000f1', 'wake'); end $$;
reset role;
select is((select station_id::text || ' ' || (payload ->> 'mac') from public.station_commands where kind = 'wake'),
  '30000000-0000-0000-0000-0000000000f2 AA:BB:CC:DD:EE:01', 'wake goes through the other PC');

-- Reports from the PC land in Activity.
select pg_temp.as_pc();
do $$ begin perform public.agent_report(current_setting('qs.token2'), 'blocked_app', '{"app":"taskmgr.exe"}'); end $$;
reset role;
select is((select details ->> 'name' from public.audit_log where action = 'blocked_app'), 'PC-02',
  'closed apps are logged against the station');

select * from finish();
rollback;
