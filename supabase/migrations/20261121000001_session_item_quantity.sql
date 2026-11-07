-- Snacks on a session, by quantity. Tapping the same menu item again raises its quantity on one
-- line ("Red Bull × 3") instead of adding a new line each time, and staff can take one off
-- with "−" (stock goes back on the shelf). Apply after 20261117000001.

-- ---------------------------------------------------------------------------
-- Add: a menu item already on this session's open lines gets its quantity raised.
-- ---------------------------------------------------------------------------
create or replace function public.add_session_item(
  p_session_id uuid,
  p_name text,
  p_price numeric,
  p_quantity int default 1,
  p_product_id uuid default null
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
    v_name := pr.name;
    v_price := pr.price;
  end if;
  if v_name = '' or v_price is null or v_price < 0 or v_qty > 100 then
    raise exception 'Enter a name, a price and a quantity up to 100.' using errcode = '22023';
  end if;

  -- Same menu item at the same price, not yet billed: one line, more of it.
  if p_product_id is not null then
    select * into v_item from public.session_items
     where session_id = s.id and product_id = p_product_id and price = v_price and invoice_id is null
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

-- ---------------------------------------------------------------------------
-- Take some off a line (the "−" button). Down to zero removes the line.
-- ---------------------------------------------------------------------------
create or replace function public.reduce_session_item(p_item_id uuid, p_quantity int default 1) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.session_items;
  s public.sessions;
  v_qty int;
begin
  select * into v_item from public.session_items where id = p_item_id for update;
  if not found then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_item.org_id);
  select * into s from public.sessions where id = v_item.session_id for update;
  if s.status = 'ended' or v_item.invoice_id is not null then
    raise exception 'Cannot change items on an ended session.' using errcode = '22023';
  end if;

  v_qty := least(greatest(coalesce(p_quantity, 1), 1), v_item.quantity);
  update public.sessions
     set charge_amount = greatest(0, coalesce(charge_amount, 0) - v_item.price * v_qty)
   where id = s.id;
  if v_item.product_id is not null then
    perform private.return_stock(v_item.product_id, v_qty, 'return', null, s.id);
  end if;
  if v_qty >= v_item.quantity then
    delete from public.session_items where id = v_item.id;
  else
    update public.session_items set quantity = quantity - v_qty where id = v_item.id;
  end if;
  perform private.log_session_event(s.org_id, s.id, 'remove_item',
    jsonb_build_object('name', v_item.name, 'price', v_item.price, 'quantity', v_qty));
end $$;

revoke execute on function public.reduce_session_item(uuid, int) from public, anon;
grant execute on function public.reduce_session_item(uuid, int) to authenticated;
