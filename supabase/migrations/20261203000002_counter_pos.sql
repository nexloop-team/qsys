-- The counter, like a shop POS:
--   1. Your own categories ("Energy drinks", "Maggi", "Combos") instead of five fixed ones. The old
--      ones become plain names, which is also what the QR page and the PC menu now show.
--   2. A barcode on each item, so a scanner adds it to the order.
--   3. top_products: the best sellers of the last 30 days, for the counter's first tab.
-- Apply after 20261203000001_snacks_cost_writeoffs.sql.

-- 1. Categories ------------------------------------------------------------------------------
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.products'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.products drop constraint %I', c);
  end loop;
end $$;

update public.products
   set category = case category
     when 'beverage' then 'Drinks'
     when 'snack' then 'Snacks'
     when 'food' then 'Food'
     when 'accessory' then 'Accessories'
     else 'Other'
   end
 where category in ('beverage', 'snack', 'food', 'accessory', 'other');

alter table public.products
  alter column category set default 'Other',
  add constraint products_category_check check (char_length(trim(category)) between 1 and 30);

-- 2. Barcodes ------------------------------------------------------------------------------
alter table public.products
  add column barcode text check (barcode is null or barcode ~ '^[A-Za-z0-9-]{3,40}$');
create unique index products_branch_barcode_idx on public.products (branch_id, barcode) where barcode is not null;
grant update (barcode) on public.products to authenticated;

-- 3. Best sellers (any member: staff use the counter) ----------------------------------------
create function public.top_products(p_branch_id uuid, p_days int default 30, p_limit int default 12)
returns table (product_id uuid, qty bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);
  return query
    with sold as (
      select il.product_id, coalesce(il.quantity, 1) as q
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
       where i.branch_id = p_branch_id and i.voided_at is null
         and i.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
         and il.product_id is not null and il.session_id is null
      union all
      select si.product_id, si.quantity
        from public.session_items si
        join public.sessions s on s.id = si.session_id
       where s.branch_id = p_branch_id
         and si.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
         and si.product_id is not null
    )
    select sold.product_id, sum(sold.q)::bigint
      from sold
      join public.products p on p.id = sold.product_id and p.is_active
     group by sold.product_id
     order by 2 desc
     limit least(greatest(p_limit, 1), 50);
end $$;

revoke execute on function public.top_products(uuid, int, int) from public, anon;
grant execute on function public.top_products(uuid, int, int) to authenticated;
