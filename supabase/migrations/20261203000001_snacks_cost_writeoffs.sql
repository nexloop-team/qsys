-- Snacks and drinks, made practical:
--   1. Buying cost on each item: a running average of what was paid, updated with each delivery.
--      The cost at the moment of every sale and stock change is kept with it, so a later price
--      change never rewrites past profit.
--   2. Write-offs with a reason: broken or spilled, expired, used by staff, given free, missing.
--   3. Several items onto a station's bill in one go (the counter screen), all or nothing.
--   4. report_snacks: sales, cost and profit per item, and what was lost, for any period.
-- Apply after 20261202000002_pc_installs_restriction.sql.

-- ---------------------------------------------------------------------------
-- 1. Buying cost
-- ---------------------------------------------------------------------------
alter table public.products
  add column cost numeric(10, 2) check (cost is null or cost between 0 and 50000);
grant update (cost) on public.products to authenticated;

alter table public.session_items add column unit_cost numeric(10, 2);
alter table public.invoice_lines add column unit_cost numeric(10, 2);
alter table public.stock_moves add column unit_cost numeric(10, 2);

-- Whatever the item costs right now goes with the sale or the stock change, unless the caller
-- already set it (a delivery records what was paid for that delivery).
create function private.fill_unit_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_cost is null and new.product_id is not null then
    select cost into new.unit_cost from public.products where id = new.product_id;
  end if;
  return new;
end $$;
revoke execute on function private.fill_unit_cost() from public, anon, authenticated;

create trigger session_items_unit_cost before insert on public.session_items
  for each row execute function private.fill_unit_cost();
create trigger invoice_lines_unit_cost before insert on public.invoice_lines
  for each row execute function private.fill_unit_cost();
create trigger stock_moves_unit_cost before insert on public.stock_moves
  for each row execute function private.fill_unit_cost();

-- ---------------------------------------------------------------------------
-- 2. Write-off reasons
-- ---------------------------------------------------------------------------
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.stock_moves'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%reason%'
  loop
    execute format('alter table public.stock_moves drop constraint %I', c);
  end loop;
end $$;

alter table public.stock_moves
  add constraint stock_moves_reason_check check (reason in (
    'sale', 'return', 'receive', 'count', 'void', 'start',
    'broken', 'expired', 'staff', 'free', 'missing'));

create index stock_moves_org_created_idx on public.stock_moves (org_id, created_at desc);

-- Owner: a delivery (+qty, optionally what was paid per item), a shelf count (the exact number;
-- the difference is logged), or a write-off (-qty with a reason).
-- p_qty null with mode 'count' turns tracking off.
drop function public.adjust_stock(uuid, text, int, text);
create function public.adjust_stock(
  p_product_id uuid,
  p_mode text,
  p_qty int,
  p_note text default null,
  p_unit_cost numeric default null,
  p_reason text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  pr public.products;
  v_delta int;
  v_reason text := p_mode;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  perform private.assert_member(pr.org_id, array['owner']::public.member_role[]);
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'Keep the note under 120 characters.' using errcode = '22023';
  end if;

  if p_mode = 'receive' then
    if p_qty is null or p_qty < 1 or p_qty > 100000 then
      raise exception 'Enter how many arrived.' using errcode = '22023';
    end if;
    if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 50000) then
      raise exception 'Enter what you paid for one.' using errcode = '22023';
    end if;
    v_delta := p_qty;
    update public.products
       set stock = coalesce(stock, 0) + p_qty,
           -- Average of what is on the shelf and what just arrived, weighted by count.
           cost = case
             when p_unit_cost is null then cost
             when cost is null or coalesce(stock, 0) <= 0 then p_unit_cost
             else round((stock * cost + p_qty * p_unit_cost) / (stock + p_qty), 2)
           end
     where id = pr.id;
    insert into public.stock_moves (org_id, product_id, delta, reason, note, unit_cost)
    values (pr.org_id, pr.id, v_delta, 'receive', v_note, coalesce(p_unit_cost, pr.cost));
    return (select stock from public.products where id = pr.id);

  elsif p_mode = 'write_off' then
    if p_reason is null or p_reason not in ('broken', 'expired', 'staff', 'free', 'missing') then
      raise exception 'Pick why it is being taken off.' using errcode = '22023';
    end if;
    if p_qty is null or p_qty < 1 or p_qty > 100000 then
      raise exception 'Enter how many to take off.' using errcode = '22023';
    end if;
    if pr.stock is not null and pr.stock < p_qty then
      raise exception 'Only % % on the shelf.', pr.stock, pr.name using errcode = '22023';
    end if;
    -- Not tracked: the loss is still recorded (it counts in the report), the count stays off.
    if pr.stock is not null then
      update public.products set stock = stock - p_qty where id = pr.id;
    end if;
    v_delta := -p_qty;
    v_reason := p_reason;

  elsif p_mode = 'count' then
    if p_qty is null then
      update public.products set stock = null where id = pr.id; -- stop tracking
      return null;
    end if;
    if p_qty < 0 or p_qty > 100000 then
      raise exception 'Enter the number on the shelf.' using errcode = '22023';
    end if;
    v_delta := p_qty - coalesce(pr.stock, 0);
    update public.products set stock = p_qty where id = pr.id;
    if pr.stock is null then
      -- First count starts tracking; it is not "missing" stock.
      insert into public.stock_moves (org_id, product_id, delta, reason, note)
      values (pr.org_id, pr.id, p_qty, 'start', coalesce(v_note, 'Started tracking'));
      return p_qty;
    end if;
  else
    raise exception 'Unknown stock change.' using errcode = '22023';
  end if;

  if v_delta <> 0 then
    insert into public.stock_moves (org_id, product_id, delta, reason, note)
    values (pr.org_id, pr.id, v_delta, v_reason, v_note);
  end if;
  return (select stock from public.products where id = pr.id);
end $$;

revoke execute on function public.adjust_stock(uuid, text, int, text, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, text, int, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Several items onto a running session's bill: all of them, or none (say one ran out).
-- p_items: [{"product_id": "...", "quantity": 2}, {"name": "Samosa", "price": 20, "quantity": 1}]
-- ---------------------------------------------------------------------------
create function public.add_session_items(p_session_id uuid, p_items jsonb) returns void
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
    -- Same checks as one item at a time (member of the venue, session still running, stock).
    perform public.add_session_item(
      p_session_id,
      item ->> 'name',
      (item ->> 'price')::numeric,
      coalesce((item ->> 'quantity')::int, 1),
      nullif(item ->> 'product_id', '')::uuid);
  end loop;
end $$;

revoke execute on function public.add_session_items(uuid, jsonb) from public, anon;
grant execute on function public.add_session_items(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Snacks report (owner): per menu item, what sold, for how much, what it cost and the profit,
-- on bills made in the period and not cancelled. Amounts are before GST when the venue charges
-- it, and before bill discounts. Profit counts only sales whose item had a buying cost.
-- Losses: write-offs plus shortfalls found by shelf counts, valued at buying cost.
-- ---------------------------------------------------------------------------
create function public.report_snacks(p_branch_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_rate numeric;
begin
  select b.org_id, b.timezone into v_org, v_tz from public.branches b where b.id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  select coalesce(gst_rate, 18) into v_rate from public.branch_settings where branch_id = p_branch_id;

  return (
    with sold as (
      -- Counter sales
      select il.product_id,
             coalesce(il.quantity, 1) as qty,
             case when i.gst_enabled and i.prices_include_tax
                  then il.amount / (1 + il.gst_rate / 100) else il.amount end as sales,
             il.unit_cost * coalesce(il.quantity, 1) as cost
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
       where i.branch_id = p_branch_id and i.voided_at is null
         and i.created_at >= v_start and i.created_at < v_end
         and il.session_id is null and il.product_id is not null
      union all
      -- Snacks on station bills
      select si.product_id,
             si.quantity,
             case when i.gst_enabled and i.prices_include_tax
                  then si.price * si.quantity / (1 + v_rate / 100) else si.price * si.quantity end,
             si.unit_cost * si.quantity
        from public.session_items si
        join public.invoices i on i.id = si.invoice_id
       where i.branch_id = p_branch_id and i.voided_at is null
         and i.created_at >= v_start and i.created_at < v_end
         and si.product_id is not null
    ),
    per_item as (
      select s.product_id, p.name, p.category,
             sum(s.qty) as qty,
             round(sum(s.sales), 2) as sales,
             round(sum(s.cost), 2) as cost,
             round(sum(s.sales) filter (where s.cost is not null), 2) as costed_sales
        from sold s
        join public.products p on p.id = s.product_id
       group by s.product_id, p.name, p.category
    ),
    lost as (
      select case when m.reason = 'count' then 'missing' else m.reason end as reason,
             sum(-m.delta) as qty,
             round(coalesce(sum(-m.delta * m.unit_cost), 0), 2) as value,
             bool_or(m.unit_cost is null) as some_uncosted
        from public.stock_moves m
        join public.products p on p.id = m.product_id
       where p.branch_id = p_branch_id
         and m.created_at >= v_start and m.created_at < v_end
         and (m.reason in ('broken', 'expired', 'staff', 'free', 'missing')
              or (m.reason = 'count' and m.delta < 0))
       group by 1
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', product_id, 'name', name, 'category', category, 'qty', qty,
                 'sales', sales, 'cost', cost, 'profit', costed_sales - cost)
               order by sales desc)
          from per_item), '[]'),
      'totals', (
        select jsonb_build_object(
                 'qty', coalesce(sum(qty), 0),
                 'sales', coalesce(sum(sales), 0),
                 'cost', coalesce(sum(cost), 0),
                 'profit', coalesce(sum(costed_sales - cost), 0),
                 'costed_sales', coalesce(sum(costed_sales), 0))
          from per_item),
      'losses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'reason', reason, 'qty', qty, 'value', value, 'some_uncosted', some_uncosted)
               order by value desc, qty desc)
          from lost), '[]')
    )
  );
end $$;

revoke execute on function public.report_snacks(uuid, date, date) from public, anon;
grant execute on function public.report_snacks(uuid, date, date) to authenticated;
