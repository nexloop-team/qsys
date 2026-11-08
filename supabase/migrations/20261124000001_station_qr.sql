-- Player QR page: a QR code on each station opens a page (no login) where the player sees their
-- live timer and running bill, orders snacks & drinks, asks for 30 more minutes, or calls staff.
-- Nothing a player sends changes the bill by itself: every request waits for staff to accept it.
-- The page is off until the owner turns it on (Settings › Online).

alter table public.branch_settings
  add column qr_enabled boolean not null default false,
  add column qr_orders boolean not null default true;

-- The code in the QR. Random, so nobody can guess another station's page. Owners can replace it.
alter table public.stations
  add column public_code text not null default encode(extensions.gen_random_bytes(9), 'hex')
    constraint stations_public_code_check check (public_code ~ '^[0-9a-f]{12,32}$');
create unique index stations_public_code_idx on public.stations (public_code);

create table public.station_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  station_id uuid not null references public.stations (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null check (kind in ('snack', 'extend', 'call')),
  product_id uuid references public.products (id) on delete set null,
  label text not null check (char_length(label) between 1 and 120),
  quantity int check (quantity is null or quantity between 1 and 10),
  minutes int check (minutes is null or minutes between 1 and 240),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index station_requests_session_idx on public.station_requests (session_id, created_at desc);
create index station_requests_pending_idx on public.station_requests (branch_id) where status = 'pending';

alter table public.station_requests enable row level security;
create policy station_requests_select on public.station_requests for select to authenticated
  using (private.has_org_role(org_id));
-- No write policies: players write through public_station_request, staff through handle_station_request.
revoke all on public.station_requests from anon;
revoke insert, update, delete on public.station_requests from authenticated;

alter publication supabase_realtime add table public.station_requests;

-- A session that ends takes its open requests with it.
create function private.close_requests_on_end() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status <> 'ended' then
    update public.station_requests set status = 'declined', handled_at = now()
     where session_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger sessions_close_requests after update of status on public.sessions
  for each row execute function private.close_requests_on_end();

-- ---------------------------------------------------------------------------
-- The player's page
-- ---------------------------------------------------------------------------
create function public.public_station(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  v_charge jsonb;
  v_items jsonb := '[]';
  v_items_total numeric := 0;
  v_time numeric;
  v_session jsonb;
  v_menu jsonb := '[]';
  v_requests jsonb := '[]';
begin
  select * into st from public.stations where public_code = lower(trim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This QR code isn''t valid any more. Ask at the counter.');
  end if;
  select * into bs from public.branch_settings where branch_id = st.branch_id;
  if not coalesce(bs.qr_enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'This page is turned off. Ask at the counter.');
  end if;

  select * into s from public.sessions where station_id = st.id and status <> 'ended';
  if found then
    v_charge := private.session_charge(s.id);
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'amount', price * quantity)
                              order by created_at), '[]'),
           coalesce(sum(price * quantity), 0)
      into v_items, v_items_total
      from public.session_items where session_id = s.id and invoice_id is null;
    v_time := (v_charge ->> 'total')::numeric;

    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'status', r.status,
                                                 'created_at', r.created_at) order by r.created_at desc), '[]')
      into v_requests
      from (select * from public.station_requests where session_id = s.id order by created_at desc limit 10) r;

    v_session := jsonb_build_object(
      'mode', s.mode,
      'status', s.status,
      'started_at', s.started_at,
      'planned_end_at', s.planned_end_at,
      'paused_at', s.paused_at,
      'prepaid_minutes', s.prepaid_minutes,
      'frames', s.frames,
      'players', s.players,
      -- First name only: anyone at the table can open this page.
      'name', nullif(split_part(trim(coalesce(s.customer_name, '')), ' ', 1), ''),
      'active_seconds', (v_charge ->> 'active_seconds')::int,
      'time_total', v_time,
      'items', v_items,
      'items_total', v_items_total,
      'paid', s.billed_amount,
      'due', greatest(v_time + v_items_total - s.billed_amount, 0));
  end if;

  if coalesce(bs.qr_orders, false) then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'category', category)
                              order by category, name), '[]')
      into v_menu
      from (select * from public.products
             where branch_id = st.branch_id and is_active and (stock is null or stock > 0)
             order by category, name limit 100) pr;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venue', (select name from public.orgs where id = st.org_id),
    'branch', (select name from public.branches where id = st.branch_id),
    'station', jsonb_build_object('name', st.name, 'type', st.type),
    'server_now', now(),
    'orders', bs.qr_orders,
    'session', v_session,
    'menu', v_menu,
    'requests', v_requests);
end $$;

revoke execute on function public.public_station(text) from public;
grant execute on function public.public_station(text) to anon, authenticated;

-- A player's request from the page: snack ('snack' + product + quantity), 30 more minutes
-- ('extend', fixed time only) or a staff call ('call').
create function public.public_station_request(
  p_code text,
  p_kind text,
  p_product_id uuid default null,
  p_quantity int default 1
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  pr public.products;
  v_qty int := coalesce(p_quantity, 1);
  v_label text;
  v_minutes int;
  v_id uuid;
begin
  select * into st from public.stations where public_code = lower(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'This QR code isn''t valid any more. Ask at the counter.' using errcode = '22023';
  end if;
  select * into bs from public.branch_settings where branch_id = st.branch_id;
  if not coalesce(bs.qr_enabled, false) then
    raise exception 'This page is turned off. Ask at the counter.' using errcode = '22023';
  end if;
  select * into s from public.sessions where station_id = st.id and status <> 'ended' for update;
  if not found then
    raise exception 'No session is running here. Ask at the counter.' using errcode = '22023';
  end if;

  if (select count(*) from public.station_requests where session_id = s.id and status = 'pending') >= 5 then
    raise exception 'Staff haven''t seen your earlier requests yet. Please wait a moment.' using errcode = '22023';
  end if;
  if (select count(*) from public.station_requests
       where session_id = s.id and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many requests. Try again in a few minutes.' using errcode = '22023';
  end if;

  if p_kind = 'snack' then
    if not coalesce(bs.qr_orders, false) then
      raise exception 'Please order at the counter.' using errcode = '22023';
    end if;
    if v_qty not between 1 and 10 then
      raise exception 'Order 1 to 10 at a time.' using errcode = '22023';
    end if;
    select * into pr from public.products where id = p_product_id and branch_id = st.branch_id and is_active;
    if not found or (pr.stock is not null and pr.stock < v_qty) then
      raise exception 'Sorry, that item isn''t available right now.' using errcode = '22023';
    end if;
    v_label := v_qty || ' × ' || pr.name;
  elsif p_kind = 'extend' then
    if s.mode <> 'prepaid' then
      raise exception 'Your timer keeps running until you stop. No need to add time.' using errcode = '22023';
    end if;
    if exists (select 1 from public.station_requests where session_id = s.id and kind = 'extend' and status = 'pending') then
      raise exception 'You''ve already asked for more time. Staff will confirm it.' using errcode = '22023';
    end if;
    v_minutes := 30;
    v_label := '30 more minutes';
    v_qty := null;
  elsif p_kind = 'call' then
    if exists (select 1 from public.station_requests where session_id = s.id and kind = 'call' and status = 'pending') then
      raise exception 'Staff have been called. They''ll be with you shortly.' using errcode = '22023';
    end if;
    v_label := 'Call staff';
    v_qty := null;
  else
    raise exception 'Unknown request.' using errcode = '22023';
  end if;

  insert into public.station_requests (org_id, branch_id, station_id, session_id, kind, product_id, label, quantity, minutes)
  values (st.org_id, st.branch_id, st.id, s.id, p_kind, pr.id, v_label, v_qty, v_minutes)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.public_station_request(text, text, uuid, int) from public;
grant execute on function public.public_station_request(text, text, uuid, int) to anon, authenticated;

-- Staff accept or decline. Accepting adds the item / time exactly as if staff had done it.
create function public.handle_station_request(p_request_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.station_requests;
begin
  select * into r from public.station_requests where id = p_request_id for update;
  perform private.assert_member(r.org_id);
  if r.status <> 'pending' then
    raise exception 'This request was already handled.' using errcode = '22023';
  end if;

  if coalesce(p_accept, false) then
    if r.kind = 'snack' then
      if r.product_id is null then
        raise exception 'That item was removed from the menu.' using errcode = '22023';
      end if;
      perform public.add_session_item(r.session_id, null, null, r.quantity, r.product_id);
    elsif r.kind = 'extend' then
      perform public.extend_session(r.session_id, null, r.minutes, null);
    end if;
  end if;

  update public.station_requests
     set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end,
         handled_by = auth.uid(), handled_at = now()
   where id = r.id;
end $$;

revoke execute on function public.handle_station_request(uuid, boolean) from public, anon;
grant execute on function public.handle_station_request(uuid, boolean) to authenticated;

-- New QR code for a station (the old one stops working), e.g. after a sticker was copied.
create function public.reset_station_code(p_station_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  v_code text := encode(extensions.gen_random_bytes(9), 'hex');
begin
  select * into st from public.stations where id = p_station_id;
  perform private.assert_member(st.org_id, array['owner']::public.member_role[]);
  update public.stations set public_code = v_code where id = st.id;
  return v_code;
end $$;

revoke execute on function public.reset_station_code(uuid) from public, anon;
grant execute on function public.reset_station_code(uuid) to authenticated;
