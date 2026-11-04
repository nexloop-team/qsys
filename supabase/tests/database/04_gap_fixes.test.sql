begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Fixture: org with owner O and staff S, one branch, one PS5 with a plan, and players.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner-g@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff-g@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'outsider-g@test.local');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000f1', 'Arena G');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'ps5', 'PS5-1');
insert into public.rate_plans (id, org_id, branch_id, name, station_type, per_hour, included_players, extra_player_per_hour)
  values ('40000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1',
          '20000000-0000-0000-0000-0000000000f1', 'PS5', 'ps5', 100, 1, 40);
insert into public.customers (id, org_id, phone, name)
  select ('60000000-0000-0000-0000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid,
         '10000000-0000-0000-0000-0000000000f1', '98765432' || lpad(i::text, 2, '0'), 'Player ' || i
    from generate_series(1, 12) i;

-- Player 1: two ended sessions (₹100 paid, ₹50 owed) and one live session.
insert into public.sessions (id, org_id, branch_id, station_id, rate_plan_id, mode, status, started_at, ended_at,
                             customer_id, charge_amount, billed_amount, players) values
  ('50000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1',
   '30000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-0000000000f1', 'open', 'ended',
   now() - interval '3 hours', now() - interval '2 hours', '60000000-0000-0000-0000-000000000001', 100, 100, 1),
  ('50000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1',
   '30000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-0000000000f1', 'open', 'ended',
   now() - interval '90 minutes', now() - interval '60 minutes', '60000000-0000-0000-0000-000000000001', 50, 0, 1);
insert into public.sessions (id, org_id, branch_id, station_id, rate_plan_id, mode, status, started_at, customer_id, players)
  values ('50000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000f1',
          '20000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-0000000000f1',
          '40000000-0000-0000-0000-0000000000f1', 'open', 'running', now() - interval '20 minutes',
          '60000000-0000-0000-0000-000000000001', 1);

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');

-- Players list pages through everyone and reports the total.
select is((select count(*)::int from public.list_customers('10000000-0000-0000-0000-0000000000f1', null, 5, 0)), 5,
  'first page has 5 players');
select is((select count(*)::int from public.list_customers('10000000-0000-0000-0000-0000000000f1', null, 5, 10)), 2,
  'last page has the remaining 2');
select is((select max(total_count)::int from public.list_customers('10000000-0000-0000-0000-0000000000f1', null, 5, 10)), 12,
  'every row carries the full total');

-- Player summary is exact and lifetime.
select is((public.player_summary('60000000-0000-0000-0000-000000000001') ->> 'visits')::int, 3, 'summary counts all visits');
select is((public.player_summary('60000000-0000-0000-0000-000000000001') ->> 'paid')::numeric, 100::numeric, 'summary sums paid');
select is((public.player_summary('60000000-0000-0000-0000-000000000001') ->> 'owed')::numeric, 50::numeric, 'summary sums owed');

-- Staff can change controllers on a live session; it is logged.
select lives_ok($$ select public.set_session_players('50000000-0000-0000-0000-0000000000f3', 3) $$,
  'staff adds controllers mid-session');
select is((select players from public.sessions where id = '50000000-0000-0000-0000-0000000000f3'), 3, 'player count updated');
select throws_ok($$ select public.set_session_players('50000000-0000-0000-0000-0000000000f1', 2) $$,
  '22023', null, 'ended sessions cannot change');

-- Someone outside the venue cannot.
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$ select public.set_session_players('50000000-0000-0000-0000-0000000000f3', 1) $$,
  '42501', null, 'outsiders cannot change sessions');

select * from finish();
rollback;
