-- Gap fixes: players list paging, repeating expenses, changing the player count on a
-- live session, and removing an RPC the app never calls.

-- ---------------------------------------------------------------------------
-- Players list: offset paging + total count (was capped at 100 with no way past it).
-- ---------------------------------------------------------------------------
drop function public.list_customers(uuid, text, int);

create function public.list_customers(
  p_org_id uuid,
  p_search text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid, name text, phone text, created_at timestamptz,
  visits bigint, total_spent numeric, last_visit timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_org_id);
  return query
  select c.id, c.name, c.phone, c.created_at,
         count(s.id), coalesce(sum(s.billed_amount), 0), max(s.started_at),
         count(*) over ()
    from public.customers c
    left join public.sessions s on s.customer_id = c.id
   where c.org_id = p_org_id
     and (coalesce(trim(p_search), '') = ''
          or (regexp_replace(p_search, '[^0-9]', '', 'g') <> ''
              and c.phone like '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%')
          or c.name ilike '%' || trim(p_search) || '%')
   group by c.id
   order by max(s.started_at) desc nulls last, c.created_at desc
   limit least(greatest(p_limit, 1), 500)
  offset greatest(p_offset, 0);
end $$;

revoke execute on function public.list_customers(uuid, text, int, int) from public, anon;
grant execute on function public.list_customers(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Expenses that repeat every month (rent, internet, salaries). The Expenses page
-- lists the ones not logged yet this month so the owner can log them in one tap.
-- ---------------------------------------------------------------------------
alter table public.expenses add column repeats_monthly boolean not null default false;

-- ---------------------------------------------------------------------------
-- Change the player / controller count on a running or paused session.
-- The count applies to the whole session (pricing has no per-segment players).
-- ---------------------------------------------------------------------------
create function public.set_session_players(p_session_id uuid, p_players int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'This session has ended.' using errcode = '22023';
  end if;
  if p_players is null or p_players not between 1 and 16 then
    raise exception 'Players must be between 1 and 16.' using errcode = '22023';
  end if;
  if p_players = s.players then
    return;
  end if;
  update public.sessions set players = p_players where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'players',
    jsonb_build_object('from', s.players, 'to', p_players));
end $$;

revoke execute on function public.set_session_players(uuid, int) from public, anon;
grant execute on function public.set_session_players(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Unused: the floor estimates charges in the browser and bills via end_session.
-- ---------------------------------------------------------------------------
drop function if exists public.preview_charge(uuid);

-- ---------------------------------------------------------------------------
-- A player's lifetime totals, computed in the database (the API returns at most
-- 1000 rows, so summing in the page undercounts very regular players).
-- ---------------------------------------------------------------------------
create function public.player_summary(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.customers where id = p_customer_id;
  perform private.assert_member(v_org);
  return (
    select jsonb_build_object(
      'visits', count(*),
      'played_minutes', coalesce(round(sum(private.session_active_seconds(s.id)) / 60), 0),
      'paid', coalesce(sum(s.billed_amount), 0),
      'owed', coalesce(sum(s.outstanding) filter (where not s.written_off), 0),
      'favourite_type', (
        select st.type from public.sessions x join public.stations st on st.id = x.station_id
         where x.customer_id = p_customer_id
         group by st.type order by count(*) desc limit 1))
      from public.sessions s
     where s.customer_id = p_customer_id
  );
end $$;

revoke execute on function public.player_summary(uuid) from public, anon;
grant execute on function public.player_summary(uuid) to authenticated;
