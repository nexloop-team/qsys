-- F&B Items (Snacks & Drinks) & Player Wallet

-- ---------------------------------------------------------------------------
-- 1. F&B Catalog (Products)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null check (length(trim(name)) >= 1),
  category text not null default 'beverage' check (category in ('beverage', 'snack', 'food', 'accessory', 'other')),
  price numeric(10, 2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (private.has_org_role(org_id));
drop policy if exists products_manage on public.products;
create policy products_manage on public.products for all to authenticated
  using (private.has_org_role(org_id))
  with check (private.has_org_role(org_id));

-- ---------------------------------------------------------------------------
-- 2. Items added to an active session
-- ---------------------------------------------------------------------------
create table if not exists public.session_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  quantity int not null default 1 check (quantity >= 1),
  created_at timestamptz not null default now()
);

alter table public.session_items enable row level security;
drop policy if exists session_items_select on public.session_items;
create policy session_items_select on public.session_items for select to authenticated
  using (private.has_org_role(org_id));
drop policy if exists session_items_manage on public.session_items;
create policy session_items_manage on public.session_items for all to authenticated
  using (private.has_org_role(org_id))
  with check (private.has_org_role(org_id));

-- Add item to session
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
  v_item_id uuid;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Cannot add items to an ended session.' using errcode = '22023';
  end if;

  insert into public.session_items (org_id, session_id, product_id, name, price, quantity)
  values (s.org_id, s.id, p_product_id, trim(p_name), p_price, greatest(coalesce(p_quantity, 1), 1))
  returning id into v_item_id;

  update public.sessions
     set charge_amount = coalesce(charge_amount, 0) + (p_price * greatest(coalesce(p_quantity, 1), 1))
   where id = s.id;

  perform private.log_session_event(s.org_id, s.id, 'add_item',
    jsonb_build_object('name', p_name, 'price', p_price, 'quantity', p_quantity));

  return v_item_id;
end $$;

grant execute on function public.add_session_item(uuid, text, numeric, int, uuid) to authenticated;

-- Remove item from session
create or replace function public.remove_session_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.session_items;
  s public.sessions;
begin
  select * into v_item from public.session_items where id = p_item_id for update;
  perform private.assert_member(v_item.org_id);
  select * into s from public.sessions where id = v_item.session_id for update;
  if s.status = 'ended' then
    raise exception 'Cannot remove items from an ended session.' using errcode = '22023';
  end if;

  update public.sessions
     set charge_amount = greatest(0, coalesce(charge_amount, 0) - (v_item.price * v_item.quantity))
   where id = s.id;

  delete from public.session_items where id = v_item.id;
end $$;

grant execute on function public.remove_session_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Customer Wallet
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists wallet_balance numeric(10, 2) not null default 0 check (wallet_balance >= 0);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  amount numeric(10, 2) not null,
  balance_after numeric(10, 2) not null,
  method text not null check (method in ('cash', 'upi', 'bonus', 'gameplay')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.wallet_transactions enable row level security;
drop policy if exists wallet_transactions_select on public.wallet_transactions;
create policy wallet_transactions_select on public.wallet_transactions for select to authenticated
  using (private.has_org_role(org_id));

create or replace function public.topup_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_new_bal numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  perform private.assert_member(c.org_id);
  if p_amount <= 0 then
    raise exception 'Top-up amount must be positive.' using errcode = '22023';
  end if;

  v_new_bal := c.wallet_balance + p_amount;
  update public.customers set wallet_balance = v_new_bal where id = c.id;

  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, p_amount, v_new_bal, p_method, p_note, auth.uid());

  return v_new_bal;
end $$;

grant execute on function public.topup_wallet(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. End Session & Checkout with Items
-- ---------------------------------------------------------------------------
create or replace function public.end_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  v_charge jsonb;
  v_items_total numeric := 0;
  v_final_total numeric;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Session already ended.' using errcode = '22023';
  end if;

  update public.session_pauses set ended_at = now() where session_id = s.id and ended_at is null;
  update public.sessions set status = 'ended', ended_at = now(), paused_at = null, ended_by = auth.uid()
   where id = s.id;

  v_charge := private.session_charge(s.id);
  select coalesce(sum(price * quantity), 0) into v_items_total from public.session_items where session_id = s.id;
  v_final_total := (v_charge ->> 'total')::numeric + v_items_total;

  update public.sessions set charge_amount = v_final_total where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'end', v_charge || jsonb_build_object('items_total', v_items_total));

  return v_charge || jsonb_build_object('outstanding', greatest(v_final_total - s.billed_amount, 0), 'total', v_final_total);
end $$;

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
  v_items_lines jsonb;
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
           'amount', greatest(0, (ch ->> 'total')::numeric - s.billed_amount),
           'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id))
         order by s.started_at)
    into v_lines
    from public.sessions s
    join public.stations st on st.id = s.station_id
    cross join lateral private.session_charge(s.id) ch
   where s.id = any (p_session_ids);

  select jsonb_agg(jsonb_build_object(
           'session_id', si.session_id,
           'description', si.name || case when si.quantity > 1 then ' × ' || si.quantity else '' end,
           'amount', si.price * si.quantity,
           'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id)))
    into v_items_lines
    from public.session_items si
    join public.sessions s on s.id = si.session_id
   where si.session_id = any (p_session_ids);

  v_lines := coalesce(v_lines, '[]'::jsonb) || coalesce(v_items_lines, '[]'::jsonb);

  if v_lines is null or jsonb_array_length(v_lines) = 0 then
    raise exception 'These sessions are already paid.' using errcode = '22023';
  end if;

  return private.create_invoice(v_branch, v_lines, p_discount, p_payments,
    coalesce(p_customer_name, (select customer_name from public.sessions where id = p_session_ids[1])),
    coalesce(p_customer_phone, (select customer_phone from public.sessions where id = p_session_ids[1])));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Quick Sale (Counter / Walk-in / Waiting Customer Orders)
-- ---------------------------------------------------------------------------
create or replace function public.quick_sale(
  p_branch_id uuid,
  p_items jsonb, -- array of { product_id, name, price, quantity }
  p_discount numeric default 0,
  p_payments jsonb default '[]', -- array of { method, amount, reference }
  p_customer_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_lines jsonb := '[]'::jsonb;
  item jsonb;
  v_invoice_id uuid;
  v_branch_settings public.branch_settings;
  v_qty int;
  v_price numeric;
  v_name text;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);

  select * into v_branch_settings from public.branch_settings where branch_id = p_branch_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((item ->> 'quantity')::int, 1), 1);
    v_price := coalesce((item ->> 'price')::numeric, 0);
    v_name := coalesce(trim(item ->> 'name'), 'Item');

    if v_price < 0 then
      raise exception 'Price cannot be negative.' using errcode = '22023';
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'session_id', null,
      'description', v_name || case when v_qty > 1 then ' × ' || v_qty else '' end,
      'amount', v_price * v_qty,
      'gst_rate', case when v_branch_settings.gst_enabled then coalesce(v_branch_settings.gst_rate, 0) else 0 end
    ));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No items in sale.' using errcode = '22023';
  end if;

  v_invoice_id := private.create_invoice(
    p_branch_id,
    v_lines,
    coalesce(p_discount, 0),
    p_payments,
    p_customer_name,
    p_customer_phone
  );

  return v_invoice_id;
end $$;

grant execute on function public.quick_sale(uuid, jsonb, numeric, jsonb, text, text) to authenticated;

-- ===========================================================================
-- 6. Wallet Payment Support & Auto-Deduction on Checkout
-- ===========================================================================
alter type public.payment_method add value if not exists 'wallet';

create or replace function private.create_invoice(
  p_branch_id uuid,
  p_lines jsonb,
  p_discount numeric,
  p_payments jsonb,
  p_customer_name text,
  p_customer_phone text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.branch_settings;
  v_series text;
  v_seq int;
  v_invoice_id uuid;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_taxable numeric := 0;
  v_tax numeric := 0;
  v_total numeric;
  v_paid numeric;
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

  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_paid from jsonb_array_elements(coalesce(p_payments, '[]')) x;
  if abs(v_paid - v_total) > 0.009 then
    raise exception 'Payments (₹%) must add up to the bill total (₹%).', v_paid, v_total using errcode = '22023';
  end if;

  v_series := case when st.gst_enabled then st.invoice_prefix else st.invoice_prefix || 'R' end;
  insert into public.invoice_counters (branch_id, series, next_seq) values (p_branch_id, v_series, 2)
  on conflict (branch_id, series) do update set next_seq = public.invoice_counters.next_seq + 1
  returning next_seq - 1 into v_seq;

  insert into public.invoices (
    org_id, branch_id, number, gst_enabled, gstin, prices_include_tax, customer_name, customer_phone,
    subtotal, discount, taxable_amount, cgst, sgst, total, created_by)
  values (
    st.org_id, p_branch_id, v_series || '-' || lpad(v_seq::text, 5, '0'),
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

  -- Process wallet payments and deduct from customer balance
  for l in select * from jsonb_array_elements(coalesce(p_payments, '[]')) where (value ->> 'method') = 'wallet' loop
    declare
      v_cust_id uuid;
      v_wallet_deduct numeric := (l ->> 'amount')::numeric;
      v_curr_bal numeric;
      v_new_bal numeric;
    begin
      if v_wallet_deduct > 0 then
        select id, wallet_balance into v_cust_id, v_curr_bal
          from public.customers
         where org_id = st.org_id
           and (
             (p_customer_phone is not null and phone = regexp_replace(p_customer_phone, '[^0-9]', '', 'g'))
             or
             (p_customer_name is not null and name = trim(p_customer_name))
           )
         limit 1
         for update;

        if v_cust_id is not null then
          if v_curr_bal < v_wallet_deduct then
            raise exception 'Insufficient wallet balance (available: ₹%, required: ₹%).', v_curr_bal, v_wallet_deduct using errcode = '22023';
          end if;
          v_new_bal := v_curr_bal - v_wallet_deduct;
          update public.customers set wallet_balance = v_new_bal where id = v_cust_id;

          insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
          values (st.org_id, v_cust_id, -v_wallet_deduct, v_new_bal, 'gameplay', 'Paid bill ' || (v_series || '-' || lpad(v_seq::text, 5, '0')), auth.uid());
        end if;
      end if;
    end;
  end loop;

  update public.sessions s
     set billed_amount = s.billed_amount + l2.amount
    from (select (x ->> 'session_id')::uuid as session_id, sum((x ->> 'amount')::numeric) as amount
            from jsonb_array_elements(p_lines) x
           where x ->> 'session_id' is not null
           group by 1) l2
   where s.id = l2.session_id;

  return v_invoice_id;
end $$;
