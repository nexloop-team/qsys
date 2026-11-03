-- Expenses: what the venue spends (rent, power, salaries…), so reports can show net profit.
-- Owner only. A salary can name the team member it was paid to.

create type public.expense_category as enum (
  'salary', 'rent', 'electricity', 'internet', 'maintenance', 'supplies', 'marketing', 'other'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  category public.expense_category not null,
  -- Shown in lists and the activity log, e.g. "Salary · Ravi" or "Electricity bill".
  name text not null check (char_length(trim(name)) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0 and amount < 10000000),
  spent_on date not null,
  staff_id uuid,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade,
  -- Salary rows point at a member of the same venue; removing the member keeps the row.
  foreign key (org_id, staff_id) references public.memberships (org_id, user_id) on delete set null (staff_id),
  constraint expenses_staff_only_for_salary check (category = 'salary' or staff_id is null)
);

create index expenses_branch_day_idx on public.expenses (branch_id, spent_on);

create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function private.set_updated_at();
create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function private.audit_row_change();

alter table public.expenses enable row level security;

create policy expenses_owner_all on public.expenses for all to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

revoke all on public.expenses from anon;
