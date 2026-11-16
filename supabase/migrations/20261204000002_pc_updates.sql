-- The PC app updates itself (signed releases, only while nobody is playing). Here:
--   1. An "update" command from the floor or Settings › PC app: check now, install when free.
--   2. update_all_pcs: the owner asks every PC in a branch to update.
--   3. An app restarted by an update isn't a tamper alert: the app was closed while locked, but it
--      came back with a new version and nobody was playing.
-- Apply after 20261204000001_options_private_cost.sql.

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.station_commands'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.station_commands drop constraint %I', c);
  end loop;
end $$;
alter table public.station_commands
  add constraint station_commands_kind_check check (kind in ('message', 'restart', 'shutdown', 'wake', 'update'));

create or replace function public.send_station_command(p_station_id uuid, p_kind text, p_payload jsonb default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  target public.devices;
  helper public.devices;
  v_id uuid;
begin
  select * into st from public.stations where id = p_station_id;
  if not found then
    raise exception 'Station not found.' using errcode = '22023';
  end if;
  perform private.assert_member(st.org_id);
  select * into target from public.devices where station_id = st.id;
  if target.id is null then
    raise exception '% has no PC app paired.', st.name using errcode = '22023';
  end if;

  if p_kind = 'message' then
    if char_length(trim(coalesce(p_payload ->> 'text', ''))) not between 1 and 140 then
      raise exception 'Write a message of up to 140 characters.' using errcode = '22023';
    end if;
  elsif p_kind = 'wake' then
    if target.mac is null then
      raise exception '% hasn''t reported its network address yet. Turn it on by hand once.', st.name using errcode = '22023';
    end if;
    -- A sleeping PC can't receive anything: another online PC on the same network sends the wake signal.
    select * into helper from public.devices
     where branch_id = st.branch_id and station_id <> st.id and last_seen_at > now() - interval '90 seconds'
     order by last_seen_at desc limit 1;
    if helper.id is null then
      raise exception 'No other PC in this branch is online to wake %.', st.name using errcode = '22023';
    end if;
    insert into public.station_commands (org_id, station_id, kind, payload)
    values (st.org_id, helper.station_id, 'wake', jsonb_build_object('mac', target.mac, 'for', st.name))
    returning id into v_id;
    return v_id;
  elsif p_kind not in ('restart', 'shutdown', 'update') then
    raise exception 'Unknown command.' using errcode = '22023';
  end if;

  insert into public.station_commands (org_id, station_id, kind, payload)
  values (st.org_id, st.id, p_kind, coalesce(p_payload, '{}'))
  returning id into v_id;
  return v_id;
end $$;

-- Owner: ask every paired PC in the branch to update (each installs when nobody is on it).
create function public.update_all_pcs(p_branch_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_count int;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org, array['owner']::public.member_role[]);
  insert into public.station_commands (org_id, station_id, kind)
  select d.org_id, d.station_id, 'update'
    from public.devices d
   where d.branch_id = p_branch_id
     -- One waiting update per PC is enough.
     and not exists (select 1 from public.station_commands c
                      where c.station_id = d.station_id and c.kind = 'update' and c.done_at is null);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.update_all_pcs(uuid) from public, anon;
grant execute on function public.update_all_pcs(uuid) to authenticated;

-- The gap check from 20261130000001, plus: an app that came back with a new version, on a PC
-- with no session, was updating.
create or replace function private.check_pc_gap(d public.devices, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.stations;
  s public.sessions;
  v_gap numeric;
  v_uptime numeric;
  v_app numeric;
  v_kind text;
begin
  if d.last_seen_at is null then
    return;
  end if;
  v_gap := extract(epoch from now() - d.last_seen_at);
  if v_gap < 120 then
    return;
  end if;
  v_uptime := case when jsonb_typeof(p_info -> 'uptime_s') = 'number' then (p_info ->> 'uptime_s')::numeric end;
  v_app := case when jsonb_typeof(p_info -> 'app_uptime_s') = 'number' then (p_info ->> 'app_uptime_s')::numeric end;
  v_kind := case
    when v_uptime is not null and v_uptime < v_gap then 'pc_restarted'
    when v_app is not null and v_app < v_gap then 'app_closed'
    else 'offline'
  end;

  select * into st from public.stations where id = d.station_id;
  if st.status = 'maintenance' then
    return; -- staff are working on it
  end if;
  -- Restarted or shut down from the floor: expected.
  if exists (select 1 from public.station_commands
              where station_id = d.station_id and kind in ('restart', 'shutdown')
                and created_at between d.last_seen_at - interval '2 minutes' and now()) then
    return;
  end if;

  -- The session that was on this PC when it went quiet (if any).
  select * into s from public.sessions
   where station_id = d.station_id
     and started_at <= d.last_seen_at
     and (ended_at is null or ended_at > d.last_seen_at + interval '1 minute')
   order by started_at desc limit 1;

  -- Without a session the PC was locked: switching it off or losing the internet is normal, but
  -- a closed app on a running PC means it may have been used without paying. Unless it came
  -- back as a newer version: that was an update.
  if s.id is null and (v_kind <> 'app_closed'
                       or (p_info ? 'version' and (p_info ->> 'version') is distinct from d.agent_version)) then
    return;
  end if;

  insert into public.pc_alerts (org_id, branch_id, station_id, session_id, kind, away_from, away_until, customer_name)
  values (d.org_id, d.branch_id, d.station_id, s.id, v_kind, d.last_seen_at, now(), s.customer_name);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (d.org_id, null, 'pc_alert', 'devices', d.station_id::text,
          jsonb_build_object('name', st.name, 'kind', v_kind, 'minutes', round(v_gap / 60))
            || jsonb_strip_nulls(jsonb_build_object('customer', s.customer_name)));
end $$;
