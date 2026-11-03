begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Owner A with staff S in org A; owner B in org B.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'staff-s@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'owner-b@test.local');
insert into public.orgs (id, name) values
  ('10000000-0000-0000-0000-0000000000e1', 'Arena A'),
  ('10000000-0000-0000-0000-0000000000e2', 'Arena B');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'staff'),
  ('10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3', 'owner');
insert into public.branches (id, org_id, name, timezone) values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Main', 'Asia/Kolkata');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A logs rent and S's salary.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$
  insert into public.expenses (org_id, branch_id, category, name, amount, spent_on)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'rent', 'Rent', 30000, '2026-11-01') $$,
  'owner logs an expense');
select lives_ok($$
  insert into public.expenses (org_id, branch_id, category, name, amount, spent_on, staff_id)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'salary', 'Salary · S', 15000,
          '2026-11-01', '00000000-0000-0000-0000-0000000000e2') $$,
  'owner logs a salary for a team member');
select throws_ok($$
  insert into public.expenses (org_id, branch_id, category, name, amount, spent_on, staff_id)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'salary', 'Salary · B', 15000,
          '2026-11-01', '00000000-0000-0000-0000-0000000000e3') $$,
  '23503', null, 'salary must go to a member of the same venue');
select throws_ok($$
  insert into public.expenses (org_id, branch_id, category, name, amount, spent_on, staff_id)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'rent', 'Rent', 100,
          '2026-11-01', '00000000-0000-0000-0000-0000000000e2') $$,
  '23514', null, 'only salaries name a person');
select is((select count(*)::int from public.audit_log where entity = 'expenses'), 2, 'expenses show in the activity log');

-- Staff S can neither read nor add expenses.
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.expenses), 0, 'staff cannot see expenses');
select throws_ok($$
  insert into public.expenses (org_id, branch_id, category, name, amount, spent_on)
  values ('10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'other', 'X', 1, '2026-11-01') $$,
  '42501', null, 'staff cannot add expenses');

-- Owner B sees nothing from org A.
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from public.expenses), 0, 'other venues cannot see expenses');

select * from finish();
rollback;
