-- Player PC login, real-world guards: a player who owes money from an earlier visit pays first,
-- and one player can't run sessions on two PCs at once (e.g. a friend using their number).
-- Apply after 20261119000001 (this replaces its agent_player_login).

create or replace function public.agent_player_login(p_token text, p_mobile text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  st public.stations;
  bs public.branch_settings;
  plan public.rate_plans;
  cu public.customers;
  v_tz text;
  v_phone text;
  v_session uuid;
  v_elsewhere text;
  v_owed numeric;
begin
  d := private.device_for_token(p_token);
  select * into st from public.stations where id = d.station_id;
  select * into bs from public.branch_settings where branch_id = d.branch_id;
  select timezone into v_tz from public.branches where id = d.branch_id;

  if not coalesce(bs.pc_player_login, false) then
    return jsonb_build_object('ok', false, 'error', 'Ask at the counter to start your session.');
  end if;
  if st.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'This PC is out of service.');
  end if;
  if exists (select 1 from public.sessions where station_id = st.id and status <> 'ended') then
    return jsonb_build_object('ok', false, 'error', 'This PC already has a session. Ask at the counter.');
  end if;
  if (select count(*) from private.pc_login_failures where device_id = d.id and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries on this PC. Wait 10 minutes or ask at the counter.');
  end if;

  begin
    v_phone := private.normalize_phone(p_mobile);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Enter your 10-digit mobile number.');
  end;

  select * into cu from public.customers where org_id = d.org_id and phone = v_phone for update;
  if cu.id is not null and cu.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error',
      'Too many wrong PINs. Try again after ' || to_char(cu.pin_locked_until at time zone v_tz, 'FMHH12:MI AM')
      || ', or ask at the counter.');
  end if;

  if cu.id is null or cu.pin_hash is null or extensions.crypt(coalesce(p_pin, ''), cu.pin_hash) <> cu.pin_hash then
    delete from private.pc_login_failures where at < now() - interval '1 day';
    insert into private.pc_login_failures (device_id) values (d.id);
    if cu.pin_hash is not null then
      -- 5 wrong PINs lock this mobile number for 15 minutes.
      update public.customers
         set pin_failed = case when pin_failed + 1 >= 5 then 0 else pin_failed + 1 end,
             pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' end
       where id = cu.id;
    end if;
    -- Same answer for an unknown number and a wrong PIN.
    return jsonb_build_object('ok', false, 'error', 'Wrong mobile number or PIN. No PIN yet? Ask at the counter.');
  end if;

  update public.customers set pin_failed = 0, pin_locked_until = null where id = cu.id;

  -- Checked after the PIN, so these answers never reveal anything about a number to a stranger.
  select st2.name into v_elsewhere
    from public.sessions s2 join public.stations st2 on st2.id = s2.station_id
   where s2.customer_id = cu.id and s2.status <> 'ended'
   limit 1;
  if v_elsewhere is not null then
    return jsonb_build_object('ok', false, 'error',
      'You''re already playing on ' || v_elsewhere || '. Ask at the counter to move your session here.');
  end if;
  select coalesce(sum(outstanding), 0) into v_owed
    from public.sessions
   where customer_id = cu.id and status = 'ended' and not written_off and outstanding > 0;
  if v_owed > 0 then
    return jsonb_build_object('ok', false, 'error',
      'You have ₹' || trim(to_char(v_owed, 'FM999999990.00')) || ' unpaid from an earlier visit. Please pay at the counter first.');
  end if;

  plan := private.resolve_rate_plan(st.id);
  if plan.id is null or not coalesce((bs.allowed_modes_by_type -> st.type::text) ? 'open', false) then
    return jsonb_build_object('ok', false, 'error', 'Ask at the counter to start your session.');
  end if;

  begin
    insert into public.sessions (
      org_id, branch_id, station_id, rate_plan_id, mode, customer_id, customer_name, customer_phone, players,
      planned_end_at, prepaid_minutes, prepaid_amount, started_by)
    values (
      st.org_id, st.branch_id, st.id, plan.id, 'open', cu.id, cu.name, cu.phone, 1,
      null, 0, 0, null)
    returning id into v_session;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'This PC already has a session. Ask at the counter.');
  end;

  perform private.log_session_event(st.org_id, v_session, 'start',
    jsonb_build_object('mode', 'open', 'minutes', 0, 'price', 0, 'customer_id', cu.id, 'source', 'pc_login'));
  return jsonb_build_object('ok', true, 'name', cu.name);
end $$;

revoke execute on function public.agent_player_login(text, text, text) from public;
grant execute on function public.agent_player_login(text, text, text) to anon, authenticated;
