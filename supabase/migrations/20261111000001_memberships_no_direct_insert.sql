-- Owners could insert a membership for any user id straight through the API, adding
-- people to their venue without an invite. New members now only join through
-- create_organization() or accept_invite() (security definer); owners keep
-- changing roles and removing members.

drop policy if exists memberships_owner_write on public.memberships;

create policy memberships_owner_update on public.memberships for update to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(org_id, array['owner']::public.member_role[]));

create policy memberships_owner_delete on public.memberships for delete to authenticated
  using (private.has_org_role(org_id, array['owner']::public.member_role[]));

revoke insert on public.memberships from authenticated;
