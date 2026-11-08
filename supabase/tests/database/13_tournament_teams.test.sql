begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Fixture: a staff member, a PC and a PS5, and a ₹500-per-team Valorant 5v5 on PCs.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d2', 'staff@teams.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000d0', 'Team Arena');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000d2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id, gst_enabled)
  values ('20000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0', false);
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d0',
          '20000000-0000-0000-0000-0000000000d0', 'pc', 'PC-01'),
         ('30000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d0',
          '20000000-0000-0000-0000-0000000000d0', 'ps5', 'PS5-1');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

create temp table t (id uuid);
grant all on t to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
insert into t select public.create_tournament('20000000-0000-0000-0000-0000000000d0', 'Valorant Night', 'Valorant', 500,
                                              null, null, 5, 'pc');
select ok((select id from t) is not null, 'staff create a 5-a-side PC tournament');

select throws_ok($$ select public.add_tournament_player((select id from t), '9876600001', 'Captain One') $$,
  '22023', null, 'a team needs a name');
select lives_ok($$ select public.add_tournament_player((select id from t), '9876600001', 'Captain One', 'Night Owls',
                                                       array['Ravi', ' ', 'Sam', 'Neha', 'Om']) $$,
  'a team joins with a captain and four members (blanks dropped)');
select throws_ok($$ select public.add_tournament_player((select id from t), '9876600002', 'Captain Two', 'night owls') $$,
  '22023', null, 'team names are unique, ignoring case');
select throws_ok($$ select public.add_tournament_player((select id from t), '9876600003', 'Captain Three', 'Big Squad',
                                                        array['a1', 'a2', 'a3', 'a4', 'a5']) $$,
  '22023', null, 'a team can''t be bigger than the team size');
select lives_ok($$ select public.add_tournament_player((select id from t), '9876600004', 'Captain Four', 'Late Shift') $$,
  'a team can join with just its captain');
select lives_ok($$ select public.pay_tournament_entry(
    (select id from public.tournament_players where team_name = 'Night Owls'), '[{"method":"cash","amount":500}]') $$,
  'the team pays one ₹500 entry');
select lives_ok($$ select public.start_tournament((select id from t)) $$, 'the draw is made');
select throws_ok($$ select public.set_match_station((select id from public.tournament_matches where tournament_id = (select id from t)),
                                                    '30000000-0000-0000-0000-0000000000d2') $$,
  '22023', null, 'a PC tournament''s match can''t go on a PS5');
select lives_ok($$ select public.set_match_station((select id from public.tournament_matches where tournament_id = (select id from t)),
                                                   '30000000-0000-0000-0000-0000000000d1') $$,
  'the match is sent to PC-01');
reset role;

select is((select members from public.tournament_players where team_name = 'Night Owls'),
  array['Ravi', 'Sam', 'Neha', 'Om'], 'members are stored as names, the captain is the player');

select * from finish();
rollback;
