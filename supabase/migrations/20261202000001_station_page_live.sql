-- The table QR page (/s/<code>) updates the moment something changes, instead of asking every
-- 10 seconds. A change to the station's session, its snacks or its requests sends a "changed"
-- signal on the page's public channel ('qs-station-<code>'). The signal carries no data: the page
-- reloads its view through public_station() as before. If Realtime isn't available the signal is
-- skipped and the page falls back to asking every minute.
-- Apply after 20261201000001_simpler_billing.sql.

create function private.poke_station_page(p_station_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  select public_code into v_code from public.stations where id = p_station_id;
  if v_code is null then
    return;
  end if;
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'changed', 'qs-station-' || v_code, false);
  exception when others then
    null; -- never let a missed signal stop a bill or a session
  end;
end $$;

create function private.poke_page_on_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_station uuid;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'session_items' then
    select station_id into v_station from public.sessions where id = r.session_id;
  else
    v_station := r.station_id; -- sessions, station_requests
  end if;
  if v_station is not null then
    perform private.poke_station_page(v_station);
  end if;
  -- A session moved to another station: the old station's page changes too.
  if tg_table_name = 'sessions' and tg_op = 'UPDATE' then
    if old.station_id is distinct from new.station_id then
      perform private.poke_station_page(old.station_id);
    end if;
  end if;
  return null;
end $$;

revoke execute on function private.poke_station_page(uuid) from public, anon, authenticated;
revoke execute on function private.poke_page_on_change() from public, anon, authenticated;

create trigger sessions_poke_page after insert or update or delete on public.sessions
  for each row execute function private.poke_page_on_change();
create trigger session_items_poke_page after insert or update or delete on public.session_items
  for each row execute function private.poke_page_on_change();
create trigger station_requests_poke_page after insert or update or delete on public.station_requests
  for each row execute function private.poke_page_on_change();
