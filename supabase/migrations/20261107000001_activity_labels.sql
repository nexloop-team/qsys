-- Activity feed: record the item's name on updates too (only changed fields were stored before),
-- so the log can say "changed station PC-03 (status: active → maintenance)".
create or replace function private.audit_row_change() returns trigger
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
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), '{}')
      into v_details
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_details = '{}' then
      return new;
    end if;
    if v_row ? 'name' then
      v_details := v_details || jsonb_build_object('_label', v_row ->> 'name');
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

revoke execute on function private.audit_row_change() from public, anon, authenticated;
