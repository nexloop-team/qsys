-- Snacks and drinks:
--   1. Sizes and add-ons on an item, like a café POS: Maggi (Half ₹40, Full ₹70) with add-ons
--      (Extra cheese +₹20, Egg +₹15). The database works out the price from the item's own list,
--      so a browser can't send a cheaper one.
--   2. Buying prices only for the owner. Staff can no longer read them through the API at all:
--      the cost columns are hidden from the app's database role, and the owner reads and sets
--      them through owner-only functions.
-- Apply after 20261203000002_counter_pos.sql.

-- ===========================================================================
-- 1. Sizes and add-ons
-- ===========================================================================
-- options: {"sizes": [{"name": "Half", "price": 40}, ...], "addons": [{"name": "Extra cheese", "price": 20}, ...]}
create function private.valid_options(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and jsonb_typeof(coalesce(p -> 'sizes', '[]')) = 'array'
     and jsonb_typeof(coalesce(p -> 'addons', '[]')) = 'array'
     and jsonb_array_length(coalesce(p -> 'sizes', '[]')) <= 10
     and jsonb_array_length(coalesce(p -> 'addons', '[]')) <= 20
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(p -> 'sizes', '[]') || coalesce(p -> 'addons', '[]')) o
        where jsonb_typeof(o) <> 'object'
           or char_length(trim(coalesce(o ->> 'name', ''))) not between 1 and 30
           or jsonb_typeof(o -> 'price') <> 'number'
           or (o ->> 'price')::numeric not between 0 and 50000)
     -- Names are what the counter sends back, so each one appears once.
     and (select count(distinct lower(trim(o ->> 'name'))) from jsonb_array_elements(coalesce(p -> 'sizes', '[]')) o)
         = jsonb_array_length(coalesce(p -> 'sizes', '[]'))
     and (select count(distinct lower(trim(o ->> 'name'))) from jsonb_array_elements(coalesce(p -> 'addons', '[]')) o)
         = jsonb_array_length(coalesce(p -> 'addons', '[]'));
$$;

alter table public.products
  add column options jsonb not null default '{}' check (private.valid_options(options));

-- With sizes, the item's price is its first size (what the QR page and the PC menu sell when
-- nobody picks a size).
create function private.price_from_sizes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if jsonb_array_length(coalesce(new.options -> 'sizes', '[]')) > 0 then
    new.price := (new.options #>> '{sizes,0,price}')::numeric;
  end if;
  return new;
end $$;
create trigger products_price_from_sizes before insert or update of options, price on public.products
  for each row execute function private.price_from_sizes();

-- The name and price of one item with its size and add-ons, from the item's own lists.
-- No size given: the first one. A size or add-on that isn't on the item is refused.
create function private.price_item(pr public.products, p_size text, p_addons text[])
returns table (name text, price numeric)
language plpgsql stable set search_path = '' as $$
declare
  v_name text := pr.name;
  v_price numeric := pr.price;
  v_size jsonb;
  v_addon jsonb;
  a text;
  v_added text[] := '{}';
begin
  if jsonb_array_length(coalesce(pr.options -> 'sizes', '[]')) > 0 then
    if nullif(trim(coalesce(p_size, '')), '') is null then
      v_size := pr.options #> '{sizes,0}';
    else
      select o into v_size from jsonb_array_elements(pr.options -> 'sizes') o
       where lower(trim(o ->> 'name')) = lower(trim(p_size)) limit 1;
      if v_size is null then
        raise exception '% doesn''t come in %.', pr.name, p_size using errcode = '22023';
      end if;
    end if;
    v_name := v_name || ' (' || (v_size ->> 'name') || ')';
    v_price := (v_size ->> 'price')::numeric;
  end if;

  foreach a in array coalesce(p_addons, '{}') loop
    if lower(trim(a)) = any (select lower(x) from unnest(v_added) x) then
      continue; -- the same add-on twice counts once
    end if;
    select o into v_addon from jsonb_array_elements(coalesce(pr.options -> 'addons', '[]')) o
     where lower(trim(o ->> 'name')) = lower(trim(a)) limit 1;
    if v_addon is null then
      raise exception '% has no add-on called %.', pr.name, a using errcode = '22023';
    end if;
    v_added := v_added || (v_addon ->> 'name');
    v_price := v_price + (v_addon ->> 'price')::numeric;
  end loop;
  if cardinality(v_added) > 0 then
    v_name := v_name || ' + ' || array_to_string(v_added, ', ');
  end if;

  return query select v_name, v_price;
end $$;
revoke execute on function private.valid_options(jsonb) from public, anon;
revoke execute on function private.price_from_sizes() from public, anon, authenticated;
revoke execute on function private.price_item(public.products, text, text[]) from public, anon, authenticated;
-- The check constraint calls valid_options as whoever writes the row.
grant execute on function private.valid_options(jsonb) to authenticated;

-- Snacks on a session, now with a size and add-ons.
drop function public.add_session_item(uuid, text, numeric, int, uuid);
create function public.add_session_item(
  p_session_id uuid,
  p_name text,
  p_price numeric,
  p_quantity int default 1,
  p_product_id uuid default null,
  p_size text default null,
  p_addons text[] default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  pr public.products;
  v_name text := trim(coalesce(p_name, ''));
  v_price numeric := p_price;
  v_qty int := greatest(coalesce(p_quantity, 1), 1);
  v_item public.session_items;
  v_item_id uuid;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Cannot add items to an ended session.' using errcode = '22023';
  end if;

  if p_product_id is not null then
    select * into pr from public.products where id = p_product_id and org_id = s.org_id and is_active;
    if not found then
      raise exception 'That item isn''t on sale any more.' using errcode = '22023';
    end if;
    select x.name, x.price into v_name, v_price from private.price_item(pr, p_size, p_addons) x;
  end if;
  if v_name = '' or v_price is null or v_price < 0 or v_qty > 100 then
    raise exception 'Enter a name, a price and a quantity up to 100.' using errcode = '22023';
  end if;

  -- Same menu item, same size and add-ons, not yet billed: one line, more of it.
  if p_product_id is not null then
    select * into v_item from public.session_items
     where session_id = s.id and product_id = p_product_id and name = v_name and price = v_price and invoice_id is null
     order by created_at
     limit 1
     for update;
  end if;

  if v_item.id is not null then
    if v_item.quantity + v_qty > 100 then
      raise exception 'Up to 100 of one item per session.' using errcode = '22023';
    end if;
    update public.session_items set quantity = quantity + v_qty where id = v_item.id;
    v_item_id := v_item.id;
  else
    insert into public.session_items (org_id, session_id, product_id, name, price, quantity)
    values (s.org_id, s.id, p_product_id, v_name, v_price, v_qty)
    returning id into v_item_id;
  end if;

  if p_product_id is not null then
    perform private.take_stock(p_product_id, v_qty, 'sale', null, s.id);
  end if;

  update public.sessions set charge_amount = coalesce(charge_amount, 0) + v_price * v_qty where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'add_item',
    jsonb_build_object('name', v_name, 'price', v_price, 'quantity', v_qty));
  return v_item_id;
end $$;
revoke execute on function public.add_session_item(uuid, text, numeric, int, uuid, text, text[]) from public, anon;
grant execute on function public.add_session_item(uuid, text, numeric, int, uuid, text, text[]) to authenticated;

-- Several at once (the counter and the station popup): each item may carry "size" and "addons".
create or replace function public.add_session_items(p_session_id uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Up to 50 different items at a time.' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    perform public.add_session_item(
      p_session_id,
      item ->> 'name',
      (item ->> 'price')::numeric,
      coalesce((item ->> 'quantity')::int, 1),
      nullif(item ->> 'product_id', '')::uuid,
      item ->> 'size',
      case when jsonb_typeof(item -> 'addons') = 'array'
           then array(select jsonb_array_elements_text(item -> 'addons')) end);
  end loop;
end $$;

-- Counter sale, now with sizes and add-ons on each item.
create or replace function public.quick_sale(
  p_branch_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null,
  p_discount_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_lines jsonb := '[]'::jsonb;
  item jsonb;
  pr public.products;
  v_rate numeric;
  v_qty int;
  v_price numeric;
  v_name text;
  v_invoice uuid;
  l jsonb;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);
  select gst_rate into v_rate from public.branch_settings where branch_id = p_branch_id;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_qty := greatest(coalesce((item ->> 'quantity')::int, 1), 1);
    pr := null;
    if nullif(item ->> 'product_id', '') is not null then
      select * into pr from public.products
       where id = (item ->> 'product_id')::uuid and org_id = v_org and is_active;
      if not found then
        raise exception 'An item in the cart isn''t on sale any more.' using errcode = '22023';
      end if;
      select x.name, x.price into v_name, v_price
        from private.price_item(pr, item ->> 'size',
               case when jsonb_typeof(item -> 'addons') = 'array'
                    then array(select jsonb_array_elements_text(item -> 'addons')) end) x;
    else
      v_name := coalesce(nullif(trim(item ->> 'name'), ''), 'Item');
      v_price := coalesce((item ->> 'price')::numeric, 0);
    end if;
    if v_price < 0 or v_qty > 100 then
      raise exception 'Check the price and quantity.' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_name || case when v_qty > 1 then ' × ' || v_qty else '' end,
      'amount', v_price * v_qty,
      'gst_rate', v_rate,
      'product_id', pr.id,
      'quantity', v_qty));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No items in sale.' using errcode = '22023';
  end if;

  v_invoice := private.create_invoice(p_branch_id, v_lines, coalesce(p_discount, 0), p_payments,
    p_customer_name, p_customer_phone, null, p_discount_reason);

  -- Take stock last: if anything is short, the whole sale is undone.
  for l in select * from jsonb_array_elements(v_lines) loop
    if l ->> 'product_id' is not null then
      perform private.take_stock((l ->> 'product_id')::uuid, (l ->> 'quantity')::int, 'sale', v_invoice, null);
    end if;
  end loop;

  return v_invoice;
end $$;

-- ===========================================================================
-- 2. Buying prices: owner only
-- ===========================================================================
-- The app's database role can't read the cost columns any more (column privileges hold for
-- every user, so the owner reads them through the functions below).
revoke select on public.products from authenticated;
grant select (id, org_id, branch_id, name, category, price, is_active, stock, low_stock_at, created_at, barcode, options)
  on public.products to authenticated;
revoke update (cost) on public.products from authenticated;
grant update (options) on public.products to authenticated;
revoke insert on public.products from authenticated;
grant insert (id, org_id, branch_id, name, category, price, is_active, stock, low_stock_at, barcode, options)
  on public.products to authenticated;

revoke select on public.session_items from authenticated;
grant select (id, org_id, session_id, product_id, name, price, quantity, invoice_id, created_at)
  on public.session_items to authenticated;

revoke select on public.invoice_lines from authenticated;
grant select (id, org_id, invoice_id, session_id, description, minutes, amount, gst_rate, product_id, quantity)
  on public.invoice_lines to authenticated;

revoke select on public.stock_moves from authenticated;
grant select (id, org_id, product_id, delta, reason, invoice_id, session_id, note, created_by, created_at)
  on public.stock_moves to authenticated;

-- The owner's view of buying prices for a branch.
create function public.product_costs(p_branch_id uuid)
returns table (product_id uuid, cost numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  return query select p.id, p.cost from public.products p where p.branch_id = p_branch_id;
end $$;

-- The owner sets (or clears, with null) an item's buying price by hand.
create function public.set_product_cost(p_product_id uuid, p_cost numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.products where id = p_product_id;
  if v_org is null then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  if p_cost is not null and (p_cost < 0 or p_cost > 50000) then
    raise exception 'Enter what you pay for one.' using errcode = '22023';
  end if;
  update public.products set cost = round(p_cost, 2) where id = p_product_id;
end $$;

-- The owner's stock history, with what each change was worth at buying price.
create function public.stock_history(
  p_branch_id uuid,
  p_reasons text[] default null,
  p_product_id uuid default null,
  p_limit int default 300
) returns table (
  id uuid, product_id uuid, product_name text, delta int, reason text, note text,
  value numeric, invoice_id uuid, created_by uuid, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  return query
    select m.id, m.product_id, p.name, m.delta, m.reason, m.note,
           round(abs(m.delta) * m.unit_cost, 2), m.invoice_id, m.created_by, m.created_at
      from public.stock_moves m
      join public.products p on p.id = m.product_id
     where p.branch_id = p_branch_id
       and (p_reasons is null or m.reason = any (p_reasons))
       and (p_product_id is null or m.product_id = p_product_id)
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end $$;

revoke execute on function public.product_costs(uuid) from public, anon;
revoke execute on function public.set_product_cost(uuid, numeric) from public, anon;
revoke execute on function public.stock_history(uuid, text[], uuid, int) from public, anon;
grant execute on function public.product_costs(uuid) to authenticated;
grant execute on function public.set_product_cost(uuid, numeric) to authenticated;
grant execute on function public.stock_history(uuid, text[], uuid, int) to authenticated;
