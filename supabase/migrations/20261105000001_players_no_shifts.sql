-- Players: one account per mobile number per cafe, created the first time they play.
-- Shifts: removed. Daily totals come straight from bills and payments.

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  name text not null check (length(trim(name)) between 2 and 80),
  pin_hash text, -- set in Phase 3 for PC self-login
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone)
);

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

alter table public.customers enable row level security;
create policy customers_select on public.customers for select to authenticated
  using (private.has_org_role(org_id));
create policy customers_manage on public.customers for update to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));
-- The PIN hash never leaves the database: grant only the other columns.
revoke all on public.customers from anon, authenticated;
grant select (id, org_id, phone, name, created_by, created_at, updated_at) on public.customers to authenticated;
grant update (name, phone) on public.customers to authenticated;

alter table public.sessions add column customer_id uuid references public.customers (id) on delete set null;
create index sessions_customer_idx on public.sessions (customer_id, started_at desc);

-- Indian mobile → 10 digits. Accepts +91, 91, 0 prefixes and spaces/dashes.
create function private.normalize_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(v) = 12 and left(v, 2) = '91' then
    v := substr(v, 3);
  elsif length(v) = 11 and left(v, 1) = '0' then
    v := substr(v, 2);
  end if;
  if v !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit mobile number.' using errcode = '22023';
  end if;
  return v;
end $$;

-- Finds the player by mobile, or creates them (name required the first time).
create function private.get_or_create_customer(p_org_id uuid, p_phone text, p_name text)
returns public.customers
language plpgsql security definer set search_path = '' as $$
declare
  cu public.customers;
  v_phone text := private.normalize_phone(p_phone);
begin
  select * into cu from public.customers where org_id = p_org_id and phone = v_phone;
  if found then
    return cu;
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'New player: enter their name.' using errcode = '22023';
  end if;
  insert into public.customers (org_id, phone, name, created_by)
  values (p_org_id, v_phone, trim(p_name), auth.uid())
  on conflict (org_id, phone) do update set phone = excluded.phone
  returning * into cu;
  return cu;
end $$;

create function public.create_customer(p_org_id uuid, p_phone text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cu public.customers;
begin
  perform private.assert_member(p_org_id);
  if exists (select 1 from public.customers where org_id = p_org_id and phone = private.normalize_phone(p_phone)) then
    raise exception 'A player with this mobile number already exists.' using errcode = '23505';
  end if;
  cu := private.get_or_create_customer(p_org_id, p_phone, p_name);
  return cu.id;
end $$;

-- Players list with visit stats, newest activity first.
create function public.list_customers(p_org_id uuid, p_search text default null, p_limit int default 100)
returns table (
  id uuid, name text, phone text, created_at timestamptz,
  visits bigint, total_spent numeric, last_visit timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_org_id);
  return query
  select c.id, c.name, c.phone, c.created_at,
         count(s.id), coalesce(sum(s.billed_amount), 0), max(s.started_at)
    from public.customers c
    left join public.sessions s on s.customer_id = c.id
   where c.org_id = p_org_id
     and (coalesce(trim(p_search), '') = ''
          or (regexp_replace(p_search, '[^0-9]', '', 'g') <> ''
              and c.phone like '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%')
          or c.name ilike '%' || trim(p_search) || '%')
   group by c.id
   order by max(s.started_at) desc nulls last, c.created_at desc
   limit least(greatest(p_limit, 1), 500);
end $$;

-- ---------------------------------------------------------------------------
-- start_session: a player (by mobile) is now required.
-- ---------------------------------------------------------------------------
drop function public.start_session(uuid, public.session_mode, int, text, text, uuid, int, jsonb);

create function public.start_session(
  p_station_id uuid,
  p_mode public.session_mode,
  p_phone text,
  p_name text default null,
  p_players int default 1,
  p_package_id uuid default null,
  p_minutes int default null,
  p_payments jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  plan public.rate_plans;
  bs public.branch_settings;
  cu public.customers;
  q record;
  v_minutes int := 0;
  v_price numeric := 0;
  v_label text;
  v_session_id uuid;
begin
  select * into st from public.stations where id = p_station_id;
  perform private.assert_member(st.org_id);
  if st.status <> 'active' then
    raise exception '% is in %.', st.name, st.status using errcode = '22023';
  end if;

  plan := private.resolve_rate_plan(st.id);
  if plan.id is null then
    raise exception 'No price is set for %. Add one under Pricing.', st.name using errcode = '22023';
  end if;

  select * into bs from public.branch_settings where branch_id = st.branch_id;
  if not (bs.allowed_modes_by_type -> st.type::text) ? p_mode::text then
    raise exception 'That payment mode is turned off for this station type.' using errcode = '22023';
  end if;

  cu := private.get_or_create_customer(st.org_id, p_phone, p_name);

  if p_mode = 'prepaid' then
    select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);
    v_minutes := q.minutes;
    v_price := q.price;
    v_label := q.label;
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_id, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, p_mode, cu.id, cu.name, cu.phone, coalesce(p_players, 1),
      case when p_mode = 'prepaid' then now() + make_interval(mins => v_minutes) end,
      v_minutes, v_price, auth.uid())
    returning id into v_session_id;
  exception when unique_violation then
    raise exception '% already has a running session.', st.name using errcode = '23505';
  end;

  if v_price > 0 then
    perform private.create_invoice(
      st.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', v_session_id,
        'description', st.name || ' · ' || v_label,
        'minutes', v_minutes,
        'amount', v_price,
        'gst_rate', private.line_gst_rate(st.branch_id, plan.id))),
      0, p_payments, cu.name, cu.phone);
  end if;

  perform private.log_session_event(st.org_id, v_session_id, 'start',
    jsonb_build_object('mode', p_mode, 'minutes', v_minutes, 'price', v_price, 'customer_id', cu.id));
  return v_session_id;
end $$;

-- ---------------------------------------------------------------------------
-- Remove shifts
-- ---------------------------------------------------------------------------
drop function public.open_shift(uuid, numeric);
drop function public.close_shift(uuid, numeric, text);
drop function public.shift_summary(uuid);
drop function private.shift_expected_cash(uuid);

-- Same as before, minus attaching payments to a shift.
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

  update public.sessions s
     set billed_amount = s.billed_amount + l2.amount
    from (select (x ->> 'session_id')::uuid as session_id, sum((x ->> 'amount')::numeric) as amount
            from jsonb_array_elements(p_lines) x
           where x ->> 'session_id' is not null
           group by 1) l2
   where s.id = l2.session_id;

  return v_invoice_id;
end $$;

alter table public.payments drop column shift_id;
drop table public.shifts; -- also leaves the realtime publication

-- ---------------------------------------------------------------------------
-- Venue station types: chosen at onboarding, drives which types the UI offers.
-- ---------------------------------------------------------------------------
alter table public.branch_settings
  add column station_types public.station_type[] not null
    default '{pc,ps5,xbox,pool,snooker,other}'
    check (cardinality(station_types) > 0);

drop function public.create_organization(text, text, text);

create function public.create_organization(
  p_org_name text,
  p_branch_name text,
  p_timezone text default 'Asia/Kolkata',
  p_station_types public.station_type[] default '{pc,ps5,xbox,pool,snooker,other}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_branch_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  if coalesce(cardinality(p_station_types), 0) = 0 then
    raise exception 'Pick at least one kind of station.' using errcode = '22023';
  end if;

  insert into public.orgs (name, created_by) values (trim(p_org_name), v_uid)
    returning id into v_org_id;
  insert into public.memberships (org_id, user_id, role) values (v_org_id, v_uid, 'owner');
  insert into public.branches (org_id, name, timezone)
    values (v_org_id, trim(p_branch_name), p_timezone)
    returning id into v_branch_id;
  insert into public.branch_settings (branch_id, org_id, station_types)
    values (v_branch_id, v_org_id, (select array_agg(distinct t) from unnest(p_station_types) t));

  return v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.start_session(uuid, public.session_mode, text, text, int, uuid, int, jsonb),
  public.create_customer(uuid, text, text),
  public.list_customers(uuid, text, int),
  public.create_organization(text, text, text, public.station_type[])
from public, anon;
grant execute on function
  public.start_session(uuid, public.session_mode, text, text, int, uuid, int, jsonb),
  public.create_customer(uuid, text, text),
  public.list_customers(uuid, text, int),
  public.create_organization(text, text, text, public.station_type[])
to authenticated;
