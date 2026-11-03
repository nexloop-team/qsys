begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Fixture: one org/branch (Asia/Kolkata), ₹60/hr PC plan, staff + owner users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@test.local');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-000000000001', 'Test Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'pc', 'PC-01'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'pc', 'PC-02');
insert into public.rate_plans (id, org_id, branch_id, name, station_type, per_hour, included_players, extra_player_per_hour)
  values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'PC', 'pc', 60, 1, 30);

-- Helper: an ended open session from start to end, returns its total.
create function pg_temp.charge(p_start timestamptz, p_end timestamptz,
  p_mode public.session_mode default 'open', p_prepaid_min int default 0, p_prepaid_amt numeric default 0,
  p_players int default 1)
returns numeric language plpgsql as $$
declare v_id uuid;
begin
  insert into public.sessions (org_id, branch_id, station_id, rate_plan_id, mode, status, started_at, ended_at,
    planned_end_at, prepaid_minutes, prepaid_amount, players)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', p_mode, 'ended',
          p_start, p_end, case when p_mode = 'prepaid' then p_start + make_interval(mins => p_prepaid_min) end,
          p_prepaid_min, p_prepaid_amt, p_players)
  returning id into v_id;
  return (private.session_charge(v_id) ->> 'total')::numeric;
end $$;

-- Pricing
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 10:37+05:30'), 37::numeric,
  'exact minutes: 37 min at ₹60/hr = ₹37');

update public.rate_plans set rounding_minutes = 15 where id = '40000000-0000-0000-0000-000000000001';
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 10:37+05:30'), 45::numeric,
  'rounded up to 15-min blocks: 37 min bills as 45');

update public.rate_plans set rounding_minutes = 1, min_minutes = 30 where id = '40000000-0000-0000-0000-000000000001';
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 10:10+05:30'), 30::numeric,
  'minimum charge: 10 min bills as 30');
update public.rate_plans set min_minutes = 0 where id = '40000000-0000-0000-0000-000000000001';

-- Pauses are not billed.
do $$
declare v_id uuid;
begin
  insert into public.sessions (id, org_id, branch_id, station_id, rate_plan_id, mode, status, started_at, ended_at)
  values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
          '40000000-0000-0000-0000-000000000001', 'open', 'ended', '2026-11-02 10:00+05:30', '2026-11-02 11:00+05:30');
  insert into public.session_pauses (org_id, session_id, started_at, ended_at)
  values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
          '2026-11-02 10:20+05:30', '2026-11-02 10:40+05:30');
end $$;
select is((private.session_charge('50000000-0000-0000-0000-000000000001') ->> 'total')::numeric, 40::numeric,
  '20 min pause inside a 60 min session bills 40 min');

-- Happy hour 12:00–16:00 at ₹30/hr; session 15:30–16:30 IST = 30 min @30 + 30 min @60.
insert into public.rate_rules (org_id, rate_plan_id, name, start_time, end_time, per_hour)
values ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Happy hour', '12:00', '16:00', 30);
select is(pg_temp.charge('2026-11-02 15:30+05:30', '2026-11-02 16:30+05:30'), 45::numeric,
  'happy hour applies only to the minutes inside it');

-- Overnight rule 22:00–02:00 at ₹120/hr; session 23:30–00:30 IST is fully inside it.
insert into public.rate_rules (org_id, rate_plan_id, name, start_time, end_time, per_hour)
values ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Night', '22:00', '02:00', 120);
select is(pg_temp.charge('2026-11-02 23:30+05:30', '2026-11-03 00:30+05:30'), 120::numeric,
  'a rule that crosses midnight covers both sides of it');
delete from public.rate_rules;

-- Prepaid: 60 min for ₹50, grace 2 min.
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 11:01+05:30', 'prepaid', 60, 50), 50::numeric,
  'prepaid: 1 min over is within grace');
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 11:10+05:30', 'prepaid', 60, 50), 60::numeric,
  'prepaid: 10 min overtime billed at ₹60/hr on top of the package');

-- Early end, "charge time played": 30 of 60 booked min → ₹30; 110 of 120 booked (₹100 deal) → capped at ₹100.
update public.branch_settings set early_end_policy = 'played';
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 10:30+05:30', 'prepaid', 60, 50), 30::numeric,
  'early end: pays for 30 min played');
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 11:50+05:30', 'prepaid', 120, 100), 100::numeric,
  'early end: never more than the booking price');
update public.branch_settings set early_end_policy = 'full';
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 10:30+05:30', 'prepaid', 60, 50), 50::numeric,
  'early end with "full booking": pays the booking');

-- Extra players: 2 players, 1 included, +₹30/hr each → 60 min = 60 + 30.
select is(pg_temp.charge('2026-11-02 10:00+05:30', '2026-11-02 11:00+05:30', 'open', 0, 0, 2), 90::numeric,
  'extra player charge');

-- Staff flow through RPCs.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

select throws_ok(
  $$ select public.start_session('30000000-0000-0000-0000-000000000001', 'open', '98765 43210') $$,
  '22023', null, 'a new mobile number needs a name');
select lives_ok(
  $$ select public.start_session('30000000-0000-0000-0000-000000000001', 'open', '+91 98765 43210', 'Rahul') $$,
  'staff starts a pay-later session for a new player');
select is((select count(*)::int from public.customers where phone = '9876543210' and name = 'Rahul'), 1,
  'player account created once, mobile normalised to 10 digits');
select throws_ok(
  $$ select public.start_session('30000000-0000-0000-0000-000000000001', 'open', '9876543210') $$,
  '23505', null, 'cannot start a second live session on the same station');
select throws_ok(
  $$ select public.start_session('30000000-0000-0000-0000-000000000002', 'prepaid', '9876543210', null, 1, null, 60,
       '[{"method":"cash","amount":10}]') $$,
  '22023', null, 'fixed time paid up front must match the price (returning player, no name needed)');

-- End it and check out with GST on (inclusive 18%): charge is whatever the clock says; make it ₹118.
reset role;
update public.sessions set started_at = now() - interval '118 minutes'
 where station_id = '30000000-0000-0000-0000-000000000001' and status = 'running';
update public.branch_settings set gst_enabled = true, gstin = '27ABCDE1234F1Z5', prices_include_tax = true;
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

select is(
  (public.end_session((select id from public.sessions where station_id = '30000000-0000-0000-0000-000000000001' and status = 'running')) ->> 'total')::numeric,
  118::numeric, 'end_session fixes the charge');

select lives_ok($$
  select public.checkout(
    array(select id from public.sessions where station_id = '30000000-0000-0000-0000-000000000001'),
    0, '[{"method":"cash","amount":118}]')
$$, 'checkout with matching cash payment');

select results_eq(
  $$ select taxable_amount, cgst, sgst, total, number from public.invoices order by created_at desc limit 1 $$,
  $$ values (100.00::numeric(10,2), 9.00::numeric(10,2), 9.00::numeric(10,2), 118.00::numeric(10,2), 'INV-00001'::text) $$,
  'inclusive GST splits ₹118 into ₹100 + 9 CGST + 9 SGST; first GST bill is INV-00001');

select is((select outstanding from public.sessions where station_id = '30000000-0000-0000-0000-000000000001'),
  0::numeric(10,2), 'session is fully paid after checkout');

select throws_ok(
  $$ select public.write_off_session((select id from public.sessions where station_id = '30000000-0000-0000-0000-000000000001'), 'test') $$,
  '42501', null, 'staff cannot write off');

-- GST off: plain receipt series.
reset role;
update public.branch_settings set gst_enabled = false;
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select lives_ok($$
  select public.start_session('30000000-0000-0000-0000-000000000001', 'prepaid', '9876543210', null, 1, null, 30,
    '[{"method":"upi","amount":30}]')
$$, 'prepaid start with UPI payment');
select is((select count(*)::int from public.invoices where number = 'INVR-00001' and total = 30), 1,
  'with GST off, bills use the receipt series');

select * from finish();
rollback;
