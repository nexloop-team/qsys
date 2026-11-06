-- Money-path fixes found in the audit of the food & drinks + wallet work.
--
-- 1. Wallet payments were rejected: the "cash or UPI" rule (no-card migration) also blocks 'wallet'.
-- 2. Wallet money could be taken twice (the app deducted, then create_invoice deducted again), or
--    from the wrong player (matched by name). Now the database alone deducts, once, from the
--    player the bill belongs to, in the same transaction as the bill.
-- 3. Checkout could bill snacks twice (double-click / retry) and added ₹0 time lines.
--    Now it bills only what is still unpaid and marks snacks as billed.
-- 4. Snack prices came from the browser. Catalogue items now use the catalogue price.
-- 5. Wallet functions lacked a fixed search_path; staff could refund/clear balances; balances
--    could be written directly, skipping the ledger. Refunds and clears are owner-only now.
-- 6. Anyone could edit snack prices or insert/delete snack lines directly. Owner-only catalogue;
--    snack lines change only through the RPCs.
-- 7. Reports counted snacks as station revenue. Snacks are reported separately.

-- ---------------------------------------------------------------------------
-- 1. Allow wallet as a payment method (card stays blocked).
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_cash_or_upi;
alter table public.payments
  add constraint payments_cash_upi_wallet check (method in ('cash', 'upi', 'wallet')) not valid;

-- ---------------------------------------------------------------------------
-- 6. Permissions on catalogue, snack lines and wallets.
-- ---------------------------------------------------------------------------
drop policy if exists products_manage on public.products;
create policy products_owner_manage on public.products for all to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

drop policy if exists session_items_manage on public.session_items;
revoke insert, update, delete on public.session_items from authenticated;

revoke update (wallet_balance) on public.customers from authenticated;
revoke insert, update, delete on public.wallet_transactions from authenticated;

-- Which bill a snack line was charged on (null = not billed yet).
alter table public.session_items
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. create_invoice: wallet deducted here, from one specific player.
-- ---------------------------------------------------------------------------
drop function if exists private.create_invoice(uuid, jsonb, numeric, jsonb, text, text);

create function private.create_invoice(
  p_branch_id uuid,
  p_lines jsonb,
  p_discount numeric,
  p_payments jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_id uuid default null
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
    subtotal, discount, taxable_amount, cgst, sgst, total, created_by)
  values (
    st.org_id, p_branch_id, v_number,
    st.gst_enabled, case when st.gst_enabled then st.gstin end, st.prices_include_tax,
    nullif(trim(p_customer_name), ''), nullif(trim(p_customer_phone), ''),
    v_subtotal, v_discount, v_taxable, round(v_tax / 2, 2), v_tax - round(v_tax / 2, 2), v_total, auth.uid())
  returning id into v_invoice_id;

  insert into public.invoice_lines (org_id, invoice_id, session_id, description, minutes, amount, gst_rate)
  select st.org_id, v_invoice_id, (x ->> 'session_id')::uuid, x ->> 'description', (x ->> 'minutes')::int,
         (x ->> 'amount')::numeric,
         case when st.gst_enabled then coalesce((x ->> 'gst_rate')::numeric, st.gst_rate) else 0 end
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
    insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
    values (st.org_id, v_customer, -v_wallet, v_balance - v_wallet, 'gameplay', 'Paid bill ' || v_number, auth.uid());
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

-- ---------------------------------------------------------------------------
-- 3. checkout: bill only what is still unpaid; snacks once.
-- ---------------------------------------------------------------------------
create or replace function public.checkout(
  p_session_ids uuid[],
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null
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

  -- Lock first: a second click waits here, then finds nothing left to bill.
  perform 1 from public.sessions where id = any (p_session_ids) for update;
  if exists (select 1 from public.sessions where id = any (p_session_ids) and (status <> 'ended' or written_off)) then
    raise exception 'End the sessions before billing them.' using errcode = '22023';
  end if;

  -- Snacks not on a bill yet.
  select jsonb_agg(jsonb_build_object(
           'session_id', si.session_id,
           'description', si.name || case when si.quantity > 1 then ' × ' || si.quantity else '' end,
           'amount', si.price * si.quantity,
           'gst_rate', (select gst_rate from public.branch_settings where branch_id = v_branch)))
    into v_items
    from public.session_items si
   where si.session_id = any (p_session_ids) and si.invoice_id is null;

  -- Play time still unpaid = what is owed minus the unbilled snacks.
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
    v_customer);

  update public.session_items set invoice_id = v_invoice
   where session_id = any (p_session_ids) and invoice_id is null;

  return v_invoice;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Snack lines: catalogue price for catalogue items.
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

  update public.sessions set charge_amount = coalesce(charge_amount, 0) + v_price * v_qty where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'add_item',
    jsonb_build_object('name', v_name, 'price', v_price, 'quantity', v_qty));
  return v_item_id;
end $$;

create or replace function public.quick_sale(
  p_branch_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_payments jsonb default '[]',
  p_customer_name text default null,
  p_customer_phone text default null
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
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);
  select gst_rate into v_rate from public.branch_settings where branch_id = p_branch_id;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_qty := greatest(coalesce((item ->> 'quantity')::int, 1), 1);
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
      'gst_rate', v_rate));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No items in sale.' using errcode = '22023';
  end if;

  return private.create_invoice(p_branch_id, v_lines, coalesce(p_discount, 0), p_payments,
    p_customer_name, p_customer_phone);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Wallet top-up (any member) and refund / clear (owner only).
-- ---------------------------------------------------------------------------
create or replace function public.topup_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
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

  v_new := c.wallet_balance + p_amount;
  update public.customers set wallet_balance = v_new where id = c.id;
  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, p_amount, v_new, p_method, nullif(trim(p_note), ''), auth.uid());
  return v_new;
end $$;

drop function if exists public.deduct_wallet(uuid, numeric, text);

-- Money handed back to the player (or a correction). Owner only; recorded in the ledger.
create function public.deduct_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null,
  p_method text default 'cash'
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_new numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(c.org_id, array['owner']::public.member_role[]);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount.' using errcode = '22023';
  end if;
  if c.wallet_balance < p_amount then
    raise exception 'Wallet has only ₹%.', c.wallet_balance using errcode = '22023';
  end if;
  if p_method not in ('cash', 'upi') then
    raise exception 'Refunds are paid in cash or UPI.' using errcode = '22023';
  end if;

  v_new := c.wallet_balance - p_amount;
  update public.customers set wallet_balance = v_new where id = c.id;
  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, -p_amount, v_new, p_method, coalesce(nullif(trim(p_note), ''), 'Refund'), auth.uid());
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Reports: snacks are not station revenue; show them on their own.
-- ---------------------------------------------------------------------------
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

  return jsonb_build_object(
    'revenue', coalesce((select sum(total) from public.invoices
                          where branch_id = p_branch_id and created_at >= v_start and created_at < v_end), 0),
    'tax', coalesce((select sum(cgst + sgst) from public.invoices
                      where branch_id = p_branch_id and created_at >= v_start and created_at < v_end), 0),
    'bills', (select count(*) from public.invoices
               where branch_id = p_branch_id and created_at >= v_start and created_at < v_end),
    'sessions', (select count(*) from public.sessions
                  where branch_id = p_branch_id and started_at >= v_start and started_at < v_end),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'total', total) order by d)
        from (select (created_at at time zone v_tz)::date as d, sum(total) as total
                from public.invoices
               where branch_id = p_branch_id and created_at >= v_start and created_at < v_end
               group by 1) x), '[]'),
    'by_method', coalesce((
      select jsonb_object_agg(method, total)
        from (select method, sum(amount) as total from public.payments
               where branch_id = p_branch_id and created_at >= v_start and created_at < v_end
               group by 1) x), '{}'),
    -- Play time only: time lines carry minutes, snack lines don't.
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', type, 'revenue', revenue, 'minutes', minutes) order by revenue desc)
        from (select st.type, sum(il.amount) as revenue, sum(coalesce(il.minutes, 0)) as minutes
                from public.invoice_lines il
                join public.invoices i on i.id = il.invoice_id
                join public.sessions s on s.id = il.session_id
                join public.stations st on st.id = s.station_id
               where i.branch_id = p_branch_id and i.created_at >= v_start and i.created_at < v_end
                 and il.minutes is not null
               group by st.type) x), '[]'),
    'fnb', coalesce((
      select sum(il.amount) from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
       where i.branch_id = p_branch_id and i.created_at >= v_start and i.created_at < v_end
         and il.minutes is null), 0),
    -- Money put into player wallets (not revenue until spent).
    'wallet_topups', coalesce((
      select sum(amount) from public.wallet_transactions
       where org_id = v_org and amount > 0 and method in ('cash', 'upi')
         and created_at >= v_start and created_at < v_end), 0),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'sessions', n) order by h)
        from (select extract(hour from started_at at time zone v_tz)::int as h, count(*) as n
                from public.sessions
               where branch_id = p_branch_id and started_at >= v_start and started_at < v_end
               group by 1) x), '[]'),
    'written_off', coalesce((
      select sum(charge_amount - billed_amount) from public.sessions
       where branch_id = p_branch_id and written_off and ended_at >= v_start and ended_at < v_end), 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.topup_wallet(uuid, numeric, text, text),
  public.deduct_wallet(uuid, numeric, text, text),
  public.add_session_item(uuid, text, numeric, int, uuid),
  public.quick_sale(uuid, jsonb, numeric, jsonb, text, text),
  public.checkout(uuid[], numeric, jsonb, text, text)
from public, anon;
grant execute on function
  public.topup_wallet(uuid, numeric, text, text),
  public.deduct_wallet(uuid, numeric, text, text),
  public.add_session_item(uuid, text, numeric, int, uuid),
  public.quick_sale(uuid, jsonb, numeric, jsonb, text, text),
  public.checkout(uuid[], numeric, jsonb, text, text)
to authenticated;
