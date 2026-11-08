-- Knockout tournaments, run by staff inside the app. Players are venue players (by mobile). The
-- entry fee is a normal bill, so it shows in Bills and Reports. Starting the tournament draws a
-- random bracket; byes (when the count isn't 2, 4, 8, 16…) are spread out and go through by
-- themselves. Staff tap the winner of each match; the final's winner wins the tournament.

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  name text not null check (char_length(name) between 2 and 80),
  game text not null check (char_length(game) between 2 and 40),
  entry_fee numeric(10, 2) not null default 0 check (entry_fee between 0 and 100000),
  prize text check (prize is null or char_length(prize) <= 120),
  starts_at timestamptz,
  status text not null default 'open' check (status in ('open', 'running', 'finished')),
  winner_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index tournaments_branch_idx on public.tournaments (branch_id, created_at desc);

create table public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  phone text not null,
  -- The entry-fee bill. Paid = a bill that isn't cancelled.
  invoice_id uuid references public.invoices (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_id, customer_id)
);
create index tournament_players_tournament_idx on public.tournament_players (tournament_id);

alter table public.tournaments
  add constraint tournaments_winner_fkey foreign key (winner_id) references public.tournament_players (id) on delete set null;

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null check (round between 1 and 7),
  slot int not null check (slot >= 0),
  player1_id uuid references public.tournament_players (id) on delete set null,
  player2_id uuid references public.tournament_players (id) on delete set null,
  winner_id uuid references public.tournament_players (id) on delete set null,
  decided_at timestamptz,
  unique (tournament_id, round, slot)
);

alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.tournament_matches enable row level security;
create policy tournaments_select on public.tournaments for select to authenticated
  using (private.has_org_role(org_id));
create policy tournament_players_select on public.tournament_players for select to authenticated
  using (private.has_org_role(org_id));
create policy tournament_matches_select on public.tournament_matches for select to authenticated
  using (private.has_org_role(org_id));
revoke all on public.tournaments, public.tournament_players, public.tournament_matches from anon;
revoke insert, update, delete on public.tournaments, public.tournament_players, public.tournament_matches
  from authenticated;

-- ---------------------------------------------------------------------------
-- Setting up
-- ---------------------------------------------------------------------------
create function public.create_tournament(
  p_branch_id uuid,
  p_name text,
  p_game text,
  p_entry_fee numeric default 0,
  p_prize text default null,
  p_starts_at timestamptz default null
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
  insert into public.tournaments (org_id, branch_id, name, game, entry_fee, prize, starts_at, created_by)
  values (b.org_id, b.id, trim(p_name), trim(p_game), coalesce(p_entry_fee, 0),
          nullif(trim(coalesce(p_prize, '')), ''), p_starts_at, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.delete_tournament(p_tournament_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament_id;
  perform private.assert_member(t.org_id, array['owner']::public.member_role[]);
  -- Entry-fee bills stay in Bills (cancel them there if needed).
  delete from public.tournaments where id = t.id;
end $$;

create function public.add_tournament_player(p_tournament_id uuid, p_phone text, p_name text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  cu public.customers;
  v_id uuid;
begin
  select * into t from public.tournaments where id = p_tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status <> 'open' then
    raise exception 'Players can only join before the tournament starts.' using errcode = '22023';
  end if;
  if (select count(*) from public.tournament_players where tournament_id = t.id) >= 64 then
    raise exception 'Up to 64 players per tournament.' using errcode = '22023';
  end if;
  cu := private.get_or_create_customer(t.org_id, p_phone, p_name);
  insert into public.tournament_players (org_id, tournament_id, customer_id, name, phone)
  values (t.org_id, t.id, cu.id, cu.name, cu.phone)
  on conflict (tournament_id, customer_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception '% is already in this tournament.', cu.name using errcode = '23505';
  end if;
  return v_id;
end $$;

create function public.remove_tournament_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  tp public.tournament_players;
  t public.tournaments;
begin
  select * into tp from public.tournament_players where id = p_player_id;
  select * into t from public.tournaments where id = tp.tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status <> 'open' then
    raise exception 'The draw is done, so players can''t be removed now.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices where id = tp.invoice_id and voided_at is null) then
    raise exception '% has paid the entry fee. Cancel that bill under Bills first.', tp.name using errcode = '22023';
  end if;
  delete from public.tournament_players where id = tp.id;
end $$;

-- Collect the entry fee: a bill in the player's name (cash, UPI or their wallet).
create function public.pay_tournament_entry(p_player_id uuid, p_payments jsonb default '[]') returns uuid
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
    raise exception '% has already paid.', tp.name using errcode = '22023';
  end if;
  v_invoice := private.create_invoice(
    t.branch_id,
    jsonb_build_array(jsonb_build_object(
      'description', 'Entry · ' || t.name,
      'amount', t.entry_fee,
      'gst_rate', (select gst_rate from public.branch_settings where branch_id = t.branch_id))),
    0, p_payments, tp.name, tp.phone, tp.customer_id, null);
  update public.tournament_players set invoice_id = v_invoice where id = tp.id;
  return v_invoice;
end $$;

-- ---------------------------------------------------------------------------
-- The draw and results
-- ---------------------------------------------------------------------------
-- Puts a match's winner into the next round (slot / 2; even slots fill player 1, odd slots player 2).
create function private.advance_winner(p_match public.tournament_matches) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rounds int;
begin
  select max(round) into v_rounds from public.tournament_matches where tournament_id = p_match.tournament_id;
  if p_match.round = v_rounds then
    update public.tournaments
       set winner_id = p_match.winner_id,
           status = case when p_match.winner_id is null then 'running' else 'finished' end
     where id = p_match.tournament_id;
    return;
  end if;
  if p_match.slot % 2 = 0 then
    update public.tournament_matches set player1_id = p_match.winner_id
     where tournament_id = p_match.tournament_id and round = p_match.round + 1 and slot = p_match.slot / 2;
  else
    update public.tournament_matches set player2_id = p_match.winner_id
     where tournament_id = p_match.tournament_id and round = p_match.round + 1 and slot = p_match.slot / 2;
  end if;
end $$;

create function public.start_tournament(p_tournament_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments;
  v_players uuid[];
  v_n int;
  v_size int := 2;
  v_rounds int := 1;
  v_byes int;
  v_order int[];
  v_slot int;
  v_bits int;
  v_rev int;
  v_next int := 1;
  m public.tournament_matches;
begin
  select * into t from public.tournaments where id = p_tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status <> 'open' then
    raise exception 'This tournament has already started.' using errcode = '22023';
  end if;

  select array_agg(id order by random()) into v_players
    from public.tournament_players where tournament_id = t.id;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 2 then
    raise exception 'Add at least 2 players.' using errcode = '22023';
  end if;
  while v_size < v_n loop
    v_size := v_size * 2;
    v_rounds := v_rounds + 1;
  end loop;
  v_byes := v_size - v_n;

  -- Every round's matches, empty.
  for r in 1 .. v_rounds loop
    insert into public.tournament_matches (org_id, tournament_id, round, slot)
    select t.org_id, t.id, r, s from generate_series(0, (v_size >> r) - 1) s;
  end loop;

  -- First-round slots in bit-reversed order, so byes land in different halves of the draw.
  v_bits := v_rounds - 1;
  select array_agg(sl order by rev) into v_order
    from (
      select sl, (select coalesce(sum(((sl >> b) & 1) << (v_bits - 1 - b)), 0)
                    from generate_series(0, greatest(v_bits - 1, 0)) b where v_bits > 0) as rev
        from generate_series(0, (v_size >> 1) - 1) sl
    ) x;

  for i in 1 .. array_length(v_order, 1) loop
    v_slot := v_order[i];
    if i <= v_byes then
      -- A bye: one player, through to round 2.
      update public.tournament_matches
         set player1_id = v_players[v_next], winner_id = v_players[v_next], decided_at = now()
       where tournament_id = t.id and round = 1 and slot = v_slot
      returning * into m;
      v_next := v_next + 1;
      perform private.advance_winner(m);
    else
      update public.tournament_matches
         set player1_id = v_players[v_next], player2_id = v_players[v_next + 1]
       where tournament_id = t.id and round = 1 and slot = v_slot;
      v_next := v_next + 2;
    end if;
  end loop;

  update public.tournaments set status = 'running' where id = t.id;
end $$;

-- Record (or, with p_winner_id null, undo) a match result. A result can change only while the
-- next match hasn't been played.
create function public.set_match_winner(p_match_id uuid, p_winner_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  v_next public.tournament_matches;
begin
  select * into m from public.tournament_matches where id = p_match_id for update;
  select * into t from public.tournaments where id = m.tournament_id for update;
  perform private.assert_member(t.org_id);
  if t.status = 'open' then
    raise exception 'Start the tournament first.' using errcode = '22023';
  end if;
  if p_winner_id is not null and (m.player1_id is null or m.player2_id is null) then
    raise exception 'Both players have to be known first.' using errcode = '22023';
  end if;
  if p_winner_id is not null and p_winner_id not in (m.player1_id, m.player2_id) then
    raise exception 'The winner has to be one of the two players.' using errcode = '22023';
  end if;
  if p_winner_id is null and m.round = 1 and (m.player1_id is null or m.player2_id is null) then
    raise exception 'A bye can''t be undone.' using errcode = '22023';
  end if;

  select * into v_next from public.tournament_matches
   where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  if v_next.winner_id is not null then
    raise exception 'The next match already has a result. Undo that one first.' using errcode = '22023';
  end if;

  update public.tournament_matches
     set winner_id = p_winner_id, decided_at = case when p_winner_id is null then null else now() end
   where id = m.id
  returning * into m;
  perform private.advance_winner(m);
end $$;

revoke execute on function public.create_tournament(uuid, text, text, numeric, text, timestamptz) from public, anon;
revoke execute on function public.delete_tournament(uuid) from public, anon;
revoke execute on function public.add_tournament_player(uuid, text, text) from public, anon;
revoke execute on function public.remove_tournament_player(uuid) from public, anon;
revoke execute on function public.pay_tournament_entry(uuid, jsonb) from public, anon;
revoke execute on function public.start_tournament(uuid) from public, anon;
revoke execute on function public.set_match_winner(uuid, uuid) from public, anon;
grant execute on function public.create_tournament(uuid, text, text, numeric, text, timestamptz) to authenticated;
grant execute on function public.delete_tournament(uuid) to authenticated;
grant execute on function public.add_tournament_player(uuid, text, text) to authenticated;
grant execute on function public.remove_tournament_player(uuid) to authenticated;
grant execute on function public.pay_tournament_entry(uuid, jsonb) to authenticated;
grant execute on function public.start_tournament(uuid) to authenticated;
grant execute on function public.set_match_winner(uuid, uuid) to authenticated;
