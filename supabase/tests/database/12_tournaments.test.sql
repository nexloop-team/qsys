begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Fixture: a staff member and a ₹100-entry snooker knockout.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'staff@cup.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000c0', 'Cup Club');
insert into public.memberships (org_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000c2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id, gst_enabled)
  values ('20000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0', false);
insert into public.tournaments (id, org_id, branch_id, name, game, entry_fee)
  values ('70000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c0',
          '20000000-0000-0000-0000-0000000000c0', 'Sunday Cup', 'Snooker', 100);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select lives_ok($$ select public.create_tournament('20000000-0000-0000-0000-0000000000c0', 'Friday FIFA', 'FIFA', 0) $$,
  'staff create a tournament');
select lives_ok($$
  select public.add_tournament_player('70000000-0000-0000-0000-0000000000c1', '98765000' || lpad(n::text, 2, '0'), 'Player ' || n)
    from generate_series(1, 5) n $$,
  'five players join by mobile');
select throws_ok($$ select public.add_tournament_player('70000000-0000-0000-0000-0000000000c1', '9876500001') $$,
  '22023', null, 'a player joins once');
select lives_ok($$ select public.pay_tournament_entry(
    (select id from public.tournament_players where phone = '9876500001'), '[{"method":"cash","amount":100}]') $$,
  'player 1 pays the ₹100 entry');
select throws_ok($$ select public.remove_tournament_player((select id from public.tournament_players where phone = '9876500001')) $$,
  '22023', null, 'a paid player can''t just be removed');
select throws_ok($$ select public.set_match_winner(gen_random_uuid(), null) $$,
  '42501', null, 'results need a real match');
select lives_ok($$ select public.start_tournament('70000000-0000-0000-0000-0000000000c1') $$, 'the draw is made');
reset role;

select is((select total from public.invoices where id = (select invoice_id from public.tournament_players where phone = '9876500001')),
  100.00, 'the entry fee is a normal bill');
select is((select count(*)::int from public.tournament_matches where tournament_id = '70000000-0000-0000-0000-0000000000c1'),
  7, '5 players make an 8-slot draw: 4 + 2 + 1 matches');
select is((select count(*)::int from public.tournament_matches
            where tournament_id = '70000000-0000-0000-0000-0000000000c1' and round = 1 and player2_id is null),
  3, 'three byes');
select is((select count(*)::int from public.tournament_matches
            where tournament_id = '70000000-0000-0000-0000-0000000000c1' and round = 2 and player1_id is null and player2_id is null),
  0, 'byes are spread: no round-2 match is left waiting on two byes');

-- Play it out: player 1 of every ready match wins.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
do $$
declare
  m record;
begin
  loop
    select id, player1_id into m from public.tournament_matches
     where tournament_id = '70000000-0000-0000-0000-0000000000c1'
       and winner_id is null and player1_id is not null and player2_id is not null
     order by round, slot limit 1;
    exit when not found;
    perform public.set_match_winner(m.id, m.player1_id);
  end loop;
end $$;
select throws_ok($$ select public.set_match_winner(
    (select id from public.tournament_matches where tournament_id = '70000000-0000-0000-0000-0000000000c1'
      and round = 2 and slot = 0), null) $$,
  '22023', null, 'a result can''t be undone once the next round is played');
reset role;

select is((select status from public.tournaments where id = '70000000-0000-0000-0000-0000000000c1'), 'finished',
  'the final decides the tournament');
select is((select winner_id from public.tournaments where id = '70000000-0000-0000-0000-0000000000c1'),
  (select winner_id from public.tournament_matches where tournament_id = '70000000-0000-0000-0000-0000000000c1' and round = 3),
  'the tournament winner is the final''s winner');

select * from finish();
rollback;
