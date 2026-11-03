begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Users: A owns org A, B owns org B, S is staff in org A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"full_name":"Owner A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{"full_name":"Owner B"}'),
  ('00000000-0000-0000-0000-00000000000c', 's@test.local', '{"full_name":"Staff S"}');

select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Owner A', 'profile is created from sign-up metadata');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A onboards.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.create_organization('Arena A', 'Main Branch') $$, 'owner A creates org');
select is((select count(*)::int from public.branch_settings), 1, 'branch settings row created');
select is((select gst_enabled from public.branch_settings), false, 'GST is off by default');

select is(
  (select array_agg(name order by sort_order) from public.bulk_create_stations(
     (select id from public.branches limit 1), 'pc', 'PC-', 12)),
  array['PC-01','PC-02','PC-03','PC-04','PC-05','PC-06','PC-07','PC-08','PC-09','PC-10','PC-11','PC-12'],
  'bulk create pads station numbers');

insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  select org_id, id, 'PC Standard', 'pc', 60 from public.branches;
select throws_ok(
  $$ insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
     select org_id, id, 'PC dup', 'pc', 70 from public.branches $$,
  '23505', null, 'only one active plan per type and tier');

-- Owners can't add people directly; S joins org A with an invite code.
select throws_ok(
  $$ insert into public.memberships (org_id, user_id, role)
     select id, '00000000-0000-0000-0000-00000000000c', 'staff' from public.orgs $$,
  '42501', null, 'owner cannot insert memberships directly');
select set_config('test.invite', public.create_invite((select id from public.orgs), 'staff'), true);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select lives_ok($$ select public.accept_invite(current_setting('test.invite')) $$, 'staff S joins with the invite');

-- Owner B onboards and must not see org A.
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.create_organization('Arena B', 'B Branch') $$, 'owner B creates org');
select is((select count(*)::int from public.orgs), 1, 'B sees only its own org');
select is((select count(*)::int from public.stations), 0, 'B sees no stations from org A');
select is((select count(*)::int from public.rate_plans), 0, 'B sees no rate plans from org A');
select throws_ok(
  $$ select public.bulk_create_stations(
       (select id from public.branches b where b.name = 'Main Branch'), 'pc', 'X-', 1) $$,
  '42501', null, 'B cannot add stations to org A (branch is invisible and RPC re-checks)');

-- Staff S: can read org A's floor but not change config or GST.
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.stations), 12, 'staff sees org A stations');
update public.branch_settings set gst_enabled = true;
select is((select gst_enabled from public.branch_settings), false, 'staff cannot toggle GST');
delete from public.stations;
select is((select count(*)::int from public.stations), 12, 'staff cannot delete stations');
select is((select count(*)::int from public.audit_log), 0, 'staff cannot read the audit log');

-- Owner A sees the audit trail of config changes.
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select ok((select count(*) from public.audit_log where entity = 'stations') = 12,
  'owner sees audit entries for created stations');

select * from finish();
rollback;
