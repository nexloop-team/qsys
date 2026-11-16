-- Tournaments the way venues run them:
--   1. A match gets as many stations as it needs, not always one: on PCs every player has their own
--      PC (a 5 v 5 match takes 10), consoles seat singles and doubles on one console (bigger teams
--      play one per player), and snooker, pool and the rest use one table per match.
--   2. A station can't be in two matches that are both being played. (The same table can still be
--      booked for a later round.)
--   3. A result can carry a score ("3-1", "W/O" for a no-show).
-- Apply after 20261204000002_pc_updates.sql.

alter table public.tournament_matches
  add column station_ids uuid[] not null default '{}',
  add column score text check (score is null or char_length(score) between 1 and 20);
update public.tournament_matches set station_ids = array[station_id] where station_id is not null;

-- How many stations one match takes (0 when the tournament isn't linked to a kind of station).
create function public.stations_per_match(p_type public.station_type, p_team_size int) returns int
language sql immutable set search_path = '' as $$
  select case
    when p_type is null then 0
    when p_type = 'pc' then 2 * p_team_size
    when p_type in ('ps5', 'xbox') then case when p_team_size <= 2 then 1 else 2 * p_team_size end
    else 1
  end;
$$;

-- Where a match is played: its stations, in seat order (the first half for the top entry, the
-- second half for the bottom one, when each player has their own). An empty list clears it.
create function public.set_match_stations(p_match_id uuid, p_station_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  v_ids uuid[];
  v_need int;
  v_bad text;
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.' using errcode = '22023';
  end if;
  select * into t from public.tournaments where id = m.tournament_id;
  perform private.assert_member(t.org_id);
  if t.status = 'finished' then
    raise exception 'The tournament is over.' using errcode = '22023';
  end if;
  if m.winner_id is not null then
    raise exception 'This match is already decided.' using errcode = '22023';
  end if;

  -- Same order as given, each station once.
  select coalesce(array_agg(id order by first), '{}') into v_ids
    from (select id, min(ord) as first from unnest(coalesce(p_station_ids, '{}')) with ordinality u(id, ord)
           where id is not null group by id) x;
  v_need := public.stations_per_match(t.station_type, t.team_size);
  if cardinality(v_ids) > 0 and v_need = 0 then
    raise exception 'Say what the tournament is played on first.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > v_need then
    raise exception 'A match here takes % %.', v_need,
      case when t.station_type = 'pc' then 'PCs (one per player)' when v_need = 1 then 'station' else 'stations' end
      using errcode = '22023';
  end if;

  select string_agg(coalesce(st.name, 'A station'), ', ') into v_bad
    from unnest(v_ids) i(id)
    left join public.stations st on st.id = i.id
   where st.id is null or st.branch_id <> t.branch_id or st.type is distinct from t.station_type;
  if v_bad is not null then
    raise exception '% can''t be used: pick % at this branch.', v_bad,
      lower(case t.station_type when 'pc' then 'PCs' when 'ps5' then 'PS5s' when 'xbox' then 'Xboxes'
                                when 'snooker' then 'snooker tables' when 'pool' then 'pool tables' else 'stations' end)
      using errcode = '22023';
  end if;

  -- Two matches being played at the same time can't share a station.
  if m.player1_id is not null and m.player2_id is not null then
    select string_agg(distinct st.name, ', ') into v_bad
      from public.tournament_matches o
      join public.tournaments ot on ot.id = o.tournament_id
      join public.stations st on st.id = any (o.station_ids)
     where ot.branch_id = t.branch_id and ot.status = 'running'
       and o.id <> m.id and o.winner_id is null
       and o.player1_id is not null and o.player2_id is not null
       and st.id = any (v_ids);
    if v_bad is not null then
      raise exception '% is already in another match being played.', v_bad using errcode = '22023';
    end if;
  end if;

  update public.tournament_matches
     set station_ids = v_ids, station_id = v_ids[1]
   where id = m.id;
end $$;

-- The one-station version, kept for anything still calling it.
create or replace function public.set_match_station(p_match_id uuid, p_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_match_stations(p_match_id, case when p_station_id is null then '{}'::uuid[] else array[p_station_id] end);
end $$;

-- Results, now with an optional score. Undoing a result clears its score.
drop function public.set_match_winner(uuid, uuid);
create function public.set_match_winner(p_match_id uuid, p_winner_id uuid, p_score text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  v_next public.tournament_matches;
  v_score text := nullif(trim(coalesce(p_score, '')), '');
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  select * into t from public.tournaments where id = m.tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status = 'open' then
    raise exception 'Start the tournament first.' using errcode = '22023';
  end if;
  if p_winner_id is not null and (m.player1_id is null or m.player2_id is null) then
    raise exception 'Both sides have to be known first.' using errcode = '22023';
  end if;
  if p_winner_id is not null and p_winner_id not in (m.player1_id, m.player2_id) then
    raise exception 'The winner has to be one of the two sides.' using errcode = '22023';
  end if;
  if p_winner_id is null and m.round = 1 and (m.player1_id is null or m.player2_id is null) then
    raise exception 'A bye can''t be undone.' using errcode = '22023';
  end if;
  if v_score is not null and char_length(v_score) > 20 then
    raise exception 'Keep the score short, like 3-1.' using errcode = '22023';
  end if;

  select * into v_next from public.tournament_matches
   where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  if v_next.winner_id is not null then
    raise exception 'The next match already has a result. Undo that one first.' using errcode = '22023';
  end if;

  update public.tournament_matches
     set winner_id = p_winner_id,
         decided_at = case when p_winner_id is null then null else now() end,
         score = case when p_winner_id is null then null else v_score end
   where id = m.id
  returning * into m;
  perform private.advance_winner(m);
end $$;

revoke execute on function public.stations_per_match(public.station_type, int) from public, anon;
revoke execute on function public.set_match_stations(uuid, uuid[]) from public, anon;
revoke execute on function public.set_match_winner(uuid, uuid, text) from public, anon;
grant execute on function public.stations_per_match(public.station_type, int) to authenticated;
grant execute on function public.set_match_stations(uuid, uuid[]) to authenticated;
grant execute on function public.set_match_winner(uuid, uuid, text) to authenticated;
