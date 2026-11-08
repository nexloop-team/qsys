begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixture: a venue with an owner and a staff member, one snooker table (choices 2 / 4 players,
-- ₹200 / ₹300 per hour, ₹50 / ₹80 per frame) and one PS5 on an older "extra controller" rate.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@frames.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff@frames.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000f0', 'Cue Club');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id, gst_enabled, allowed_modes_by_type)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', false,
          '{"snooker":["open","prepaid","frames"],"ps5":["open","prepaid"]}');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'snooker', 'SNOOKER-1'),
  ('30000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'ps5', 'PS5-1');
insert into public.rate_plans (id, org_id, branch_id, name, station_type, per_hour, per_frame, player_choices) values
  ('50000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0',
   'Snooker', 'snooker', 0, 1,
   '[{"players":4,"per_hour":300,"per_frame":80},{"players":2,"per_hour":200,"per_frame":50}]');
insert into public.rate_plans (id, org_id, branch_id, name, station_type, per_hour, included_players, extra_player_per_hour) values
  ('50000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0',
   'PS5', 'ps5', 100, 1, 50);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.live(p_station uuid) returns uuid language sql as $$
  select id from public.sessions where station_id = p_station and status <> 'ended';
$$;

-- Choices on a rate ------------------------------------------------------------
select is((select per_hour from public.rate_plans where id = '50000000-0000-0000-0000-0000000000f1'), 200.00,
  'the smallest choice becomes the base hourly price');
select is((select per_frame from public.rate_plans where id = '50000000-0000-0000-0000-0000000000f1'), 50.00,
  'and the base frame price');
select is((select player_choices -> 0 ->> 'players' from public.rate_plans where id = '50000000-0000-0000-0000-0000000000f1'), '2',
  'choices are kept sorted by players');
select throws_ok($$
  insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour, player_choices)
  values ('10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'Bad', 'pool', 0,
          '[{"players":0,"per_hour":100}]') $$,
  '23514', null, 'a choice of 0 players is refused');
select throws_ok($$
  update public.rate_plans set player_choices = '[{"players":2,"per_hour":200},{"players":4,"per_hour":300}]'
   where id = '50000000-0000-0000-0000-0000000000f1' $$,
  '22023', null, 'frame billing on needs a frame price on every choice');

-- Frames ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.start_session('30000000-0000-0000-0000-0000000000f1', 'open', '9876500001', 'Asha', 3) $$,
  '22023', null, 'only the listed player choices can start');
select lives_ok($$ select public.start_session('30000000-0000-0000-0000-0000000000f1', 'frames', '9876500001', 'Asha', 4) $$,
  'staff start a 4-player game billed by frame');
select is((select frames from public.sessions where id = (select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended')), 1,
  'the first frame starts with the session');
select is(public.change_session_frames((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended'), 1), 2, '+ Frame counts the next one');
select throws_ok($$ select public.change_session_frames((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended'), 5) $$,
  '22023', null, 'frames change one at a time');
reset role;
select is((private.session_charge(pg_temp.live('30000000-0000-0000-0000-0000000000f1')) ->> 'total')::numeric, 160::numeric,
  '2 frames × ₹80 (the 4-player frame price)');

-- Who pays: the losing side's player takes the bill ---------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.end_session((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended'));
select lives_ok($$
  select public.set_session_payer(
    array(select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status = 'ended'),
    '9876500002', 'Ravi') $$,
  'the bill moves to another player');
reset role;
select is((select customer_name from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1'), 'Ravi',
  'the unpaid session is now Ravi''s (his khata)');
select is((select details ->> 'from' from public.session_events where kind = 'payer'
            and session_id = (select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1')),
  'Asha', 'the change is logged with the previous player');

-- Khata limit -------------------------------------------------------------------------
update public.branch_settings set credit_limit = 100 where branch_id = '20000000-0000-0000-0000-0000000000f0';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.start_session('30000000-0000-0000-0000-0000000000f2', 'open', '9876500002') $$,
  '22023', null, 'staff can''t start a player who owes more than the khata limit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select public.set_player_credit_limit(
    (select id from public.customers where phone = '9876500002' and org_id = '10000000-0000-0000-0000-0000000000f0'), 500) $$,
  'the owner raises Ravi''s own limit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$ select public.start_session('30000000-0000-0000-0000-0000000000f2', 'open', '9876500002', null, 2) $$,
  'with his own higher limit, staff can start him');
select public.end_session((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f2' and status <> 'ended'));
reset role;

-- Hourly price by choice, with happy hour ----------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.start_session('30000000-0000-0000-0000-0000000000f1', 'open', '9876500003', 'Kiran', 4);
reset role;
update public.sessions set started_at = '2026-11-10 12:00:00+05:30'
 where id = pg_temp.live('30000000-0000-0000-0000-0000000000f1');
select is((private.session_charge(pg_temp.live('30000000-0000-0000-0000-0000000000f1'), '2026-11-10 13:00:00+05:30') ->> 'total')::numeric,
  300::numeric, '1 hour with 4 players = ₹300');
insert into public.rate_rules (org_id, rate_plan_id, name, start_time, end_time, per_hour)
  values ('10000000-0000-0000-0000-0000000000f0', '50000000-0000-0000-0000-0000000000f1', 'Happy hour', '10:00', '16:00', 100);
select is((private.session_charge(pg_temp.live('30000000-0000-0000-0000-0000000000f1'), '2026-11-10 13:00:00+05:30') ->> 'total')::numeric,
  200::numeric, 'happy hour moves the base; 4 players keep their ₹100 gap');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.set_session_players((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended'), 3) $$,
  '22023', null, 'players can only change to another choice');
select lives_ok($$ select public.set_session_players((select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f1' and status <> 'ended'), 2) $$,
  'down to 2 players');
reset role;
select is((private.session_charge(pg_temp.live('30000000-0000-0000-0000-0000000000f1'), '2026-11-10 13:00:00+05:30') ->> 'total')::numeric,
  100::numeric, '2 players in happy hour = the happy-hour price');

-- Older rate: extra controller per hour still works ---------------------------------------
update public.sessions set started_at = ended_at - interval '1 hour'
 where station_id = '30000000-0000-0000-0000-0000000000f2';
select is((select (private.session_charge(s.id) ->> 'total')::numeric
             from public.sessions s where s.station_id = '30000000-0000-0000-0000-0000000000f2'),
  150::numeric, 'PS5: ₹100/hr + ₹50/hr for the second controller');

select * from finish();
rollback;
