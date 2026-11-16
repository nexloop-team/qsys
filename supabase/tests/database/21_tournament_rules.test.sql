begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Fixture: a venue with 12 PCs and a 5 v 5 Valorant tournament of 4 teams (two first-round matches).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000c71', 'owner@cup.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-000000000c70', 'Cup Arena');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-000000000c70', '00000000-0000-0000-0000-000000000c71', 'owner');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-000000000c70', '10000000-0000-0000-0000-000000000c70', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-000000000c70', '10000000-0000-0000-0000-000000000c70');
insert into public.stations (org_id, branch_id, type, name, sort_order)
select '10000000-0000-0000-0000-000000000c70', '20000000-0000-0000-0000-000000000c70', 'pc', 'PC-' || lpad(n::text, 2, '0'), n
  from generate_series(1, 12) n;
insert into public.stations (org_id, branch_id, type, name)
  values ('10000000-0000-0000-0000-000000000c70', '20000000-0000-0000-0000-000000000c70', 'ps5', 'PS5-1');

create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000c71', 'role', 'authenticated')::text, true);
$$;
create function pg_temp.pcs(p_from int, p_to int) returns uuid[] language sql as $$
  select array_agg(id order by sort_order) from public.stations
   where branch_id = '20000000-0000-0000-0000-000000000c70' and type = 'pc' and sort_order between p_from and p_to;
$$;
create function pg_temp.match(p_slot int) returns uuid language sql as $$
  select m.id from public.tournament_matches m join public.tournaments t on t.id = m.tournament_id
   where t.branch_id = '20000000-0000-0000-0000-000000000c70' and m.round = 1 and m.slot = p_slot;
$$;

select is(public.stations_per_match('pc', 5), 10, 'a 5 v 5 on PCs takes 10 PCs, one per player');
select is(public.stations_per_match('ps5', 2), 1, 'a 2 v 2 on a console is played on one console');
select is(public.stations_per_match('snooker', 2), 1, 'doubles snooker is still one table');

select pg_temp.as_owner();
select set_config('test.cup', public.create_tournament('20000000-0000-0000-0000-000000000c70', 'Valorant Cup', 'Valorant',
  0, null, null, 5, 'pc')::text, true);
select public.add_tournament_player(current_setting('test.cup')::uuid, '98765000' || lpad(n::text, 2, '0'), 'Captain ' || n, 'Team ' || n)
  from generate_series(1, 4) n;
select public.start_tournament(current_setting('test.cup')::uuid);

select throws_ok($$ select public.set_match_stations(pg_temp.match(0), pg_temp.pcs(1, 11)) $$,
  '22023', null, 'eleven PCs is too many for a 5 v 5');
select throws_ok($$ select public.set_match_stations(pg_temp.match(0),
    array(select id from public.stations where name = 'PS5-1')) $$,
  '22023', null, 'a PS5 can''t seat a PC match');
select lives_ok($$ select public.set_match_stations(pg_temp.match(0), pg_temp.pcs(1, 10)) $$,
  'the first match is seated on PC-01 to PC-10');
select throws_ok($$ select public.set_match_stations(pg_temp.match(1), pg_temp.pcs(9, 12)) $$,
  '22023', null, 'the other match can''t use PC-09 and PC-10 while the first is being played');

select public.set_match_winner(pg_temp.match(0),
  (select player1_id from public.tournament_matches where id = pg_temp.match(0)), '13-9');
reset role;
select is((select score from public.tournament_matches where id = pg_temp.match(0)), '13-9', 'the score is kept');

select pg_temp.as_owner();
select lives_ok($$ select public.set_match_stations(pg_temp.match(1), pg_temp.pcs(1, 10)) $$,
  'once the first match is decided, its PCs are free for the next one');
select public.set_match_winner(pg_temp.match(0), null);
reset role;
select is((select score from public.tournament_matches where id = pg_temp.match(0)), null::text, 'undoing a result clears its score');

select * from finish();
rollback;
