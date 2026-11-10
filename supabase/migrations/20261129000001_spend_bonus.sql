-- Bonus on spending: the owner sets a percentage (Settings › Billing), and every bill a known
-- player pays in cash or UPI puts that much back in their wallet, as bonus credit for next time.
-- Money paid from the wallet earns nothing (that would pay a bonus on a bonus). Cancelling the
-- bill takes the bonus back, as far as it is still in the wallet.

alter table public.orgs
  add column spend_bonus_pct numeric(4, 1) not null default 0
    check (spend_bonus_pct between 0 and 20);

-- The bill itself is made by the existing function, renamed. Every caller (checkout, quick sale,
-- tournament entry fees) uses the name private.create_invoice, so they all get the bonus.
alter function private.create_invoice(uuid, jsonb, numeric, jsonb, text, text, uuid, text)
  rename to create_invoice_core;

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
  v_invoice uuid;
  v_org uuid;
  v_number text;
  v_pct numeric;
  v_paid numeric;
  v_bonus numeric;
  v_customer uuid := p_customer_id;
  v_balance numeric;
begin
  v_invoice := private.create_invoice_core(p_branch_id, p_lines, p_discount, p_payments,
    p_customer_name, p_customer_phone, p_customer_id, p_discount_reason);

  select i.org_id, i.number into v_org, v_number from public.invoices i where i.id = v_invoice;
  select spend_bonus_pct into v_pct from public.orgs where id = v_org;
  if coalesce(v_pct, 0) <= 0 then
    return v_invoice;
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from public.payments where invoice_id = v_invoice and method in ('cash', 'upi');
  -- Whole rupees, rounded down: ₹230 at 5% gives ₹11.
  v_bonus := floor(v_paid * v_pct / 100);
  if v_bonus < 1 then
    return v_invoice;
  end if;

  if v_customer is null and nullif(trim(coalesce(p_customer_phone, '')), '') is not null then
    select id into v_customer from public.customers
     where org_id = v_org and phone = right(regexp_replace(p_customer_phone, '[^0-9]', '', 'g'), 10);
  end if;
  if v_customer is null then
    return v_invoice; -- a walk-in without a player record: nobody to credit
  end if;

  update public.customers set wallet_balance = wallet_balance + v_bonus
   where id = v_customer and org_id = v_org
   returning wallet_balance into v_balance;
  if not found then
    return v_invoice;
  end if;
  insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, invoice_id, created_by)
  values (v_org, p_branch_id, v_customer, v_bonus, v_balance, 'bonus',
          trim_scale(v_pct) || '% back on bill ' || v_number, v_invoice, auth.uid());
  return v_invoice;
end $$;

-- Cancelling a bill takes its bonus back (void_invoice refunds wallet payments first, then marks
-- the bill cancelled, which fires this). If some was already spent, only what is left is taken.
create function private.take_back_spend_bonus() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_balance numeric;
  v_take numeric;
begin
  for r in select customer_id, sum(amount) as amount from public.wallet_transactions
            where invoice_id = new.id and method = 'bonus' group by customer_id loop
    select wallet_balance into v_balance from public.customers where id = r.customer_id for update;
    v_take := least(r.amount, coalesce(v_balance, 0));
    if v_take > 0 then
      update public.customers set wallet_balance = v_balance - v_take where id = r.customer_id;
      insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, invoice_id, created_by)
      values (new.org_id, new.branch_id, r.customer_id, -v_take, v_balance - v_take, 'void',
              'Bonus on bill ' || new.number || ' taken back', new.id, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create trigger invoices_take_back_spend_bonus after update of voided_at on public.invoices
  for each row when (old.voided_at is null and new.voided_at is not null)
  execute function private.take_back_spend_bonus();

revoke execute on function
  private.create_invoice_core(uuid, jsonb, numeric, jsonb, text, text, uuid, text),
  private.create_invoice(uuid, jsonb, numeric, jsonb, text, text, uuid, text),
  private.take_back_spend_bonus()
from public, anon, authenticated;
