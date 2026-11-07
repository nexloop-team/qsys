-- Players list: sort by recent visit, by spend, or only players who owe money,
-- and return what each player owes (unpaid, not written off).

drop function public.list_customers(uuid, text, int, int);

create function public.list_customers(
  p_org_id uuid,
  p_search text default null,
  p_limit int default 100,
  p_offset int default 0,
  p_sort text default 'recent'
)
returns table (
  id uuid, name text, phone text, created_at timestamptz,
  visits bigint, total_spent numeric, last_visit timestamptz, owed numeric, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_org_id);
  if p_sort not in ('recent', 'spent', 'owes') then
    raise exception 'Unknown sort.' using errcode = '22023';
  end if;
  return query
  with t as (
    select c.id, c.name, c.phone, c.created_at,
           count(s.id) as visits,
           coalesce(sum(s.billed_amount), 0) as total_spent,
           max(s.started_at) as last_visit,
           coalesce(sum(s.outstanding) filter (where not s.written_off), 0) as owed
      from public.customers c
      left join public.sessions s on s.customer_id = c.id
     where c.org_id = p_org_id
       and (coalesce(trim(p_search), '') = ''
            or (regexp_replace(p_search, '[^0-9]', '', 'g') <> ''
                and c.phone like '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%')
            or c.name ilike '%' || trim(p_search) || '%')
     group by c.id
  )
  select t.id, t.name, t.phone, t.created_at, t.visits, t.total_spent, t.last_visit, t.owed, count(*) over ()
    from t
   where p_sort <> 'owes' or t.owed > 0
   order by
     case when p_sort = 'spent' then t.total_spent end desc nulls last,
     case when p_sort = 'owes' then t.owed end desc nulls last,
     t.last_visit desc nulls last,
     t.created_at desc
   limit least(greatest(p_limit, 1), 500)
  offset greatest(p_offset, 0);
end $$;

revoke execute on function public.list_customers(uuid, text, int, int, text) from public, anon;
grant execute on function public.list_customers(uuid, text, int, int, text) to authenticated;
