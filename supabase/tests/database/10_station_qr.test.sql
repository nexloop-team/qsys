begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixture: a staff member, a PS5 (₹120/hr) whose QR code is 'abcdef123456', and cola at ₹40 (5 in stock).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'staff@qr.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000a0', 'QR Arena');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000a2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-0000000000a0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id, gst_enabled)
  values ('20000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-0000000000a0', false);
insert into public.stations (id, org_id, branch_id, type, name, public_code)
  values ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a0',
          '20000000-0000-0000-0000-0000000000a0', 'ps5', 'PS5-1', 'abcdef123456');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000a0', '20000000-0000-0000-0000-0000000000a0', 'PS5', 'ps5', 120);
insert into public.products (id, org_id, branch_id, name, category, price, stock)
  values ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a0',
          '20000000-0000-0000-0000-0000000000a0', 'Cola', 'beverage', 40, 5);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- Off until the owner turns it on ------------------------------------------------------
select pg_temp.as_anon();
select is(public.public_station('abcdef123456') ->> 'ok', 'false', 'the page is off by default');
reset role;
update public.branch_settings set qr_enabled = true where branch_id = '20000000-0000-0000-0000-0000000000a0';

select pg_temp.as_anon();
select is(public.public_station('abcdef123456') ->> 'ok', 'true', 'on: the page opens');
select is(public.public_station('abcdef123456') -> 'session', 'null'::jsonb, 'no session yet');
select is(public.public_station('000000000000') ->> 'ok', 'false', 'an unknown code shows nothing');
select throws_ok($$ select public.public_station_request('abcdef123456', 'call') $$,
  '22023', null, 'no requests without a running session');
reset role;

-- A player on a fixed-time hour --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.start_session('30000000-0000-0000-0000-0000000000a1', 'prepaid', '9876500001', 'Asha Patil', 1, null, 60);
reset role;

select pg_temp.as_anon();
select is(public.public_station('abcdef123456') #>> '{session,name}', 'Asha', 'first name only');
select lives_ok($$ select public.public_station_request('abcdef123456', 'snack', '60000000-0000-0000-0000-0000000000a1', 2) $$,
  'the player orders 2 colas');
select lives_ok($$ select public.public_station_request('abcdef123456', 'extend') $$, 'and asks for 30 more minutes');
select throws_ok($$ select public.public_station_request('abcdef123456', 'extend') $$,
  '22023', null, 'one time request at a time');
select throws_ok($$ select * from public.station_requests $$, '42501', null, 'players can''t read requests directly');
reset role;
select is((select count(*)::int from public.session_items si join public.sessions s on s.id = si.session_id
            where s.station_id = '30000000-0000-0000-0000-0000000000a1'), 0, 'nothing is billed until staff accept');

-- Staff accept --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.handle_station_request(
    (select id from public.station_requests where kind = 'snack' and status = 'pending'), true) $$,
  'staff accept the snack order');
select throws_ok($$ select public.handle_station_request(
    (select id from public.station_requests where kind = 'snack'), true) $$,
  '22023', null, 'a request is handled once');
select public.handle_station_request((select id from public.station_requests where kind = 'extend' and status = 'pending'), true);
reset role;

select is((select stock from public.products where id = '60000000-0000-0000-0000-0000000000a1'), 3, 'stock went down by 2');
select is((select prepaid_minutes from public.sessions where station_id = '30000000-0000-0000-0000-0000000000a1' and status <> 'ended'),
  90, 'the booking grew to 90 minutes');
select pg_temp.as_anon();
select is((public.public_station('abcdef123456') #>> '{session,due}')::numeric, 260::numeric,
  'the page shows ₹180 time + ₹80 colas');
select public.public_station_request('abcdef123456', 'call');
reset role;

-- Ending the session closes what's still open --------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.end_session((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000a1' and status <> 'ended'));
select throws_ok($$ select public.reset_station_code('30000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'only the owner can replace a QR code');
reset role;
select is((select status from public.station_requests where kind = 'call'), 'declined', 'the open staff call closed with the session');

select * from finish();
rollback;
