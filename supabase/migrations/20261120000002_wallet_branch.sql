-- Cash in drawer per branch. Wallet top-ups and refunds move real cash or UPI at one branch's
-- counter, but were recorded only per venue, so every branch's Bills page counted all of them.
-- They now carry the branch where the money changed hands. Older rows stay without a branch.

alter table public.wallet_transactions
  add column if not exists branch_id uuid references public.branches (id) on delete set null;
create index if not exists wallet_transactions_branch_idx
  on public.wallet_transactions (branch_id, created_at) where branch_id is not null;

-- The branch must belong to the player's venue.
create or replace function private.wallet_branch(p_org_id uuid, p_branch_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_branch_id is null then
    return null;
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and org_id = p_org_id) then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  return p_branch_id;
end $$;

-- ---------------------------------------------------------------------------
-- Top-up (with the venue's offers), now with the branch
-- ---------------------------------------------------------------------------
drop function if exists public.topup_wallet(uuid, numeric, text, text, numeric);

create function public.topup_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null,
  p_bonus numeric default null,
  p_branch_id uuid default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_bonus numeric;
  v_new numeric;
  v_branch uuid;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(c.org_id);
  v_branch := private.wallet_branch(c.org_id, p_branch_id);
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
  insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, v_branch, c.id, p_amount, v_new, p_method, nullif(trim(p_note), ''), auth.uid());
  if v_bonus > 0 then
    v_new := v_new + v_bonus;
    insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, created_by)
    values (c.org_id, v_branch, c.id, v_bonus, v_new, 'bonus', 'Bonus on ₹' || p_amount || ' top-up', auth.uid());
  end if;
  update public.customers set wallet_balance = v_new where id = c.id;
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Refund / correction (owner), now with the branch
-- ---------------------------------------------------------------------------
drop function if exists public.deduct_wallet(uuid, numeric, text, text);

create function public.deduct_wallet(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null,
  p_method text default 'cash',
  p_branch_id uuid default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_new numeric;
  v_branch uuid;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(c.org_id, array['owner']::public.member_role[]);
  v_branch := private.wallet_branch(c.org_id, p_branch_id);
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
  insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, v_branch, c.id, -p_amount, v_new, p_method, coalesce(nullif(trim(p_note), ''), 'Refund'), auth.uid());
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Reports: wallet top-ups and bonuses of this branch (older rows without a branch still count)
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
         where org_id = v_org and (branch_id = p_branch_id or branch_id is null) and amount > 0 and method in ('cash', 'upi')
           and created_at >= v_start and created_at < v_end), 0),
      'wallet_bonus', coalesce((
        select sum(amount) from public.wallet_transactions
         where org_id = v_org and (branch_id = p_branch_id or branch_id is null) and method = 'bonus' and created_at >= v_start and created_at < v_end), 0),
      'voided', (select count(*) from public.invoices
                  where branch_id = p_branch_id and voided_at is not null
                    and created_at >= v_start and created_at < v_end),
      'written_off', coalesce((
        select sum(charge_amount - billed_amount) from public.sessions
         where branch_id = p_branch_id and written_off and ended_at >= v_start and ended_at < v_end), 0)
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.topup_wallet(uuid, numeric, text, text, numeric, uuid),
  public.deduct_wallet(uuid, numeric, text, text, uuid)
from public, anon;
grant execute on function
  public.topup_wallet(uuid, numeric, text, text, numeric, uuid),
  public.deduct_wallet(uuid, numeric, text, text, uuid)
to authenticated;
