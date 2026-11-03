-- Phase 2: live sessions, pricing, bills (GST on/off), payments, shifts, staff invites, reports.
-- All writes go through SECURITY DEFINER RPCs that check membership; tables are read-only via RLS.

-- ---------------------------------------------------------------------------
-- Settings additions
-- ---------------------------------------------------------------------------
alter table public.branch_settings
  add column upi_vpa text check (upi_vpa is null or upi_vpa ~ '^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$'),
  add column upi_payee_name text check (upi_payee_name is null or length(upi_payee_name) <= 60),
  add column overtime_grace_minutes int not null default 2 check (overtime_grace_minutes between 0 and 30);

alter table public.stations add constraint stations_id_org_key unique (id, org_id);

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.session_status as enum ('running', 'paused', 'ended');
create type public.payment_method as enum ('cash', 'upi', 'card');

-- ---------------------------------------------------------------------------
-- Shifts (cash drawer)
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_cash numeric(10, 2) not null default 0 check (opening_cash >= 0),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  expected_cash numeric(10, 2),
  counted_cash numeric(10, 2) check (counted_cash >= 0),
  note text,
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create unique index shifts_one_open_idx on public.shifts (branch_id) where closed_at is null;
create index shifts_branch_opened_idx on public.shifts (branch_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  station_id uuid not null,
  rate_plan_id uuid not null,
  mode public.session_mode not null,
  status public.session_status not null default 'running',
  customer_name text check (customer_name is null or length(customer_name) <= 80),
  customer_phone text check (customer_phone is null or customer_phone ~ '^[0-9+ -]{6,20}$'),
  players int not null default 1 check (players between 1 and 16),
  started_at timestamptz not null default now(),
  -- Prepaid only: minutes bought so far and their price. planned_end_at moves on extend/resume.
  planned_end_at timestamptz,
  prepaid_minutes int not null default 0 check (prepaid_minutes >= 0),
  prepaid_amount numeric(10, 2) not null default 0 check (prepaid_amount >= 0),
  paused_at timestamptz,
  ended_at timestamptz,
  charge_amount numeric(10, 2), -- final total, set when the session ends
  billed_amount numeric(10, 2) not null default 0, -- sum of invoice lines for this session
  outstanding numeric(10, 2) generated always as (greatest(coalesce(charge_amount, 0) - billed_amount, 0)) stored,
  written_off boolean not null default false,
  write_off_reason text,
  started_by uuid references auth.users (id) on delete set null,
  ended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade,
  foreign key (station_id, org_id) references public.stations (id, org_id),
  foreign key (rate_plan_id, org_id) references public.rate_plans (id, org_id),
  check (mode = 'open' or planned_end_at is not null)
);
-- A station can have only one live session.
create unique index sessions_one_live_idx on public.sessions (station_id) where status <> 'ended';
create index sessions_branch_live_idx on public.sessions (branch_id) where status <> 'ended';
create index sessions_branch_started_idx on public.sessions (branch_id, started_at desc);
create index sessions_rate_plan_idx on public.sessions (rate_plan_id);
create index sessions_unpaid_idx on public.sessions (branch_id) where status = 'ended' and outstanding > 0 and not written_off;

create table public.session_pauses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null references public.sessions (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index session_pauses_session_idx on public.session_pauses (session_id);

create table public.session_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index session_events_session_idx on public.session_events (session_id, created_at);

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  branch_id uuid not null references public.branches (id) on delete cascade,
  series text not null,
  next_seq int not null,
  primary key (branch_id, series)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  number text not null,
  -- Snapshot of tax settings at checkout; later setting changes never alter old bills.
  gst_enabled boolean not null,
  gstin text,
  prices_include_tax boolean not null,
  customer_name text,
  customer_phone text,
  subtotal numeric(10, 2) not null,
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  taxable_amount numeric(10, 2) not null,
  cgst numeric(10, 2) not null default 0,
  sgst numeric(10, 2) not null default 0,
  total numeric(10, 2) not null check (total >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (branch_id, number),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index invoices_branch_created_idx on public.invoices (branch_id, created_at desc);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  description text not null,
  minutes int,
  amount numeric(10, 2) not null,
  gst_rate numeric(5, 2) not null default 0
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_session_idx on public.invoice_lines (session_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  shift_id uuid references public.shifts (id) on delete set null,
  method public.payment_method not null,
  amount numeric(10, 2) not null check (amount > 0),
  reference text,
  received_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_shift_idx on public.payments (shift_id);
create index payments_branch_created_idx on public.payments (branch_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Staff invites (no secret key needed: staff sign up, then enter the code)
-- ---------------------------------------------------------------------------
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  code text not null unique,
  role public.member_role not null check (role <> 'owner'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);
create index team_invites_org_idx on public.team_invites (org_id);

-- ---------------------------------------------------------------------------
-- RLS: members read; all writes via RPCs below.
-- ---------------------------------------------------------------------------
alter table public.shifts enable row level security;
alter table public.sessions enable row level security;
alter table public.session_pauses enable row level security;
alter table public.session_events enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.team_invites enable row level security;

create policy shifts_select on public.shifts for select to authenticated
  using (private.has_org_role(org_id));
create policy sessions_select on public.sessions for select to authenticated
  using (private.has_org_role(org_id));
create policy session_pauses_select on public.session_pauses for select to authenticated
  using (private.has_org_role(org_id));
create policy session_events_select on public.session_events for select to authenticated
  using (private.has_org_role(org_id));
create policy invoices_select on public.invoices for select to authenticated
  using (private.has_org_role(org_id));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (private.has_org_role(org_id));
create policy payments_select on public.payments for select to authenticated
  using (private.has_org_role(org_id));
create policy team_invites_select on public.team_invites for select to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]));
create policy team_invites_owner_delete on public.team_invites for delete to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]));

revoke all on public.shifts, public.sessions, public.session_pauses, public.session_events,
  public.invoice_counters, public.invoices, public.invoice_lines, public.payments,
  public.team_invites from anon;

-- Live floor updates.
alter publication supabase_realtime add table public.sessions, public.session_pauses, public.shifts;

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------

-- Hourly rate in effect at an instant: highest-priority matching rule, else the plan rate.
-- A rule whose end_time < start_time runs past midnight and belongs to the day it starts.
create function private.rate_at(p_plan_id uuid, p_at timestamptz, p_tz text)
returns numeric
language sql stable security definer set search_path = '' as $$
  with t as (
    select (p_at at time zone p_tz)::time as tod,
           extract(dow from (p_at at time zone p_tz))::int as dow,
           extract(dow from (p_at at time zone p_tz) - interval '1 day')::int as prev_dow
  )
  select coalesce(
    (select r.per_hour
       from public.rate_rules r, t
      where r.rate_plan_id = p_plan_id
        and case
              when r.start_time < r.end_time then
                t.tod >= r.start_time and t.tod < r.end_time and t.dow = any (r.days_of_week)
              else
                (t.tod >= r.start_time and t.dow = any (r.days_of_week))
                or (t.tod < r.end_time and t.prev_dow = any (r.days_of_week))
            end
      order by r.priority desc, r.per_hour asc
      limit 1),
    (select per_hour from public.rate_plans where id = p_plan_id)
  );
$$;

-- Charge for a session as of p_at (or its end). Mirrors src/lib/pricing.ts.
--   open:    billable = max(min_minutes, active minutes rounded up to the plan's block)
--   prepaid: package price + overtime beyond the bought minutes (after the grace period)
-- Each billable minute is priced at the rate in effect at that wall-clock minute.
-- Totals are rounded to the nearest rupee.
create function private.session_charge(p_session_id uuid, p_at timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sessions;
  p public.rate_plans;
  v_tz text;
  v_grace int;
  v_end timestamptz;
  v_active_sec numeric;
  v_rates numeric[];
  v_len int;
  v_skip int := 0;
  v_billable int := 0;
  v_player_minutes int := 0;
  v_base numeric := 0;
  v_time numeric := 0;
  v_extra numeric := 0;
  v_rate numeric;
  v_over_sec numeric;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then
    return null;
  end if;
  select * into p from public.rate_plans where id = s.rate_plan_id;
  select b.timezone, bs.overtime_grace_minutes into v_tz, v_grace
    from public.branches b
    join public.branch_settings bs on bs.branch_id = b.id
   where b.id = s.branch_id;

  v_end := coalesce(s.ended_at, p_at, now());

  -- Active time = wall time minus pauses (an open pause runs until v_end).
  select extract(epoch from (v_end - s.started_at))
         - coalesce(sum(greatest(0, extract(epoch from (
             least(coalesce(ps.ended_at, v_end), v_end) - greatest(ps.started_at, s.started_at))))), 0)
    into v_active_sec
    from public.session_pauses ps
   where ps.session_id = s.id;
  v_active_sec := greatest(v_active_sec, 0);

  -- Rate at each active wall-clock minute.
  select coalesce(array_agg(private.rate_at(p.id, m, v_tz) order by m), '{}')
    into v_rates
    from generate_series(s.started_at, v_end - interval '1 microsecond', interval '1 minute') as m
   where not exists (
     select 1 from public.session_pauses ps
      where ps.session_id = s.id and m >= ps.started_at and m < coalesce(ps.ended_at, v_end)
   );
  v_len := coalesce(array_length(v_rates, 1), 0);

  if s.mode = 'prepaid' then
    v_base := s.prepaid_amount;
    v_over_sec := v_active_sec - s.prepaid_minutes * 60;
    if v_over_sec > v_grace * 60 then
      v_billable := (ceil(v_over_sec / 60.0 / p.rounding_minutes) * p.rounding_minutes)::int;
      v_skip := s.prepaid_minutes;
    end if;
    v_player_minutes := s.prepaid_minutes + v_billable;
  elsif v_active_sec > 0 then
    v_billable := greatest(p.min_minutes, (ceil(v_active_sec / 60.0 / p.rounding_minutes) * p.rounding_minutes)::int);
    v_player_minutes := v_billable;
  end if;

  -- Minutes beyond the sampled ones (rounding, minimum charge) use the last known rate.
  v_rate := coalesce(v_rates[v_len], p.per_hour);
  for i in 1 .. v_billable loop
    if v_skip + i <= v_len then
      v_rate := v_rates[v_skip + i];
    end if;
    v_time := v_time + v_rate / 60.0;
  end loop;

  v_extra := greatest(s.players - p.included_players, 0) * p.extra_player_per_hour / 60.0 * v_player_minutes;

  return jsonb_build_object(
    'active_seconds', floor(v_active_sec)::int,
    'billable_minutes', v_billable,
    'prepaid_amount', v_base,
    'time_amount', round(v_time, 2),
    'extra_amount', round(v_extra, 2),
    'total', round(v_base + v_time + v_extra)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create function private.assert_member(p_org_id uuid,
  p_roles public.member_role[] default array['owner', 'manager', 'staff']::public.member_role[])
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org_id is null or not private.has_org_role(p_org_id, p_roles) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
end $$;

create function private.log_session_event(p_org_id uuid, p_session_id uuid, p_kind text, p_details jsonb default '{}')
returns void
language sql security definer set search_path = '' as $$
  insert into public.session_events (org_id, session_id, kind, actor_id, details)
  values (p_org_id, p_session_id, p_kind, auth.uid(), coalesce(p_details, '{}'));
$$;

create function private.resolve_rate_plan(p_station_id uuid)
returns public.rate_plans
language sql stable security definer set search_path = '' as $$
  select rp.*
    from public.stations st
    join public.rate_plans rp
      on rp.branch_id = st.branch_id and rp.station_type = st.type and rp.is_active
     and (rp.tier = st.tier or rp.tier is null)
   where st.id = p_station_id
   order by (rp.tier is null)
   limit 1;
$$;

create function private.line_gst_rate(p_branch_id uuid, p_plan_id uuid)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select gst_rate_override from public.rate_plans where id = p_plan_id),
    (select gst_rate from public.branch_settings where branch_id = p_branch_id)
  );
$$;

-- Creates a bill with lines and payments. Lines: [{session_id?, description, minutes?, amount, gst_rate}]
-- Payments: [{method, amount, reference?}] must add up to the bill total.
create function private.create_invoice(
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
  v_shift_id uuid;
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

  -- Tax per line on the discounted amount (discount spread across lines by value).
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

  -- Separate number series for GST tax invoices and plain receipts.
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

  select id into v_shift_id from public.shifts where branch_id = p_branch_id and closed_at is null;

  insert into public.payments (org_id, branch_id, invoice_id, shift_id, method, amount, reference, received_by)
  select st.org_id, p_branch_id, v_invoice_id, v_shift_id, (x ->> 'method')::public.payment_method,
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

-- Minutes + price for a prepaid purchase: a package, or custom minutes at the plan rate.
create function private.prepaid_quote(p_station_id uuid, p_plan public.rate_plans, p_package_id uuid, p_minutes int,
  out minutes int, out price numeric, out label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.stations;
  pk public.packages;
begin
  select * into st from public.stations where id = p_station_id;
  if p_package_id is not null then
    select * into pk from public.packages
     where id = p_package_id and branch_id = st.branch_id and station_type = st.type and is_active
       and (tier is null or tier = st.tier);
    if not found then
      raise exception 'That package isn''t available for this station.' using errcode = '22023';
    end if;
    minutes := pk.minutes;
    price := pk.price;
    label := pk.name;
  elsif p_minutes between 1 and 1440 then
    minutes := p_minutes;
    price := round(p_plan.per_hour * p_minutes / 60.0);
    label := p_minutes || ' min';
  else
    raise exception 'Pick a package or enter minutes.' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Session RPCs
-- ---------------------------------------------------------------------------
create function public.server_time() returns timestamptz
language sql stable as $$ select now() $$;

create function public.start_session(
  p_station_id uuid,
  p_mode public.session_mode,
  p_players int default 1,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_package_id uuid default null,
  p_minutes int default null,
  p_payments jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  plan public.rate_plans;
  bs public.branch_settings;
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

  if p_mode = 'prepaid' then
    select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);
    v_minutes := q.minutes;
    v_price := q.price;
    v_label := q.label;
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, p_mode,
      nullif(trim(p_customer_name), ''), nullif(trim(p_customer_phone), ''), coalesce(p_players, 1),
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
      0, p_payments, p_customer_name, p_customer_phone);
  end if;

  perform private.log_session_event(st.org_id, v_session_id, 'start',
    jsonb_build_object('mode', p_mode, 'minutes', v_minutes, 'price', v_price));
  return v_session_id;
end $$;

create function public.pause_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status <> 'running' then
    raise exception 'Only a running session can be paused.' using errcode = '22023';
  end if;
  update public.sessions set status = 'paused', paused_at = now() where id = s.id;
  insert into public.session_pauses (org_id, session_id) values (s.org_id, s.id);
  perform private.log_session_event(s.org_id, s.id, 'pause');
end $$;

create function public.resume_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  v_paused interval;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status <> 'paused' then
    raise exception 'Session isn''t paused.' using errcode = '22023';
  end if;
  v_paused := now() - s.paused_at;
  update public.session_pauses set ended_at = now() where session_id = s.id and ended_at is null;
  -- Prepaid time doesn't run while paused, so push the end back.
  update public.sessions
     set status = 'running',
         paused_at = null,
         planned_end_at = case when mode = 'prepaid' then planned_end_at + v_paused end
   where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'resume', jsonb_build_object('paused_seconds', extract(epoch from v_paused)::int));
end $$;

-- Prepaid: buy more time (package or custom minutes), paid immediately.
create function public.extend_session(
  p_session_id uuid,
  p_package_id uuid default null,
  p_minutes int default null,
  p_payments jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  st public.stations;
  plan public.rate_plans;
  q record;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Session has ended.' using errcode = '22023';
  end if;
  if s.mode <> 'prepaid' then
    raise exception 'Pay-later sessions don''t need extending; they run until you end them.' using errcode = '22023';
  end if;

  select * into st from public.stations where id = s.station_id;
  select * into plan from public.rate_plans where id = s.rate_plan_id;
  select * into q from private.prepaid_quote(st.id, plan, p_package_id, p_minutes);

  update public.sessions
     set prepaid_minutes = prepaid_minutes + q.minutes,
         prepaid_amount = prepaid_amount + q.price,
         planned_end_at = planned_end_at + make_interval(mins => q.minutes)
   where id = s.id;

  if q.price > 0 then
    perform private.create_invoice(
      s.branch_id,
      jsonb_build_array(jsonb_build_object(
        'session_id', s.id,
        'description', st.name || ' · extend ' || q.label,
        'minutes', q.minutes,
        'amount', q.price,
        'gst_rate', private.line_gst_rate(s.branch_id, plan.id))),
      0, p_payments, s.customer_name, s.customer_phone);
  end if;

  perform private.log_session_event(s.org_id, s.id, 'extend', jsonb_build_object('minutes', q.minutes, 'price', q.price));
end $$;

-- Move a live session to another free station of the same type (e.g. PC broke).
create function public.transfer_session(p_session_id uuid, p_to_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  src public.stations;
  dst public.stations;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id);
  if s.status = 'ended' then
    raise exception 'Session has ended.' using errcode = '22023';
  end if;
  select * into src from public.stations where id = s.station_id;
  select * into dst from public.stations where id = p_to_station_id;
  if dst.id is null or dst.branch_id <> src.branch_id or dst.type <> src.type then
    raise exception 'Pick a station of the same type in this branch.' using errcode = '22023';
  end if;
  if dst.status <> 'active' then
    raise exception '% is in %.', dst.name, dst.status using errcode = '22023';
  end if;

  begin
    update public.sessions set station_id = dst.id where id = s.id;
  exception when unique_violation then
    raise exception '% is busy.', dst.name using errcode = '23505';
  end;
  perform private.log_session_event(s.org_id, s.id, 'transfer',
    jsonb_build_object('from', src.name, 'to', dst.name));
end $$;

create function public.preview_charge(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.sessions where id = p_session_id;
  perform private.assert_member(v_org);
  return private.session_charge(p_session_id);
end $$;

-- Stops the clock and fixes the charge. Payment happens in checkout().
create function public.end_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  v_charge jsonb;
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
  update public.sessions set charge_amount = (v_charge ->> 'total')::numeric where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'end', v_charge);

  return v_charge || jsonb_build_object('outstanding',
    greatest((v_charge ->> 'total')::numeric - s.billed_amount, 0));
end $$;

-- Bills one or more ended sessions together (e.g. a group that played PS5 then pool).
create function public.checkout(
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
             case when s.mode = 'prepaid' then 'extra time' else 'play time' end ||
             ' (' || (ch ->> 'billable_minutes') || ' min)',
           'minutes', (ch ->> 'billable_minutes')::int,
           'amount', s.charge_amount - s.billed_amount,
           'gst_rate', private.line_gst_rate(s.branch_id, s.rate_plan_id))
         order by s.started_at)
    into v_lines
    from public.sessions s
    join public.stations st on st.id = s.station_id
    cross join lateral private.session_charge(s.id) ch
   where s.id = any (p_session_ids) and s.charge_amount > s.billed_amount;

  if v_lines is null then
    raise exception 'These sessions are already paid.' using errcode = '22023';
  end if;

  return private.create_invoice(v_branch, v_lines, p_discount, p_payments,
    coalesce(p_customer_name, (select customer_name from public.sessions where id = p_session_ids[1])),
    coalesce(p_customer_phone, (select customer_phone from public.sessions where id = p_session_ids[1])));
end $$;

-- Owner clears an unpaid session (player walked out, comp, mistake). Logged.
create function public.write_off_session(p_session_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = p_session_id for update;
  perform private.assert_member(s.org_id, array['owner']::public.member_role[]);
  if s.status <> 'ended' then
    raise exception 'End the session first.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for the write-off.' using errcode = '22023';
  end if;
  update public.sessions set written_off = true, write_off_reason = trim(p_reason) where id = s.id;
  perform private.log_session_event(s.org_id, s.id, 'write_off',
    jsonb_build_object('reason', trim(p_reason), 'amount', s.charge_amount - s.billed_amount));
end $$;

-- ---------------------------------------------------------------------------
-- Shift RPCs
-- ---------------------------------------------------------------------------
create function public.open_shift(p_branch_id uuid, p_opening_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  perform private.assert_member(v_org);
  begin
    insert into public.shifts (org_id, branch_id, opened_by, opening_cash)
    values (v_org, p_branch_id, auth.uid(), greatest(coalesce(p_opening_cash, 0), 0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A shift is already open.' using errcode = '23505';
  end;
  return v_id;
end $$;

create function private.shift_expected_cash(p_shift_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select sh.opening_cash + coalesce((
    select sum(p.amount) from public.payments p where p.shift_id = sh.id and p.method = 'cash'), 0)
    from public.shifts sh where sh.id = p_shift_id;
$$;

create function public.shift_summary(p_shift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sh public.shifts;
begin
  select * into sh from public.shifts where id = p_shift_id;
  perform private.assert_member(sh.org_id);
  return jsonb_build_object(
    'expected_cash', private.shift_expected_cash(sh.id),
    'by_method', coalesce((
      select jsonb_object_agg(method, total)
        from (select method, sum(amount) as total from public.payments where shift_id = sh.id group by method) m), '{}'),
    'bills', (select count(distinct invoice_id) from public.payments where shift_id = sh.id),
    'unpaid_sessions', (
      select count(*) from public.sessions
       where branch_id = sh.branch_id and status = 'ended' and not written_off
         and charge_amount > billed_amount)
  );
end $$;

create function public.close_shift(p_shift_id uuid, p_counted_cash numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sh public.shifts;
  v_expected numeric;
begin
  select * into sh from public.shifts where id = p_shift_id for update;
  perform private.assert_member(sh.org_id);
  if sh.closed_at is not null then
    raise exception 'Shift is already closed.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.sessions
     where branch_id = sh.branch_id and status = 'ended' and not written_off
       and charge_amount > billed_amount) then
    raise exception 'Collect or write off unpaid sessions before closing the shift.' using errcode = '22023';
  end if;

  v_expected := private.shift_expected_cash(sh.id);
  update public.shifts
     set closed_at = now(), closed_by = auth.uid(), expected_cash = v_expected,
         counted_cash = greatest(coalesce(p_counted_cash, 0), 0), note = nullif(trim(p_note), '')
   where id = sh.id;
  return jsonb_build_object('expected_cash', v_expected, 'counted_cash', p_counted_cash,
    'difference', coalesce(p_counted_cash, 0) - v_expected);
end $$;

-- ---------------------------------------------------------------------------
-- Team invites
-- ---------------------------------------------------------------------------
create function public.create_invite(p_org_id uuid, p_role public.member_role) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  perform private.assert_member(p_org_id, array['owner']::public.member_role[]);
  if p_role = 'owner' then
    raise exception 'Invite managers or staff.' using errcode = '22023';
  end if;
  -- 8 chars from an unambiguous alphabet (no 0/O, 1/I).
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
    into v_code
    from extensions.gen_random_bytes(8) b, generate_series(0, 7) i;
  insert into public.team_invites (org_id, code, role, created_by) values (p_org_id, v_code, p_role, auth.uid());
  return v_code;
end $$;

create function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.team_invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into inv from public.team_invites
   where code = upper(trim(p_code)) and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'That invite code is invalid or expired.' using errcode = '22023';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do nothing;
  update public.team_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return inv.org_id;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create function public.report_summary(p_branch_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select org_id, timezone into v_org, v_tz from public.branches where id = p_branch_id;
  perform private.assert_member(v_org, array['owner', 'manager']::public.member_role[]);
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
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', type, 'revenue', revenue, 'minutes', minutes) order by revenue desc)
        from (select st.type, sum(il.amount) as revenue, sum(coalesce(il.minutes, 0)) as minutes
                from public.invoice_lines il
                join public.invoices i on i.id = il.invoice_id
                join public.sessions s on s.id = il.session_id
                join public.stations st on st.id = s.station_id
               where i.branch_id = p_branch_id and i.created_at >= v_start and i.created_at < v_end
               group by st.type) x), '[]'),
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
-- Internal helpers are only called from SECURITY DEFINER functions (run as owner).
-- RLS policies call has_org_role as the signed-in user, so it stays executable.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

revoke execute on function
  public.start_session(uuid, public.session_mode, int, text, text, uuid, int, jsonb),
  public.pause_session(uuid),
  public.resume_session(uuid),
  public.extend_session(uuid, uuid, int, jsonb),
  public.transfer_session(uuid, uuid),
  public.preview_charge(uuid),
  public.end_session(uuid),
  public.checkout(uuid[], numeric, jsonb, text, text),
  public.write_off_session(uuid, text),
  public.open_shift(uuid, numeric),
  public.shift_summary(uuid),
  public.close_shift(uuid, numeric, text),
  public.create_invite(uuid, public.member_role),
  public.accept_invite(text),
  public.report_summary(uuid, date, date),
  public.server_time()
from public, anon;

grant execute on function
  public.start_session(uuid, public.session_mode, int, text, text, uuid, int, jsonb),
  public.pause_session(uuid),
  public.resume_session(uuid),
  public.extend_session(uuid, uuid, int, jsonb),
  public.transfer_session(uuid, uuid),
  public.preview_charge(uuid),
  public.end_session(uuid),
  public.checkout(uuid[], numeric, jsonb, text, text),
  public.write_off_session(uuid, text),
  public.open_shift(uuid, numeric),
  public.shift_summary(uuid),
  public.close_shift(uuid, numeric, text),
  public.create_invite(uuid, public.member_role),
  public.accept_invite(text),
  public.report_summary(uuid, date, date),
  public.server_time()
to authenticated;
