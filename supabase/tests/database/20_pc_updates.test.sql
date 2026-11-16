begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixture: owner + staff, two PCs with the app (keys 'key-v' on PC-01, 'key-w' on PC-02) on 0.1.0.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@update.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'staff@update.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000e0', 'Update Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('10000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'pc', 'PC-01'),
  ('30000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'pc', 'PC-02');
insert into public.devices (org_id, branch_id, station_id, token_hash, channel, agent_version) values
  ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', '30000000-0000-0000-0000-0000000000e1',
   encode(extensions.digest('key-v', 'sha256'), 'hex'), gen_random_uuid(), '0.1.0'),
  ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', '30000000-0000-0000-0000-0000000000e2',
   encode(extensions.digest('key-w', 'sha256'), 'hex'), gen_random_uuid(), '0.1.0');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- The PC was quiet for 5 minutes, then checks in with the app just started.
create function pg_temp.back_after_gap(p_station uuid, p_key text, p_version text) returns void language plpgsql as $$
begin
  update public.devices set last_seen_at = now() - interval '5 minutes' where station_id = p_station;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform public.agent_sync(p_key, jsonb_build_object('uptime_s', 99999, 'app_uptime_s', 20, 'version', p_version));
  reset role;
end $$;

-- Update commands ------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$ select public.send_station_command('30000000-0000-0000-0000-0000000000e1', 'update') $$,
  'staff can ask one PC to update');
select throws_ok($$ select public.update_all_pcs('20000000-0000-0000-0000-0000000000e0') $$,
  '42501', null, 'only the owner updates every PC at once');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.update_all_pcs('20000000-0000-0000-0000-0000000000e0'), 1,
  'every PC without an update waiting gets one (PC-01 already had one)');
select is(public.update_all_pcs('20000000-0000-0000-0000-0000000000e0'), 0, 'asking again adds nothing');
reset role;

-- Tamper alerts --------------------------------------------------------------------------------
select pg_temp.back_after_gap('30000000-0000-0000-0000-0000000000e1', 'key-v', '0.2.0');
select is((select count(*)::int from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000e1'), 0,
  'the app back as a new version on a free PC was an update, not tampering');
select is((select agent_version from public.devices where station_id = '30000000-0000-0000-0000-0000000000e1'), '0.2.0',
  'and the new version is recorded');

select pg_temp.back_after_gap('30000000-0000-0000-0000-0000000000e2', 'key-w', '0.1.0');
select is((select kind from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000e2'), 'app_closed',
  'the same version back after a gap is still flagged');

select * from finish();
rollback;
