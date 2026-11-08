begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fixture: a venue open 10:00–23:00 with two snooker tables and the booking page at /book/cue-club.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'staff@book.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000b0', 'Book Club');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2', 'staff');
insert into public.branches (id, org_id, name, timezone, opening_time, closing_time)
  values ('20000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000b0', 'Main', 'Asia/Kolkata', '10:00', '23:00');
insert into public.branch_settings (branch_id, org_id, station_types, booking_enabled, booking_slug)
  values ('20000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000b0', '{snooker}', true, 'cue-club');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b0', '20000000-0000-0000-0000-0000000000b0', 'snooker', 'TABLE-1'),
  ('30000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b0', '20000000-0000-0000-0000-0000000000b0', 'snooker', 'TABLE-2');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
-- Tomorrow at a local time, as an instant.
create function pg_temp.tomorrow(p_time text) returns timestamptz language sql as $$
  select (((now() at time zone 'Asia/Kolkata')::date + 1) + p_time::time) at time zone 'Asia/Kolkata';
$$;
create temp table t (k text primary key, v timestamptz);
insert into t values ('18:00', pg_temp.tomorrow('18:00')), ('18:10', pg_temp.tomorrow('18:10')),
                     ('20:00', pg_temp.tomorrow('20:00')), ('22:30', pg_temp.tomorrow('22:30'));
grant select on t to anon, authenticated;

-- The public page ------------------------------------------------------------------------
select pg_temp.as_anon();
select is(public.public_booking_info('Cue-Club') #>> '{types,0,count}', '2', 'the page lists 2 snooker tables');
select is((select (x ->> 'free')::int from jsonb_array_elements(public.public_booking_slots('cue-club', 'snooker',
             ((now() at time zone 'Asia/Kolkata')::date + 1), 60)) x where x ->> 'time' = '18:00'), 2,
  'tomorrow 18:00 has 2 tables free');
select lives_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '18:00'), 60, 2,
                     'Asha', '98765 00001') $$, 'a player books 18:00 for an hour');
select lives_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '18:00'), 60, 4,
                     'Ravi', '9876500002') $$, 'another player takes the second table');
select throws_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '18:00'), 60, 2,
                     'Kiran', '9876500003') $$, '22023', null, 'a full slot can''t be booked');
select throws_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '18:10'), 60, 2,
                     'Kiran', '9876500003') $$, '22023', null, 'only :00 and :30 slots');
select throws_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '22:30'), 60, 2,
                     'Kiran', '9876500003') $$, '22023', null, 'a booking must end by closing time');
select lives_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '20:00'), 60, 2,
                     'Asha', '9876500001') $$, 'a second booking for the same player');
select throws_ok($$ select public.public_create_booking('cue-club', 'snooker', (select v from t where k = '20:00') + interval '1 hour',
                     60, 2, 'Asha', '9876500001') $$, '22023', null, 'two upcoming bookings per mobile at most');
select throws_ok($$ select * from public.bookings $$, '42501', null, 'the public can''t read bookings');
reset role;

-- Staff -------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.set_booking_status((select id from public.bookings where name = 'Asha' order by starts_at limit 1),
                     'confirmed', '30000000-0000-0000-0000-0000000000b1') $$, 'staff confirm Asha on TABLE-1');
select throws_ok($$ select public.set_booking_status((select id from public.bookings where name = 'Ravi'),
                     'confirmed', '30000000-0000-0000-0000-0000000000b1') $$, '22023', null, 'TABLE-1 can''t be double-booked');
select public.set_booking_status((select id from public.bookings where name = 'Ravi'), 'cancelled');
reset role;
select is((select count(*)::int from public.customers where org_id = '10000000-0000-0000-0000-0000000000b0' and phone = '9876500001'),
  1, 'a confirmed booking adds the player to the venue''s list');

select pg_temp.as_anon();
select is((select (x ->> 'free')::int from jsonb_array_elements(public.public_booking_slots('cue-club', 'snooker',
             ((now() at time zone 'Asia/Kolkata')::date + 1), 60)) x where x ->> 'time' = '18:00'), 1,
  'a cancelled booking frees its table');
reset role;

update public.branch_settings set booking_enabled = false where branch_id = '20000000-0000-0000-0000-0000000000b0';
select pg_temp.as_anon();
select is(public.public_booking_info('cue-club') ->> 'ok', 'false', 'the owner can turn the page off');
reset role;

select * from finish();
rollback;
