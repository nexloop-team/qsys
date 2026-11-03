-- Two roles only: owner (everything) and staff (runs the floor).
-- Existing managers become staff. The enum keeps 'manager' (Postgres can't drop enum values),
-- but constraints stop it being used, so every "owner or manager" check now means owner.

update public.memberships set role = 'staff' where role = 'manager';
update public.team_invites set role = 'staff' where role = 'manager';

alter table public.memberships
  add constraint memberships_owner_or_staff check (role in ('owner', 'staff'));
alter table public.team_invites
  add constraint team_invites_staff_only check (role = 'staff');

-- Invites are always for staff (p_role is ignored); the owner can promote someone after they join.
create or replace function public.create_invite(p_org_id uuid, p_role public.member_role) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  perform private.assert_member(p_org_id, array['owner']::public.member_role[]);
  -- 8 chars from an unambiguous alphabet (no 0/O, 1/I).
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
    into v_code
    from extensions.gen_random_bytes(8) b, generate_series(0, 7) i;
  insert into public.team_invites (org_id, code, role, created_by) values (p_org_id, v_code, 'staff', auth.uid());
  return v_code;
end $$;

-- An org must always keep at least one owner.
create function private.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(old.org_id, new.org_id);
begin
  if exists (select 1 from public.orgs where id = v_org)
     and not exists (select 1 from public.memberships where org_id = v_org and role = 'owner') then
    raise exception 'A venue needs at least one owner.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger memberships_keep_owner
  after update or delete on public.memberships
  deferrable initially deferred
  for each row execute function private.keep_an_owner();

revoke execute on function private.keep_an_owner() from public, anon, authenticated;
