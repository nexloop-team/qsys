-- Three counter features:
--   1. Tamper alerts: a PC that went quiet during a session (or whose app was closed while it was
--      locked) is flagged on the floor and in Activity, with the likely cause.
--   2. Vouchers: one-time codes worth a rupee amount (e.g. for an Instagram contest), redeemed
--      into a player's wallet at the counter or from the PC's games menu.
--   3. Shift close: staff count the cash drawer; the app shows what was expected and the difference.

-- ===========================================================================
-- 1. Tamper alerts
-- ===========================================================================
create table public.pc_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  station_id uuid not null references public.stations (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  -- app_closed: Windows kept running but the QueSys app did not (closed or killed).
  -- pc_restarted: the PC was switched off or restarted (power cut, crash or on purpose).
  -- offline: the app ran but could not reach QueSys (cable pulled, Wi-Fi or internet down).
  kind text not null check (kind in ('app_closed', 'pc_restarted', 'offline')),
  away_from timestamptz not null,
  away_until timestamptz not null,
  customer_name text,
  dismissed_by uuid references auth.users (id) on delete set null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index pc_alerts_open_idx on public.pc_alerts (branch_id, created_at desc) where dismissed_at is null;

alter table public.pc_alerts enable row level security;
create policy pc_alerts_select on public.pc_alerts for select to authenticated
  using (private.has_org_role(org_id));
revoke all on public.pc_alerts from anon;
revoke insert, update, delete on public.pc_alerts from authenticated;
alter publication supabase_realtime add table public.pc_alerts;

-- Staff mark an alert as seen.
create function public.dismiss_pc_alert(p_alert_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.pc_alerts;
begin
  select * into a from public.pc_alerts where id = p_alert_id;
  if not found then
    raise exception 'Alert not found.' using errcode = '22023';
  end if;
  perform private.assert_member(a.org_id);
  update public.pc_alerts set dismissed_at = now(), dismissed_by = auth.uid()
   where id = a.id and dismissed_at is null;
end $$;

-- Called at each check-in, before last_seen_at moves on. A PC checks in every 15 s; two minutes
-- of silence is a gap worth explaining. The app sends how long Windows and the app itself have
-- been running, which tells the causes apart.
create function private.check_pc_gap(d public.devices, p_info jsonb) returns void
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
  -- a closed app on a running PC means it may have been used without paying.
  if s.id is null and v_kind <> 'app_closed' then
    return;
  end if;

  insert into public.pc_alerts (org_id, branch_id, station_id, session_id, kind, away_from, away_until, customer_name)
  values (d.org_id, d.branch_id, d.station_id, s.id, v_kind, d.last_seen_at, now(), s.customer_name);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (d.org_id, null, 'pc_alert', 'devices', d.station_id::text,
          jsonb_build_object('name', st.name, 'kind', v_kind, 'minutes', round(v_gap / 60))
            || jsonb_strip_nulls(jsonb_build_object('customer', s.customer_name)));
end $$;

-- Check-in, as in 20261129000002, plus the gap check.
create or replace function public.agent_sync(p_token text, p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  st public.stations;
  bs public.branch_settings;
  s public.sessions;
  v_mac text := upper(replace(coalesce(p_info ->> 'mac', ''), '-', ':'));
  v_health jsonb := p_info -> 'health';
  v_wallet numeric;
  v_menu jsonb := '[]';
  v_requests jsonb := '[]';
begin
  d := private.device_for_token(p_token);
  perform private.check_pc_gap(d, coalesce(p_info, '{}'));
  select * into st from public.stations where id = d.station_id;
  select * into bs from public.branch_settings where branch_id = d.branch_id;
  select * into s from public.sessions where station_id = d.station_id and status <> 'ended';

  if jsonb_typeof(v_health) <> 'object' or length(v_health::text) > 2000 then
    v_health := null;
  end if;

  update public.devices
     set last_seen_at = now(),
         hostname = coalesce(left(p_info ->> 'hostname', 64), hostname),
         agent_version = coalesce(left(p_info ->> 'version', 20), agent_version),
         os = coalesce(left(p_info ->> 'os', 64), os),
         ip = coalesce(left(p_info ->> 'ip', 45), ip),
         mac = case when v_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then v_mac else mac end,
         screen_locked = coalesce((p_info ->> 'locked')::boolean, screen_locked),
         health = coalesce(v_health, health),
         health_at = case when v_health is not null then now() else health_at end
   where id = d.id;

  update public.station_commands set delivered_at = now()
   where station_id = d.station_id and done_at is null and delivered_at is null;

  if s.id is not null then
    if s.customer_id is not null then
      select wallet_balance into v_wallet from public.customers where id = s.customer_id;
    end if;
    if coalesce(bs.qr_orders, false) then
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'category', category)
                                order by category, name), '[]')
        into v_menu
        from (select * from public.products
               where branch_id = d.branch_id and is_active and (stock is null or stock > 0)
               order by category, name limit 100) pr;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'status', r.status)
                              order by r.created_at desc), '[]')
      into v_requests
      from (select * from public.station_requests where session_id = s.id order by created_at desc limit 5) r;
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'channel', d.channel,
    'venue', (select name from public.orgs where id = d.org_id),
    'branch', (select name from public.branches where id = d.branch_id),
    'station', jsonb_build_object('id', st.id, 'name', st.name, 'status', st.status),
    'lock_message', bs.lock_message,
    'blocked_apps', to_jsonb(bs.blocked_apps),
    'player_login', coalesce(bs.pc_player_login, false),
    'games', coalesce(bs.pc_games, '[]'),
    'restrictions', to_jsonb(coalesce(bs.pc_restrictions, '{}')),
    'orders', coalesce(bs.qr_orders, false),
    'wallet', v_wallet,
    'vouchers', s.customer_id is not null,
    'menu', v_menu,
    'requests', v_requests,
    'session', case when s.id is null then null else jsonb_build_object(
        'id', s.id,
        'mode', s.mode,
        'status', s.status,
        'started_at', s.started_at,
        'planned_end_at', s.planned_end_at,
        'paused_at', s.paused_at,
        'customer_name', s.customer_name) end,
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'payload', c.payload) order by c.created_at)
        from public.station_commands c
       where c.station_id = d.station_id and c.done_at is null and c.created_at > now() - interval '10 minutes'), '[]')
  );
end $$;

-- ===========================================================================
-- 2. Vouchers
-- ===========================================================================
create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- 8 characters without look-alikes (no 0/O, 1/I/L), shown as ABCD-EFGH.
  code text not null check (code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 10000),
  note text check (note is null or char_length(note) <= 80),
  expires_on date,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_branch_id uuid references public.branches (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  voided_at timestamptz,
  unique (org_id, code)
);
create index vouchers_org_idx on public.vouchers (org_id, created_at desc);

alter table public.vouchers enable row level security;
create policy vouchers_select on public.vouchers for select to authenticated
  using (private.has_org_role(org_id));
revoke all on public.vouchers from anon;
revoke insert, update, delete on public.vouchers from authenticated;

create function private.voucher_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
  end loop;
  return v_code;
end $$;

-- Owner: make 1–100 vouchers at once. Returns the codes.
create function public.create_vouchers(
  p_org_id uuid,
  p_count int,
  p_amount numeric,
  p_expires_on date default null,
  p_note text default null
) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_codes text[] := '{}';
  v_code text;
begin
  perform private.assert_member(p_org_id, array['owner']::public.member_role[]);
  if p_count is null or p_count not between 1 and 100 then
    raise exception 'Make 1 to 100 vouchers at a time.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    raise exception 'A voucher is worth ₹1 to ₹10,000.' using errcode = '22023';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'The expiry date has already passed.' using errcode = '22023';
  end if;
  for i in 1..p_count loop
    loop
      v_code := private.voucher_code();
      begin
        insert into public.vouchers (org_id, code, amount, note, expires_on)
        values (p_org_id, v_code, round(p_amount, 2), nullif(trim(coalesce(p_note, '')), ''), p_expires_on);
        exit;
      exception when unique_violation then
        -- the same code twice in one venue: draw again
      end;
    end loop;
    v_codes := v_codes || v_code;
  end loop;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (p_org_id, auth.uid(), 'insert', 'vouchers', null,
          jsonb_build_object('_label', p_count || ' × ₹' || trim(to_char(p_amount, 'FM999990.##')) ||
                             coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), '')));
  return v_codes;
end $$;

-- Owner: cancel an unused voucher (e.g. it was shared by mistake).
create function public.void_voucher(p_voucher_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers;
begin
  select * into v from public.vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'Voucher not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v.org_id, array['owner']::public.member_role[]);
  if v.redeemed_at is not null then
    raise exception 'This voucher has already been used.' using errcode = '22023';
  end if;
  update public.vouchers set voided_at = coalesce(voided_at, now()) where id = v.id;
end $$;

-- Shared by the counter and the PC: check the code and credit the wallet (as bonus credit, like
-- top-up offers: it isn't money received). Returns {amount, balance}.
create function private.use_voucher(p_customer_id uuid, p_code text, p_branch_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v public.vouchers;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date;
  v_balance numeric;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  select * into v from public.vouchers where org_id = c.org_id and code = v_code for update;
  if not found or v.voided_at is not null then
    raise exception 'That voucher code isn''t valid.' using errcode = '22023';
  end if;
  if v.redeemed_at is not null then
    raise exception 'That voucher has already been used.' using errcode = '22023';
  end if;
  select (now() at time zone timezone)::date into v_today from public.branches where id = p_branch_id;
  if v.expires_on is not null and v.expires_on < coalesce(v_today, current_date) then
    raise exception 'That voucher expired on %.', to_char(v.expires_on, 'FMDD Mon YYYY') using errcode = '22023';
  end if;

  v_balance := c.wallet_balance + v.amount;
  update public.customers set wallet_balance = v_balance where id = c.id;
  insert into public.wallet_transactions (org_id, branch_id, customer_id, amount, balance_after, method, note, created_by)
  values (c.org_id, p_branch_id, c.id, v.amount, v_balance, 'bonus',
          'Voucher ' || left(v.code, 4) || '-' || right(v.code, 4) || coalesce(' · ' || v.note, ''), auth.uid());
  update public.vouchers
     set redeemed_at = now(), redeemed_by = auth.uid(), redeemed_branch_id = p_branch_id, customer_id = c.id
   where id = v.id;
  return jsonb_build_object('amount', v.amount, 'balance', v_balance);
end $$;

-- Staff at the counter: redeem a voucher into a player's wallet.
create function public.redeem_voucher(p_customer_id uuid, p_code text, p_branch_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.customers where id = p_customer_id;
  if v_org is null then
    raise exception 'Player not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);
  return private.use_voucher(p_customer_id, p_code, private.wallet_branch(v_org, p_branch_id));
end $$;

-- The PC's games menu: the player of the running session redeems a voucher into their wallet.
-- Wrong codes count towards the same per-PC limit as wrong login PINs.
create function public.agent_redeem_voucher(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
  s public.sessions;
  v_result jsonb;
begin
  d := private.device_for_token(p_token);
  select * into s from public.sessions where station_id = d.station_id and status <> 'ended';
  if s.customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'Vouchers go into a player''s wallet. Ask at the counter.');
  end if;
  if (select count(*) from private.pc_login_failures where device_id = d.id and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries on this PC. Wait 10 minutes or ask at the counter.');
  end if;
  begin
    v_result := private.use_voucher(s.customer_id, p_code, d.branch_id);
  exception when sqlstate '22023' then
    insert into private.pc_login_failures (device_id) values (d.id);
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true) || v_result;
end $$;

-- ===========================================================================
-- 3. Shift close
-- ===========================================================================
create table public.shift_closes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  closed_by uuid references auth.users (id) on delete set null default auth.uid(),
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  -- Cash left in the drawer by the previous close.
  opening_float numeric(12, 2) not null default 0,
  -- Cash bills, plus wallet top-ups minus refunds paid in cash.
  cash_sales numeric(12, 2) not null default 0,
  cash_wallet numeric(12, 2) not null default 0,
  upi_total numeric(12, 2) not null default 0,
  expected_cash numeric(12, 2) not null,
  counted_cash numeric(12, 2) not null check (counted_cash >= 0),
  difference numeric(12, 2) not null,
  -- Kept in the drawer for the next shift; the rest goes to the owner.
  float_left numeric(12, 2) not null default 0 check (float_left >= 0 and float_left <= counted_cash),
  note text check (note is null or char_length(note) <= 200),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index shift_closes_branch_idx on public.shift_closes (branch_id, closed_at desc);

alter table public.shift_closes enable row level security;
create policy shift_closes_select on public.shift_closes for select to authenticated
  using (private.has_org_role(org_id));
revoke all on public.shift_closes from anon;
revoke insert, update, delete on public.shift_closes from authenticated;

-- The running shift: since the last close (or the start of today, for the first one). Each row
-- counts in exactly one shift: after one close, up to and including the next.
create function public.shift_status(p_branch_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches;
  last public.shift_closes;
  v_from timestamptz;
  v_float numeric := 0;
  v_cash numeric;
  v_wallet numeric;
  v_upi numeric;
begin
  select * into b from public.branches where id = p_branch_id;
  if not found then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(b.org_id);

  select * into last from public.shift_closes where branch_id = b.id order by closed_at desc limit 1;
  if last.id is not null then
    v_from := last.closed_at;
    v_float := last.float_left;
  else
    v_from := (date_trunc('day', now() at time zone b.timezone)) at time zone b.timezone;
  end if;

  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'upi'), 0)
    into v_cash, v_upi
    from public.payments p join public.invoices i on i.id = p.invoice_id
   where i.branch_id = b.id and i.voided_at is null and i.created_at > v_from and i.created_at <= now();
  select coalesce(sum(amount) filter (where method = 'cash'), 0),
         v_upi + coalesce(sum(amount) filter (where method = 'upi'), 0)
    into v_wallet, v_upi
    from public.wallet_transactions
   where branch_id = b.id and method in ('cash', 'upi') and created_at > v_from and created_at <= now();

  return jsonb_build_object(
    'since', v_from,
    'first', last.id is null,
    'opening_float', v_float,
    'cash_sales', v_cash,
    'cash_wallet', v_wallet,
    'upi_total', v_upi,
    'expected_cash', v_float + v_cash + v_wallet);
end $$;

-- Close the shift with the counted cash. Anyone on the team can close; the owner sees them all.
create function public.close_shift(
  p_branch_id uuid,
  p_counted numeric,
  p_float_left numeric default 0,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.branches;
  v_status jsonb;
  v_id uuid;
  v_diff numeric;
begin
  -- One close at a time per branch.
  select * into b from public.branches where id = p_branch_id for update;
  if not found then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(b.org_id);
  if p_counted is null or p_counted < 0 or p_counted > 10000000 then
    raise exception 'Enter the cash you counted.' using errcode = '22023';
  end if;
  if coalesce(p_float_left, 0) < 0 or coalesce(p_float_left, 0) > p_counted then
    raise exception 'The cash left in the drawer can''t be more than you counted.' using errcode = '22023';
  end if;
  if exists (select 1 from public.shift_closes where branch_id = b.id and closed_at > now() - interval '1 minute') then
    raise exception 'This shift was just closed.' using errcode = '22023';
  end if;

  v_status := public.shift_status(b.id);
  v_diff := round(p_counted - (v_status ->> 'expected_cash')::numeric, 2);
  insert into public.shift_closes (org_id, branch_id, opened_at, opening_float, cash_sales, cash_wallet, upi_total,
                                   expected_cash, counted_cash, difference, float_left, note)
  values (b.org_id, b.id, (v_status ->> 'since')::timestamptz, (v_status ->> 'opening_float')::numeric,
          (v_status ->> 'cash_sales')::numeric, (v_status ->> 'cash_wallet')::numeric, (v_status ->> 'upi_total')::numeric,
          (v_status ->> 'expected_cash')::numeric, round(p_counted, 2), v_diff, round(coalesce(p_float_left, 0), 2),
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, details)
  values (b.org_id, auth.uid(), 'shift_close', 'shift_closes', v_id::text,
          jsonb_build_object('name', b.name, 'counted', round(p_counted, 2), 'difference', v_diff));
  return v_id;
end $$;

-- ===========================================================================
-- Grants
-- ===========================================================================
revoke execute on function
  private.check_pc_gap(public.devices, jsonb),
  private.voucher_code(),
  private.use_voucher(uuid, text, uuid)
from public, anon, authenticated;
revoke execute on function
  public.dismiss_pc_alert(uuid),
  public.create_vouchers(uuid, int, numeric, date, text),
  public.void_voucher(uuid),
  public.redeem_voucher(uuid, text, uuid),
  public.agent_redeem_voucher(text, text),
  public.shift_status(uuid),
  public.close_shift(uuid, numeric, numeric, text)
from public, anon;
grant execute on function
  public.dismiss_pc_alert(uuid),
  public.create_vouchers(uuid, int, numeric, date, text),
  public.void_voucher(uuid),
  public.redeem_voucher(uuid, text, uuid),
  public.shift_status(uuid),
  public.close_shift(uuid, numeric, numeric, text)
to authenticated;
grant execute on function public.agent_redeem_voucher(text, text) to anon, authenticated;
