-- Tournaments for every kind of game, and for teams.
--  * A tournament can say which stations it's played on (PC, PS5, snooker…). Each match can then be
--    given a station, so staff know where to send the players. The match time isn't billed: the
--    entry fee covers it.
--  * Team tournaments (doubles pool, FIFA 2v2, Valorant 5v5…): an entry is a team with a name and a
--    captain (a venue player, by mobile). The entry fee is per team and is billed to the captain.
--    The other members are just names.

alter table public.tournaments
  add column team_size int not null default 1 check (team_size between 1 and 10),
  add column station_type public.station_type;

alter table public.tournament_players
  add column team_name text check (team_name is null or char_length(team_name) between 2 and 40),
  add column members text[] not null default '{}' check (cardinality(members) <= 9);

alter table public.tournament_matches
  add column station_id uuid references public.stations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Creating: now with team size and the station type.
-- ---------------------------------------------------------------------------
drop function public.create_tournament(uuid, text, text, numeric, text, timestamptz);

create function public.create_tournament(
  p_branch_id uuid,
  p_name text,
  p_game text,
  p_entry_fee numeric default 0,
  p_prize text default null,
  p_starts_at timestamptz default null,
  p_team_size int default 1,
  p_station_type public.station_type default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.branches;
  v_id uuid;
begin
  select * into b from public.branches where id = p_branch_id;
  perform private.assert_member(b.org_id);
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Name the tournament.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_game, ''))) not between 2 and 40 then
    raise exception 'Say which game, like Snooker or FIFA.' using errcode = '22023';
  end if;
  if coalesce(p_entry_fee, 0) not between 0 and 100000 then
    raise exception 'Entry fee must be between ₹0 and ₹1,00,000.' using errcode = '22023';
  end if;
  if coalesce(p_team_size, 1) not between 1 and 10 then
    raise exception 'A team can have 1 to 10 players.' using errcode = '22023';
  end if;
  insert into public.tournaments (org_id, branch_id, name, game, entry_fee, prize, starts_at, created_by,
                                  team_size, station_type)
  values (b.org_id, b.id, trim(p_name), trim(p_game), coalesce(p_entry_fee, 0),
          nullif(trim(coalesce(p_prize, '')), ''), p_starts_at, auth.uid(),
          coalesce(p_team_size, 1), p_station_type)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Adding an entry: a player, or a team (name + captain + other members' names).
-- ---------------------------------------------------------------------------
drop function public.add_tournament_player(uuid, text, text);

create function public.add_tournament_player(
  p_tournament_id uuid,
  p_phone text,
  p_name text default null,
  p_team_name text default null,
  p_members text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  cu public.customers;
  v_team text := nullif(trim(coalesce(p_team_name, '')), '');
  v_members text[];
  v_id uuid;
begin
  select * into t from public.tournaments where id = p_tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status <> 'open' then
    raise exception 'Players can only join before the tournament starts.' using errcode = '22023';
  end if;
  if (select count(*) from public.tournament_players where tournament_id = t.id) >= 64 then
    raise exception 'Up to 64 entries per tournament.' using errcode = '22023';
  end if;

  -- Other members: trimmed names, blanks dropped, at most team size − 1.
  select coalesce(array_agg(m), '{}') into v_members
    from (select left(trim(x), 40) as m from unnest(coalesce(p_members, '{}')) x where trim(x) <> '') y;
  if t.team_size > 1 then
    if v_team is null or char_length(v_team) < 2 then
      raise exception 'Give the team a name.' using errcode = '22023';
    end if;
    if cardinality(v_members) > t.team_size - 1 then
      raise exception 'A team here has % players: the captain and % more.', t.team_size, t.team_size - 1
        using errcode = '22023';
    end if;
    if exists (select 1 from public.tournament_players
                where tournament_id = t.id and lower(team_name) = lower(v_team)) then
      raise exception 'There''s already a team called %.', v_team using errcode = '22023';
    end if;
  else
    v_team := null;
    v_members := '{}';
  end if;

  cu := private.get_or_create_customer(t.org_id, p_phone, p_name);
  insert into public.tournament_players (org_id, tournament_id, customer_id, name, phone, team_name, members)
  values (t.org_id, t.id, cu.id, cu.name, cu.phone, v_team, v_members)
  on conflict (tournament_id, customer_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception '% is already in this tournament.', cu.name using errcode = '22023';
  end if;
  return v_id;
end $$;

-- Wording only (same rules as before).
create or replace function public.remove_tournament_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  tp public.tournament_players;
  t public.tournaments;
begin
  select * into tp from public.tournament_players where id = p_player_id;
  select * into t from public.tournaments where id = tp.tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status <> 'open' then
    raise exception 'The draw is done, so entries can''t be removed now.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices where id = tp.invoice_id and voided_at is null) then
    raise exception '% has paid the entry fee. Cancel that bill under Bills first.', coalesce(tp.team_name, tp.name)
      using errcode = '22023';
  end if;
  delete from public.tournament_players where id = tp.id;
end $$;

-- The entry-fee bill names the team when there is one. Billed to the captain.
create or replace function public.pay_tournament_entry(p_player_id uuid, p_payments jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  tp public.tournament_players;
  t public.tournaments;
  v_invoice uuid;
begin
  select * into tp from public.tournament_players where id = p_player_id for update;
  select * into t from public.tournaments where id = tp.tournament_id;
  perform private.assert_member(t.org_id);
  if t.entry_fee <= 0 then
    raise exception 'This tournament is free to enter.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices where id = tp.invoice_id and voided_at is null) then
    raise exception '% has already paid.', coalesce(tp.team_name, tp.name) using errcode = '22023';
  end if;
  v_invoice := private.create_invoice(
    t.branch_id,
    jsonb_build_array(jsonb_build_object(
      'description', 'Entry · ' || t.name || coalesce(' · ' || tp.team_name, ''),
      'amount', t.entry_fee,
      'gst_rate', (select gst_rate from public.branch_settings where branch_id = t.branch_id))),
    0, p_payments, tp.name, tp.phone, tp.customer_id, null);
  update public.tournament_players set invoice_id = v_invoice where id = tp.id;
  return v_invoice;
end $$;

-- ---------------------------------------------------------------------------
-- Where a match is played. Null clears it. Free: no session, no bill.
-- ---------------------------------------------------------------------------
create function public.set_match_station(p_match_id uuid, p_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  st public.stations;
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  select * into t from public.tournaments where id = m.tournament_id;
  perform private.assert_member(t.org_id);
  if p_station_id is not null then
    select * into st from public.stations where id = p_station_id;
    if not found or st.branch_id <> t.branch_id then
      raise exception 'Pick a station at this branch.' using errcode = '22023';
    end if;
    if t.station_type is not null and st.type <> t.station_type then
      raise exception 'This tournament is played on a different kind of station.' using errcode = '22023';
    end if;
  end if;
  update public.tournament_matches set station_id = p_station_id where id = m.id;
end $$;

revoke execute on function public.create_tournament(uuid, text, text, numeric, text, timestamptz, int, public.station_type)
  from public, anon;
revoke execute on function public.add_tournament_player(uuid, text, text, text, text[]) from public, anon;
revoke execute on function public.set_match_station(uuid, uuid) from public, anon;
grant execute on function public.create_tournament(uuid, text, text, numeric, text, timestamptz, int, public.station_type)
  to authenticated;
grant execute on function public.add_tournament_player(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.set_match_station(uuid, uuid) to authenticated;
