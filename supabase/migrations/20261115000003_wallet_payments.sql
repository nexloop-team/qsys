-- ===========================================================================
-- Clean, Bulletproof Wallet Setup & Functions
-- ===========================================================================

-- 1. Enable Wallet Column on Customers
alter table public.customers 
  add column if not exists wallet_balance numeric(10, 2) not null default 0;

update public.customers set wallet_balance = 0 where wallet_balance is null;

-- 2. Add 'wallet' to payment methods
alter type public.payment_method add value if not exists 'wallet';

-- 3. Wallet Transactions Table
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  amount numeric(10, 2) not null,
  balance_after numeric(10, 2) not null,
  method text not null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.wallet_transactions enable row level security;
drop policy if exists wallet_transactions_select on public.wallet_transactions;
create policy wallet_transactions_select on public.wallet_transactions for select to authenticated
  using (private.has_org_role(org_id));

-- 4. Top-up Wallet Function
create or replace function public.topup_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null
) returns numeric
language plpgsql security definer as $$
declare
  c public.customers;
  v_new_bal numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;
  perform private.assert_member(c.org_id);

  if p_amount <= 0 then
    raise exception 'Top-up amount must be positive.';
  end if;

  v_new_bal := coalesce(c.wallet_balance, 0) + p_amount;
  update public.customers set wallet_balance = v_new_bal where id = c.id;

  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, p_amount, v_new_bal, p_method, p_note, auth.uid());

  return v_new_bal;
end;
$$;

grant execute on function public.topup_wallet(uuid, numeric, text, text) to authenticated;

-- 5. Deduct Wallet Function
create or replace function public.deduct_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null
) returns numeric
language plpgsql security definer as $$
declare
  c public.customers;
  v_new_bal numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;
  perform private.assert_member(c.org_id);

  if p_amount <= 0 then
    raise exception 'Deduct amount must be positive.';
  end if;

  if coalesce(c.wallet_balance, 0) < p_amount then
    raise exception 'Insufficient wallet balance (available: %, required: %).', coalesce(c.wallet_balance, 0), p_amount;
  end if;

  v_new_bal := c.wallet_balance - p_amount;
  update public.customers set wallet_balance = v_new_bal where id = c.id;

  insert into public.wallet_transactions (org_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, c.id, -p_amount, v_new_bal, 'gameplay', p_note, auth.uid());

  return v_new_bal;
end;
$$;

grant execute on function public.deduct_wallet(uuid, numeric, text) to authenticated;

-- 6. Permissions
grant select (wallet_balance), update (wallet_balance) on public.customers to authenticated;
grant all on public.wallet_transactions to authenticated;
