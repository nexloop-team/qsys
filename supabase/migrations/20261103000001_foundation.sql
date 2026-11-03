-- Phase 1 foundation: tenancy, profiles, branch settings, stations, pricing, audit log.
-- Every tenant table carries org_id and has RLS enabled. Writes that span tables
-- (onboarding, bulk station creation) go through SECURITY DEFINER RPCs.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'manager', 'staff');
create type public.station_type as enum ('pc', 'ps5', 'xbox', 'snooker', 'pool', 'other');
create type public.station_status as enum ('active', 'maintenance', 'disabled');
create type public.session_mode as enum ('open', 'prepaid');
create type public.leftover_policy as enum ('keep_days', 'same_day', 'forfeit');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orgs_updated_at before update on public.orgs
  for each row execute function private.set_updated_at();

create table public.memberships (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  address text,
  phone text,
  timezone text not null default 'Asia/Kolkata',
  opening_time time,
  closing_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index branches_org_idx on public.branches (org_id);

create trigger branches_updated_at before update on public.branches
  for each row execute function private.set_updated_at();

create table public.branch_settings (
  branch_id uuid primary key,
  org_id uuid not null,
  -- GST: off by default; invoices snapshot these values at checkout (Phase 2).
  gst_enabled boolean not null default false,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  gst_rate numeric(5, 2) not null default 18 check (gst_rate between 0 and 28),
  prices_include_tax boolean not null default true,
  invoice_prefix text not null default 'INV',
  -- Payment modes: which mode Start pre-selects, and which are allowed, per station type.
  default_mode_by_type jsonb not null default
    '{"pc":"prepaid","ps5":"open","xbox":"open","snooker":"open","pool":"open","other":"open"}',
  allowed_modes_by_type jsonb not null default
    '{"pc":["open","prepaid"],"ps5":["open","prepaid"],"xbox":["open","prepaid"],"snooker":["open","prepaid"],"pool":["open","prepaid"],"other":["open","prepaid"]}',
  -- Prepaid time packs: what happens to unused minutes.
  leftover_policy public.leftover_policy not null default 'keep_days',
  leftover_keep_days int not null default 30 check (leftover_keep_days between 1 and 365),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);

create trigger branch_settings_updated_at before update on public.branch_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Stations
-- ---------------------------------------------------------------------------
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  type public.station_type not null,
  name text not null check (length(trim(name)) between 1 and 40),
  zone text,
  tier text not null default 'standard' check (length(trim(tier)) between 1 and 30),
  status public.station_status not null default 'active',
  sort_order int not null default 0,
  hw_config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index stations_org_idx on public.stations (org_id);

create trigger stations_updated_at before update on public.stations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------
create table public.rate_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 60),
  station_type public.station_type not null,
  tier text, -- null = applies to every tier of this station type
  per_hour numeric(10, 2) not null check (per_hour >= 0),
  min_minutes int not null default 0 check (min_minutes between 0 and 600),
  rounding_minutes int not null default 1 check (rounding_minutes between 1 and 60),
  included_players int not null default 1 check (included_players between 1 and 16),
  extra_player_per_hour numeric(10, 2) not null default 0 check (extra_player_per_hour >= 0),
  gst_rate_override numeric(5, 2) check (gst_rate_override between 0 and 28),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index rate_plans_branch_idx on public.rate_plans (branch_id, station_type);
-- One active plan per (branch, type, tier) so pricing lookup is unambiguous.
create unique index rate_plans_one_active_idx
  on public.rate_plans (branch_id, station_type, coalesce(tier, ''))
  where is_active;

create trigger rate_plans_updated_at before update on public.rate_plans
  for each row execute function private.set_updated_at();

-- Time-of-day / weekday overrides (happy hour, weekend rates).
create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  rate_plan_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 60),
  days_of_week int[] not null default '{0,1,2,3,4,5,6}'
    check (days_of_week <@ array[0,1,2,3,4,5,6] and cardinality(days_of_week) > 0),
  start_time time not null,
  end_time time not null check (end_time <> start_time), -- end < start wraps past midnight
  per_hour numeric(10, 2) not null check (per_hour >= 0),
  priority int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (rate_plan_id, org_id) references public.rate_plans (id, org_id) on delete cascade
);
create index rate_rules_plan_idx on public.rate_rules (rate_plan_id);

-- Prepaid packages sold at the counter (e.g. 3 h for ₹150).
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 60),
  station_type public.station_type not null,
  tier text,
  minutes int not null check (minutes between 1 and 1440),
  price numeric(10, 2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index packages_branch_idx on public.packages (branch_id, station_type);

create trigger packages_updated_at before update on public.packages
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);

create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_details jsonb;
begin
  -- Skip rows removed by an org-level cascade delete; the org's log goes with it.
  if not exists (select 1 from public.orgs where id = (v_row ->> 'org_id')::uuid) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    -- Store only the fields that changed.
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), '{}')
      into v_details
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_details = '{}' then
      return new;
    end if;
  else
    v_details := v_row;
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (
    (v_row ->> 'org_id')::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'branch_id', v_row ->> 'user_id'),
    v_details
  );
  return coalesce(new, old);
end $$;

create trigger audit_branch_settings after insert or update or delete on public.branch_settings
  for each row execute function private.audit_row_change();
create trigger audit_stations after insert or update or delete on public.stations
  for each row execute function private.audit_row_change();
create trigger audit_rate_plans after insert or update or delete on public.rate_plans
  for each row execute function private.audit_row_change();
create trigger audit_rate_rules after insert or update or delete on public.rate_rules
  for each row execute function private.audit_row_change();
create trigger audit_packages after insert or update or delete on public.packages
  for each row execute function private.audit_row_change();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
create function private.has_org_role(
  p_org_id uuid,
  p_roles public.member_role[] default array['owner', 'manager', 'staff']::public.member_role[]
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org_id
       and m.user_id = (select auth.uid())
       and m.role = any (p_roles)
  );
$$;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.branches enable row level security;
alter table public.branch_settings enable row level security;
alter table public.stations enable row level security;
alter table public.rate_plans enable row level security;
alter table public.rate_rules enable row level security;
alter table public.packages enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: you, plus teammates in any org you belong to.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Orgs: members read, owners rename. Creation only via create_organization().
create policy orgs_select on public.orgs for select to authenticated
  using (private.has_org_role(id));
create policy orgs_update on public.orgs for update to authenticated
  using (private.has_org_role(id, array['owner']::public.member_role[]))
  with check (private.has_org_role(id, array['owner']::public.member_role[]));

-- Memberships: members see the team; owners manage it.
create policy memberships_select on public.memberships for select to authenticated
  using (private.has_org_role(org_id));
create policy memberships_owner_write on public.memberships for all to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

-- Branches: members read; owners create/edit/delete.
create policy branches_select on public.branches for select to authenticated
  using (private.has_org_role(org_id));
create policy branches_owner_write on public.branches for all to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

-- Branch settings (GST toggle etc.): members read; owner only writes.
create policy branch_settings_select on public.branch_settings for select to authenticated
  using (private.has_org_role(org_id));
create policy branch_settings_owner_write on public.branch_settings for all to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

-- Floor + pricing config: members read; owners and managers write.
create policy stations_select on public.stations for select to authenticated
  using (private.has_org_role(org_id));
create policy stations_manage on public.stations for all to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));

create policy rate_plans_select on public.rate_plans for select to authenticated
  using (private.has_org_role(org_id));
create policy rate_plans_manage on public.rate_plans for all to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));

create policy rate_rules_select on public.rate_rules for select to authenticated
  using (private.has_org_role(org_id));
create policy rate_rules_manage on public.rate_rules for all to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));

create policy packages_select on public.packages for select to authenticated
  using (private.has_org_role(org_id));
create policy packages_manage on public.packages for all to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));

-- Audit log: owners and managers read; rows are only written by triggers.
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.has_org_role(org_id, array['owner', 'manager']::public.member_role[]));

-- Anonymous visitors get nothing from these tables.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Onboarding: creates org + first branch + settings + owner membership in one go.
create function public.create_organization(
  p_org_name text,
  p_branch_name text,
  p_timezone text default 'Asia/Kolkata'
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

  insert into public.orgs (name, created_by) values (trim(p_org_name), v_uid)
    returning id into v_org_id;
  insert into public.memberships (org_id, user_id, role) values (v_org_id, v_uid, 'owner');
  insert into public.branches (org_id, name, timezone)
    values (v_org_id, trim(p_branch_name), p_timezone)
    returning id into v_branch_id;
  insert into public.branch_settings (branch_id, org_id) values (v_branch_id, v_org_id);

  return v_org_id;
end $$;

-- Owners adding another branch later.
create function public.create_branch(p_org_id uuid, p_name text, p_timezone text default 'Asia/Kolkata')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_branch_id uuid;
begin
  if not private.has_org_role(p_org_id, array['owner']::public.member_role[]) then
    raise exception 'only the owner can add branches' using errcode = '42501';
  end if;
  insert into public.branches (org_id, name, timezone) values (p_org_id, trim(p_name), p_timezone)
    returning id into v_branch_id;
  insert into public.branch_settings (branch_id, org_id) values (v_branch_id, p_org_id);
  return v_branch_id;
end $$;

-- Bulk add: "PC-" × 20 starting at 1 → PC-01 … PC-20 (zero-padded to the widest number).
create function public.bulk_create_stations(
  p_branch_id uuid,
  p_type public.station_type,
  p_prefix text,
  p_count int,
  p_start int default 1,
  p_tier text default 'standard',
  p_zone text default null
) returns setof public.stations
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_width int;
  v_next_sort int;
begin
  select org_id into v_org_id from public.branches where id = p_branch_id;
  if v_org_id is null
     or not private.has_org_role(v_org_id, array['owner', 'manager']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_count not between 1 and 200 or p_start < 0 then
    raise exception 'count must be between 1 and 200' using errcode = '22023';
  end if;

  v_width := greatest(2, length((p_start + p_count - 1)::text));
  select coalesce(max(sort_order), 0) into v_next_sort from public.stations where branch_id = p_branch_id;

  return query
  insert into public.stations (org_id, branch_id, type, name, tier, zone, sort_order)
  select v_org_id, p_branch_id, p_type,
         trim(p_prefix) || lpad((p_start + i)::text, v_width, '0'),
         coalesce(nullif(trim(p_tier), ''), 'standard'),
         nullif(trim(p_zone), ''),
         v_next_sort + i + 1
    from generate_series(0, p_count - 1) as i
  returning *;
end $$;

revoke execute on function public.create_organization(text, text, text) from public, anon;
revoke execute on function public.create_branch(uuid, text, text) from public, anon;
revoke execute on function public.bulk_create_stations(uuid, public.station_type, text, int, int, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
grant execute on function public.create_branch(uuid, text, text) to authenticated;
grant execute on function public.bulk_create_stations(uuid, public.station_type, text, int, int, text, text) to authenticated;
