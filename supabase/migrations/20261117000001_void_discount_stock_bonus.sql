-- Four counter features with real money impact:
--   1. Cancel (void) a wrong bill, owner only, with a reason.
--   2. Discounts need a reason; staff are capped at a % the owner sets.
--   3. Stock counts for snacks & drinks, with a movement log (sales, deliveries, counts).
--   4. Wallet top-up offers ("pay ₹500, get ₹50 extra"), applied by the database.

-- ===========================================================================
-- Columns and tables
-- ===========================================================================
alter table public.invoices
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users (id) on delete set null,
  add column void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  add column discount_reason text check (discount_reason is null or char_length(discount_reason) <= 200);
create index invoices_branch_live_idx on public.invoices (branch_id, created_at desc) where voided_at is null;

-- Quick-sale lines remember the product and quantity, so a cancelled sale can go back on the shelf.
alter table public.invoice_lines
  add column product_id uuid references public.products (id) on delete set null,
  add column quantity int check (quantity is null or quantity >= 1);

-- Wallet movements point at the bill they paid, so cancelling the bill can refund the wallet.
alter table public.wallet_transactions
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null;
alter table public.wallet_transactions drop constraint if exists wallet_transactions_method_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_method_check
  check (method in ('cash', 'upi', 'bonus', 'gameplay', 'void')) not valid;

alter table public.branch_settings
  add column staff_max_discount_pct int not null default 10 check (staff_max_discount_pct between 0 and 100);

-- Wallets are shared across the venue's branches, so offers live on the org: [{"pay": 500, "bonus": 50}]
alter table public.orgs
  add column wallet_offers jsonb not null default '[]' check (jsonb_typeof(wallet_offers) = 'array');

-- Stock: null = not tracked.
alter table public.products
  add column stock int,
  add column low_stock_at int not null default 5 check (low_stock_at between 0 and 10000);

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('sale', 'return', 'receive', 'count', 'void', 'start')),
  invoice_id uuid references public.invoices (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,
  note text check (note is null or char_length(note) <= 120),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_moves_product_idx on public.stock_moves (product_id, created_at desc);
alter table public.stock_moves enable row level security;
create policy stock_moves_select on public.stock_moves for select to authenticated
  using (private.has_org_role(org_id));
revoke all on public.stock_moves from anon;
revoke insert, update, delete on public.stock_moves from authenticated;

-- Stock changes only through the functions below (so every change is logged).
revoke update on public.products from authenticated;
grant update (name, category, price, is_active, low_stock_at) on public.products to authenticated;

-- A product created with a starting stock logs it.
create function private.log_initial_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stock is not null then
    insert into public.stock_moves (org_id, product_id, delta, reason, note)
    values (new.org_id, new.id, new.stock, 'start', 'Starting stock');
  end if;
  return new;
end $$;
create trigger products_initial_stock after insert on public.products
  for each row execute function private.log_initial_stock();

-- ===========================================================================
-- Stock helpers
-- ===========================================================================
create function private.take_stock(p_product_id uuid, p_qty int, p_reason text, p_invoice uuid, p_session uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  pr public.products;
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found or pr.stock is null then
    return; -- not tracked
  end if;
  if pr.stock < p_qty then
    raise exception 'Only % % left.', pr.stock, pr.name using errcode = '22023';
  end if;
  update public.products set stock = stock - p_qty where id = pr.id;
  insert into public.stock_moves (org_id, product_id, delta, reason, invoice_id, session_id)
  values (pr.org_id, pr.id, -p_qty, p_reason, p_invoice, p_session);
end $$;

create function private.return_stock(p_product_id uuid, p_qty int, p_reason text, p_invoice uuid, p_session uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  pr public.products;
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found or pr.stock is null then
    return;
  end if;
  update public.products set stock = stock + p_qty where id = pr.id;
  insert into public.stock_moves (org_id, product_id, delta, reason, invoice_id, session_id)
  values (pr.org_id, pr.id, p_qty, p_reason, p_invoice, p_session);
end $$;

-- Owner: record a delivery (+qty), or a shelf count (set the exact number; the difference is logged).
-- p_qty null with mode 'count' turns tracking off.
create function public.adjust_stock(p_product_id uuid, p_mode text, p_qty int, p_note text default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  pr public.products;
  v_delta int;
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  perform private.assert_member(pr.org_id, array['owner']::public.member_role[]);

  if p_mode = 'receive' then
    if p_qty is null or p_qty < 1 or p_qty > 100000 then
      raise exception 'Enter how many arrived.' using errcode = '22023';
    end if;
    v_delta := p_qty;
    update public.products set stock = coalesce(stock, 0) + p_qty where id = pr.id;
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
      values (pr.org_id, pr.id, p_qty, 'start', coalesce(nullif(trim(p_note), ''), 'Started tracking'));
      return p_qty;
    end if;
  else
    raise exception 'Unknown stock change.' using errcode = '22023';
  end if;

  if v_delta <> 0 then
    insert into public.stock_moves (org_id, product_id, delta, reason, note)
    values (pr.org_id, pr.id, v_delta, p_mode, nullif(trim(p_note), ''));
  end if;
  return (select stock from public.products where id = pr.id);
end $$;

-- ===========================================================================
-- create_invoice: discount rules, product/qty on lines, wallet rows linked to the bill
-- ===========================================================================
drop function if exists private.create_invoice(uuid, jsonb, numeric, jsonb, text, text, uuid);

create function private.create_invoice(
  p_branch_id uuid,
  p_lines jsonb,
  p_discount numeric,
  p_payments jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_id uuid default null,
  p_discount_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.branch_settings;
  v_series text;
  v_seq int;
  v_number text;
  v_invoice_id uuid;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_taxable numeric := 0;
  v_tax numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_wallet numeric;
  v_customer uuid := p_customer_id;
  v_balance numeric;
  v_digits text;
  l jsonb;
  v_share numeric;
  v_line_net numeric;
  v_rate numeric;
begin
  select * into st from public.branch_settings where branch_id = p_branch_id;

  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_subtotal from jsonb_array_elements(p_lines) x;
  if v_subtotal <= 0 then
    raise exception 'Nothing to bill.' using errcode = '22023';
  end if;
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Discount can''t be more than the bill.' using errcode = '22023';
  end if;
  if v_discount > 0 then
    if char_length(trim(coalesce(p_discount_reason, ''))) < 3 then
      raise exception 'Give a reason for the discount.' using errcode = '22023';
    end if;
    if not private.has_org_role(st.org_id, array['owner']::public.member_role[])
       and v_discount > round(v_subtotal * st.staff_max_discount_pct / 100.0, 2) + 0.009 then
      raise exception 'Staff can give up to % discount (₹% here). Ask the owner for more.',
        st.staff_max_discount_pct || '%', round(v_subtotal * st.staff_max_discount_pct / 100.0, 2)
        using errcode = '42501';
    end if;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_share := (l ->> 'amount')::numeric / v_subtotal;
    v_line_net := (l ->> 'amount')::numeric - v_discount * v_share;
    v_rate := case when st.gst_enabled then coalesce((l ->> 'gst_rate')::numeric, st.gst_rate) else 0 end;
    if v_rate > 0 and st.prices_include_tax then
      v_taxable := v_taxable + v_line_net / (1 + v_rate / 100);
      v_tax := v_tax + v_line_net - v_line_net / (1 + v_rate / 100);
    else
      v_taxable := v_taxable + v_line_net;
      v_tax := v_tax + v_line_net * v_rate / 100;
    end if;
  end loop;
  v_tax := round(v_tax, 2);
  v_taxable := round(v_taxable, 2);
  v_total := round(v_taxable + v_tax, 2);

  if exists (select 1 from jsonb_array_elements(coalesce(p_payments, '[]')) x
              where x ->> 'method' not in ('cash', 'upi', 'wallet') or (x ->> 'amount')::numeric < 0) then
    raise exception 'Payments must be cash, UPI or wallet.' using errcode = '22023';
  end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_paid from jsonb_array_elements(coalesce(p_payments, '[]')) x;
  if abs(v_paid - v_total) > 0.009 then
    raise exception 'Payments (₹%) must add up to the bill total (₹%).', v_paid, v_total using errcode = '22023';
  end if;

  v_series := case when st.gst_enabled then st.invoice_prefix else st.invoice_prefix || 'R' end;
  insert into public.invoice_counters (branch_id, series, next_seq) values (p_branch_id, v_series, 2)
  on conflict (branch_id, series) do update set next_seq = public.invoice_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  v_number := v_series || '-' || lpad(v_seq::text, 5, '0');

  insert into public.invoices (
    org_id, branch_id, number, gst_enabled, gstin, prices_include_tax, customer_name, customer_phone,
    subtotal, discount, discount_reason, taxable_amount, cgst, sgst, total, created_by)
  values (
    st.org_id, p_branch_id, v_number,
    st.gst_enabled, case when st.gst_enabled then st.gstin end, st.prices_include_tax,
    nullif(trim(p_customer_name), ''), nullif(trim(p_customer_phone), ''),
    v_subtotal, v_discount, case when v_discount > 0 then trim(p_discount_reason) end,
    v_taxable, round(v_tax / 2, 2), v_tax - round(v_tax / 2, 2), v_total, auth.uid())
  returning id into v_invoice_id;

  insert into public.invoice_lines (org_id, invoice_id, session_id, description, minutes, amount, gst_rate, product_id, quantity)
  select st.org_id, v_invoice_id, (x ->> 'session_id')::uuid, x ->> 'description', (x ->> 'minutes')::int,
         (x ->> 'amount')::numeric,
         case when st.gst_enabled then coalesce((x ->> 'gst_rate')::numeric, st.gst_rate) else 0 end,
         (x ->> 'product_id')::uuid, (x ->> 'quantity')::int
    from jsonb_array_elements(p_lines) x;

  insert into public.payments (org_id, branch_id, invoice_id, method, amount, reference, received_by)
  select st.org_id, p_branch_id, v_invoice_id, (x ->> 'method')::public.payment_method,
         (x ->> 'amount')::numeric, nullif(trim(x ->> 'reference'), ''), auth.uid()
    from jsonb_array_elements(coalesce(p_payments, '[]')) x
   where (x ->> 'amount')::numeric > 0;

  -- Wallet: deduct exactly once, from the player this bill belongs to.
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_wallet
    from jsonb_array_elements(coalesce(p_payments, '[]')) x where x ->> 'method' = 'wallet';
  if v_wallet > 0 then
    if v_customer is null and p_customer_phone is not null then
      v_digits := right(regexp_replace(p_customer_phone, '[^0-9]', '', 'g'), 10);
      select id into v_customer from public.customers where org_id = st.org_id and phone = v_digits;
    end if;
    if v_customer is null then
      raise exception 'Pick the player whose wallet pays this bill.' using errcode = '22023';
    end if;
    select wallet_balance into v_balance from public.customers
     where id = v_customer and org_id = st.org_id for update;
    if not found then
      raise exception 'Player not found.' using errcode = '22023';
    end if;
    if v_balance < v_wallet then
      raise exception 'Wallet has only ₹%, the bill needs ₹% from it.', v_balance, v_wallet using errcode = '22023';
    end if;
    update public.customers set wallet_balance = v_balance - v_wallet where id = v_customer;
    insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, invoice_id, created_by)
    values (st.org_id, v_customer, -v_wallet, v_balance - v_wallet, 'gameplay', 'Paid bill ' || v_number, v_invoice_id, auth.uid());
  end if;

  update public.sessions s
     set billed_amount = s.billed_amount + l2.amount
    from (select (x ->> 'session_id')::uuid as session_id, sum((x ->> 'amount')::numeric) as amount
            from jsonb_array_elements(p_lines) x
           where x ->> 'session_id' is not null
           group by 1) l2
   where s.id = l2.session_id;

  return v_invoice_id;
end $$;

-- ===========================================================================
-- checkout / quick_sale: pass the discount reason; quick sale takes stock
-- ===========================================================================
drop function if exists public.checkout(uuid[], numeric, jsonb, text, text);

create function public.checkout(
  p_session_ids uuid[],
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null,
  p_discount_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_org uuid;
  v_count int;
  v_lines jsonb;
  v_items jsonb;
  v_customer uuid;
  v_invoice uuid;
begin
  select min(branch_id::text)::uuid, min(org_id::text)::uuid, count(distinct branch_id)
    into v_branch, v_org, v_count
    from public.sessions where id = any (p_session_ids);
  if v_count <> 1 then
    raise exception 'Pick sessions from one branch.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);

  perform 1 from public.sessions where id = any (p_session_ids) for update;
  if exists (select 1 from public.sessions where id = any (p_session_ids) and (status <> 'ended' or written_off)) then
    raise exception 'End the sessions before billing them.' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
           'session_id', si.session_id,
           'description', si.name || case when si.quantity > 1 then ' × ' || si.quantity else '' end,
           'amount', si.price * si.quantity,
           'gst_rate', (select gst_rate from public.branch_settings where branch_id = v_branch)))
    into v_items
    from public.session_items si
   where si.session_id = any (p_session_ids) and si.invoice_id is null;

  select jsonb_agg(line order by started_at)
    into v_lines
    from (
      select s.started_at, jsonb_build_object(
               'session_id', s.id,
               'description', st.name || ' · ' ||
                 case
                   when s.mode = 'open' then 'open time ' || (ch ->> 'billable_minutes') || ' min'
                   when (ch ->> 'early')::boolean then
                     'stopped early, ' || (ch ->> 'billable_minutes') || ' of ' || s.prepaid_minutes || ' min'
                   when s.billed_amount > 0 then 'extra time ' || (ch ->> 'billable_minutes') || ' min'
                   when (ch ->> 'billable_minutes')::int > 0 then
                     s.prepaid_minutes || ' min booked + ' || (ch ->> 'billable_minutes') || ' min extra'
                   else s.prepaid_minutes || ' min booked'
                 end,
               'minutes', case
                   when s.mode = 'prepaid' and not (ch ->> 'early')::boolean and s.billed_amount = 0
                     then s.prepaid_minutes + (ch ->> 'billable_minutes')::int
                   else (ch ->> 'billable_minutes')::int
                 end,
               'amount', greatest(0, coalesce(s.charge_amount, 0) - s.billed_amount - coalesce(
                   (select sum(si.price * si.quantity) from public.session_items si
                     where si.session_id = s.id and si.invoice_id is null), 0)),
               'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id)) as line
        from public.sessions s
        join public.stations st on st.id = s.station_id
        cross join lateral private.session_charge(s.id) ch
       where s.id = any (p_session_ids)
    ) t
   where (line ->> 'amount')::numeric > 0;

  v_lines := coalesce(v_lines, '[]'::jsonb) || coalesce(v_items, '[]'::jsonb);
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'These sessions are already paid.' using errcode = '22023';
  end if;

  select customer_id into v_customer from public.sessions
   where id = any (p_session_ids) and customer_id is not null
   order by started_at limit 1;

  v_invoice := private.create_invoice(v_branch, v_lines, p_discount, p_payments,
    coalesce(p_customer_name, (select customer_name from public.sessions where id = p_session_ids[1])),
    coalesce(p_customer_phone, (select customer_phone from public.sessions where id = p_session_ids[1])),
    v_customer, p_discount_reason);

  update public.session_items set invoice_id = v_invoice
   where session_id = any (p_session_ids) and invoice_id is null;

  return v_invoice;
end $$;

drop function if exists public.quick_sale(uuid, jsonb, numeric, jsonb, text, text);

create function public.quick_sale(
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
      v_name := pr.name;
      v_price := pr.price;
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
-- Snacks on a session take stock; removing them puts it back
-- ===========================================================================
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

  insert into public.session_items (org_id, session_id, product_id, name, price, quantity)
  values (s.org_id, s.id, p_product_id, v_name, v_price, v_qty)
  returning id into v_item_id;
  if p_product_id is not null then
    perform private.take_stock(p_product_id, v_qty, 'sale', null, s.id);
  end if;

  update public.sessions set charge_amount = coalesce(charge_amount, 0) + v_price * v_qty where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'add_item',
    jsonb_build_object('name', v_name, 'price', v_price, 'quantity', v_qty));
  return v_item_id;
end $$;

create or replace function public.remove_session_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.session_items;
  s public.sessions;
begin
  select * into v_item from public.session_items where id = p_item_id for update;
  if not found then
    raise exception 'Item not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_item.org_id);
  select * into s from public.sessions where id = v_item.session_id for update;
  if s.status = 'ended' or v_item.invoice_id is not null then
    raise exception 'Cannot remove items from an ended session.' using errcode = '22023';
  end if;

  update public.sessions
     set charge_amount = greatest(0, coalesce(charge_amount, 0) - v_item.price * v_item.quantity)
   where id = s.id;
  if v_item.product_id is not null then
    perform private.return_stock(v_item.product_id, v_item.quantity, 'return', null, s.id);
  end if;
  delete from public.session_items where id = v_item.id;
end $$;

-- ===========================================================================
-- Cancel (void) a bill
-- ===========================================================================
create function public.void_invoice(p_invoice_id uuid, p_reason text, p_restock boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  r record;
  v_bal numeric;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Bill not found.' using errcode = '22023';
  end if;
  perform private.assert_member(inv.org_id, array['owner']::public.member_role[]);
  if inv.voided_at is not null then
    raise exception 'This bill is already cancelled.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for cancelling the bill.' using errcode = '22023';
  end if;

  -- Session amounts on this bill become unpaid again (re-bill them from the floor).
  update public.sessions s
     set billed_amount = greatest(0, s.billed_amount - l.amount)
    from (select session_id, sum(amount) as amount from public.invoice_lines
           where invoice_id = inv.id and session_id is not null group by 1) l
   where s.id = l.session_id;
  update public.session_items set invoice_id = null where invoice_id = inv.id;

  -- Counter-sale items back on the shelf (session snacks were eaten; they are just re-billed).
  if p_restock then
    for r in select product_id, quantity from public.invoice_lines
              where invoice_id = inv.id and session_id is null and product_id is not null loop
      perform private.return_stock(r.product_id, r.quantity, 'void', inv.id, null);
    end loop;
  end if;

  -- Wallet money paid on this bill goes back to the wallet.
  for r in select customer_id, -sum(amount) as amount from public.wallet_transactions
            where invoice_id = inv.id and method = 'gameplay' and amount < 0 group by customer_id loop
    update public.customers set wallet_balance = wallet_balance + r.amount where id = r.customer_id
      returning wallet_balance into v_bal;
    insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, invoice_id, created_by)
    values (inv.org_id, r.customer_id, r.amount, v_bal, 'void', 'Bill ' || inv.number || ' cancelled', inv.id, auth.uid());
  end loop;

  update public.invoices set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = inv.id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (inv.org_id, auth.uid(), 'void', 'invoices', inv.id::text,
          jsonb_build_object('name', inv.number, 'total', inv.total, 'reason', trim(p_reason)));

  -- Cash / UPI on this bill to hand back (or keep, if the sessions are re-billed now).
  return jsonb_build_object(
    'cash', coalesce((select sum(amount) from public.payments where invoice_id = inv.id and method = 'cash'), 0),
    'upi', coalesce((select sum(amount) from public.payments where invoice_id = inv.id and method = 'upi'), 0),
    'wallet', coalesce((select sum(amount) from public.payments where invoice_id = inv.id and method = 'wallet'), 0),
    'sessions', (select count(distinct session_id) from public.invoice_lines where invoice_id = inv.id and session_id is not null));
end $$;

-- ===========================================================================
-- Wallet top-up with offers
-- ===========================================================================
drop function if exists public.topup_wallet(uuid, numeric, text, text);

create function public.topup_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null,
  p_bonus numeric default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_bonus numeric;
  v_new numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(c.org_id);
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'Top-up must be between ₹1 and ₹1,00,000.' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'upi') then
    raise exception 'Top-ups are paid in cash or UPI.' using errcode = '22023';
  end if;

  if p_bonus is not null then
    -- A hand-picked bonus is the owner's call; staff get the venue's offers only.
    perform private.assert_member(c.org_id, array['owner']::public.member_role[]);
    if p_bonus < 0 or p_bonus > p_amount then
      raise exception 'Bonus must be between ₹0 and the amount paid.' using errcode = '22023';
    end if;
    v_bonus := p_bonus;
  else
    select coalesce(max((o ->> 'bonus')::numeric), 0) into v_bonus
      from public.orgs g, jsonb_array_elements(g.wallet_offers) o
     where g.id = c.org_id and p_amount >= (o ->> 'pay')::numeric;
  end if;

  v_new := c.wallet_balance + p_amount;
  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, p_amount, v_new, p_method, nullif(trim(p_note), ''), auth.uid());
  if v_bonus > 0 then
    v_new := v_new + v_bonus;
    insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
    values (c.org_id, c.id, v_bonus, v_new, 'bonus', 'Bonus on ₹' || p_amount || ' top-up', auth.uid());
  end if;
  update public.customers set wallet_balance = v_new where id = c.id;
  return v_new;
end $$;

-- ===========================================================================
-- Reports skip cancelled bills
-- ===========================================================================
create or replace function public.report_summary(p_branch_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select org_id, timezone into v_org, v_tz from public.branches where id = p_branch_id;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  return (
    with inv as (
      select * from public.invoices
       where branch_id = p_branch_id and voided_at is null and created_at >= v_start and created_at < v_end
    )
    select jsonb_build_object(
      'revenue', coalesce((select sum(total) from inv), 0),
      'tax', coalesce((select sum(cgst + sgst) from inv), 0),
      'bills', (select count(*) from inv),
      'sessions', (select count(*) from public.sessions
                    where branch_id = p_branch_id and started_at >= v_start and started_at < v_end),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d, 'total', total) order by d)
          from (select (created_at at time zone v_tz)::date as d, sum(total) as total from inv group by 1) x), '[]'),
      'by_method', coalesce((
        select jsonb_object_agg(method, total)
          from (select p.method, sum(p.amount) as total from public.payments p join inv on inv.id = p.invoice_id
                 group by 1) x), '{}'),
      'by_type', coalesce((
        select jsonb_agg(jsonb_build_object('type', type, 'revenue', revenue, 'minutes', minutes) order by revenue desc)
          from (select st.type, sum(il.amount) as revenue, sum(coalesce(il.minutes, 0)) as minutes
                  from public.invoice_lines il
                  join inv on inv.id = il.invoice_id
                  join public.sessions s on s.id = il.session_id
                  join public.stations st on st.id = s.station_id
                 where il.minutes is not null
                 group by st.type) x), '[]'),
      'fnb', coalesce((
        select sum(il.amount) from public.invoice_lines il join inv on inv.id = il.invoice_id
         where il.minutes is null), 0),
      'wallet_topups', coalesce((
        select sum(amount) from public.wallet_transactions
         where org_id = v_org and amount > 0 and method in ('cash', 'upi')
           and created_at >= v_start and created_at < v_end), 0),
      'wallet_bonus', coalesce((
        select sum(amount) from public.wallet_transactions
         where org_id = v_org and method = 'bonus' and created_at >= v_start and created_at < v_end), 0),
      'voided', (select count(*) from public.invoices
                  where branch_id = p_branch_id and voided_at is not null
                    and created_at >= v_start and created_at < v_end),
      'written_off', coalesce((
        select sum(charge_amount - billed_amount) from public.sessions
         where branch_id = p_branch_id and written_off and ended_at >= v_start and ended_at < v_end), 0)
    )
  );
end $$;

create or replace function public.report_insights(p_branch_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_tz text;
  v_open time;
  v_close time;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_days int := (p_to - p_from) + 1;
  v_open_minutes numeric;
begin
  select b.org_id, b.timezone, b.opening_time, b.closing_time into v_org, v_tz, v_open, v_close
    from public.branches b where b.id = p_branch_id;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);

  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  v_open_minutes := case
    when v_open is null or v_close is null then 1440
    when v_close > v_open then extract(epoch from (v_close - v_open)) / 60
    else 1440 - extract(epoch from (v_open - v_close)) / 60
  end;

  return (
    with s as (
      select s.*, st.type as station_type, st.name as station_name,
             private.session_active_seconds(s.id) / 60.0 as played_min
        from public.sessions s
        join public.stations st on st.id = s.station_id
       where s.branch_id = p_branch_id and s.started_at >= v_start and s.started_at < v_end
    ),
    inv as (
      select * from public.invoices
       where branch_id = p_branch_id and voided_at is null and created_at >= v_start and created_at < v_end
    ),
    prev as (
      select
        (select coalesce(sum(total), 0) from public.invoices
          where branch_id = p_branch_id and voided_at is null
            and created_at >= v_prev_start and created_at < v_start) as revenue,
        (select count(*) from public.sessions
          where branch_id = p_branch_id and started_at >= v_prev_start and started_at < v_start) as sessions
    ),
    station_counts as (
      select type, count(*) as n from public.stations
       where branch_id = p_branch_id and status = 'active' group by type
    )
    select jsonb_build_object(
      'previous', (select jsonb_build_object('revenue', revenue, 'sessions', sessions) from prev),
      'avg_session_minutes', (select round(avg(played_min)) from s where s.status = 'ended'),
      'avg_bill', (select round(avg(total)) from inv),
      'discounts', (select coalesce(sum(discount), 0) from inv),
      'played_minutes', (select coalesce(round(sum(played_min)), 0) from s),
      'utilisation_by_type', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'type', sc.type,
                 'stations', sc.n,
                 'minutes', coalesce(round(x.m), 0),
                 'pct', round(100 * coalesce(x.m, 0) / (sc.n * v_open_minutes * v_days), 1))
               order by sc.type)
          from station_counts sc
          left join (select station_type, sum(played_min) as m from s group by station_type) x
            on x.station_type = sc.type), '[]'),
      'top_stations', coalesce((
        select jsonb_agg(t order by t.revenue desc, t.minutes desc)
          from (select station_name as name, station_type as type, count(*) as sessions,
                       round(sum(played_min)) as minutes,
                       coalesce(sum(billed_amount), 0) as revenue,
                       round(100 * sum(played_min) / (v_open_minutes * v_days), 1) as pct
                  from s group by station_name, station_type
                 order by 5 desc, 4 desc limit 10) t), '[]'),
      'top_players', coalesce((
        select jsonb_agg(t order by t.spent desc)
          from (select c.id, c.name, c.phone, count(*) as visits,
                       coalesce(sum(s.billed_amount), 0) as spent,
                       round(sum(s.played_min)) as minutes
                  from s join public.customers c on c.id = s.customer_id
                 group by c.id order by 5 desc limit 10) t), '[]'),
      'players', (
        select jsonb_build_object(
          'total', count(distinct s.customer_id),
          'new', count(distinct s.customer_id) filter (where not exists (
            select 1 from public.sessions o
             where o.customer_id = s.customer_id and o.started_at < v_start)))
          from s where s.customer_id is not null),
      'heatmap', coalesce((
        select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'sessions', n))
          from (select extract(dow from started_at at time zone v_tz)::int as dow,
                       extract(hour from started_at at time zone v_tz)::int as hour,
                       count(*) as n
                  from s group by 1, 2) h), '[]'),
      'by_mode', coalesce((
        select jsonb_object_agg(mode, n) from (select mode, count(*) as n from s group by mode) m), '{}')
    )
  );
end $$;

-- ===========================================================================
-- Grants
-- ===========================================================================
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.adjust_stock(uuid, text, int, text),
  public.checkout(uuid[], numeric, jsonb, text, text, text),
  public.quick_sale(uuid, jsonb, numeric, jsonb, text, text, text),
  public.add_session_item(uuid, text, numeric, int, uuid),
  public.remove_session_item(uuid),
  public.void_invoice(uuid, text, boolean),
  public.topup_wallet(uuid, numeric, text, text, numeric),
  public.report_summary(uuid, date, date),
  public.report_insights(uuid, date, date)
from public, anon;
grant execute on function
  public.adjust_stock(uuid, text, int, text),
  public.checkout(uuid[], numeric, jsonb, text, text, text),
  public.quick_sale(uuid, jsonb, numeric, jsonb, text, text, text),
  public.add_session_item(uuid, text, numeric, int, uuid),
  public.remove_session_item(uuid),
  public.void_invoice(uuid, text, boolean),
  public.topup_wallet(uuid, numeric, text, text, numeric),
  public.report_summary(uuid, date, date),
  public.report_insights(uuid, date, date)
to authenticated;
