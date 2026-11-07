begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'sort-owner@test.local');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000a9', 'Arena S');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'owner');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'Main', 'Asia/Kolkata');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', 'pc', 'PC-01');
insert into public.rate_plans (id, org_id, branch_id, name, station_type, per_hour)
  values ('40000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', 'PC', 'pc', 60);
insert into public.customers (id, org_id, phone, name) values
  ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a9', '9000000001', 'Big Spender'),
  ('60000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a9', '9000000002', 'Owes Money'),
  ('60000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a9', '9000000003', 'Wrote Off');

-- Spender: ₹500 paid, last week. Owes: ₹80 unpaid, today. Wrote Off: ₹40 written off, yesterday.
insert into public.sessions (org_id, branch_id, station_id, rate_plan_id, mode, status, started_at, ended_at,
                             customer_id, charge_amount, billed_amount, written_off) values
  ('10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', '30000000-0000-0000-0000-0000000000a9',
   '40000000-0000-0000-0000-0000000000a9', 'open', 'ended', now() - interval '7 days', now() - interval '7 days' + interval '1 hour',
   '60000000-0000-0000-0000-0000000000a1', 500, 500, false),
  ('10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', '30000000-0000-0000-0000-0000000000a9',
   '40000000-0000-0000-0000-0000000000a9', 'open', 'ended', now() - interval '2 hours', now() - interval '1 hour',
   '60000000-0000-0000-0000-0000000000a2', 80, 0, false),
  ('10000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000a9', '30000000-0000-0000-0000-0000000000a9',
   '40000000-0000-0000-0000-0000000000a9', 'open', 'ended', now() - interval '1 day', now() - interval '1 day' + interval '1 hour',
   '60000000-0000-0000-0000-0000000000a3', 40, 0, true);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}', true);

select is((select name from public.list_customers('10000000-0000-0000-0000-0000000000a9', null, 1, 0, 'recent')),
  'Owes Money', 'recent: latest visit first');
select is((select name from public.list_customers('10000000-0000-0000-0000-0000000000a9', null, 1, 0, 'spent')),
  'Big Spender', 'spent: biggest spender first');
select is((select count(*)::int from public.list_customers('10000000-0000-0000-0000-0000000000a9', null, 50, 0, 'owes')),
  1, 'owes: only players with unpaid, not written-off sessions');
select is((select owed from public.list_customers('10000000-0000-0000-0000-0000000000a9', null, 50, 0, 'owes')),
  80::numeric, 'owed amount is the unpaid balance');
select throws_ok($$ select * from public.list_customers('10000000-0000-0000-0000-0000000000a9', null, 5, 0, 'bogus') $$,
  '22023', null, 'unknown sort is rejected');

select * from finish();
rollback;
