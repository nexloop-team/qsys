begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Fixture: owner + staff, two PCs (device keys 'key-t' on PC-01, 'key-u' on PC-02), Coke ₹50,
-- player Kiran (9876500077).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@tamper.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'staff@tamper.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000d0', 'Tamper Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('10000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000d2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0');
insert into public.stations (id, org_id, branch_id, type, name) values
  ('30000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d0', '20000000-0000-0000-0000-0000000000d0', 'pc', 'PC-01'),
  ('30000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d0', '20000000-0000-0000-0000-0000000000d0', 'pc', 'PC-02');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000d0', '20000000-0000-0000-0000-0000000000d0', 'PC', 'pc', 60);
insert into public.products (id, org_id, branch_id, name, category, price)
  values ('60000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0',
          '20000000-0000-0000-0000-0000000000d0', 'Coke', 'beverage', 50);
insert into public.customers (id, org_id, phone, name)
  values ('70000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0', '9876500077', 'Kiran');
insert into public.devices (org_id, branch_id, station_id, token_hash, channel) values
  ('10000000-0000-0000-0000-0000000000d0', '20000000-0000-0000-0000-0000000000d0', '30000000-0000-0000-0000-0000000000d1',
   encode(extensions.digest('key-t', 'sha256'), 'hex'), gen_random_uuid()),
  ('10000000-0000-0000-0000-0000000000d0', '20000000-0000-0000-0000-0000000000d0', '30000000-0000-0000-0000-0000000000d2',
   encode(extensions.digest('key-u', 'sha256'), 'hex'), gen_random_uuid());

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_pc() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
-- The PC was last heard from `mins` minutes ago, then checks in with these uptimes.
create function pg_temp.gap(p_key text, p_mins int, p_uptime int, p_app int) returns void language plpgsql as $$
begin
  update public.devices set last_seen_at = now() - make_interval(mins => p_mins)
   where token_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  perform pg_temp.as_pc();
  perform public.agent_sync(p_key, jsonb_build_object('uptime_s', p_uptime, 'app_uptime_s', p_app));
  reset role;
end $$;
create function pg_temp.alerts(p_station uuid) returns int language sql as $$
  select count(*)::int from public.pc_alerts where station_id = p_station;
$$;
create function pg_temp.wallet() returns numeric language sql as $$
  select wallet_balance from public.customers where id = '70000000-0000-0000-0000-0000000000d0';
$$;

-- Tamper alerts ---------------------------------------------------------------------------------
-- Kiran plays on PC-01.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.start_session('30000000-0000-0000-0000-0000000000d1', 'open', '9876500077');
reset role;
update public.sessions set started_at = now() - interval '1 hour'
 where station_id = '30000000-0000-0000-0000-0000000000d1';

select pg_temp.gap('key-t', 10, 86400, 30);
select is((select kind from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d1' order by created_at desc, kind limit 1),
  'app_closed', 'app closed while Windows kept running is flagged');
select is((select customer_name from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d1' limit 1),
  'Kiran', 'with the player of the session');
select pg_temp.gap('key-t', 6, 60, 60);
select ok(exists (select 1 from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d1' and kind = 'pc_restarted'),
  'a PC switched off mid-session is flagged as a restart');
select pg_temp.gap('key-t', 5, 86400, 86400);
select ok(exists (select 1 from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d1' and kind = 'offline'),
  'a lost connection mid-session is flagged');
select pg_temp.gap('key-t', 1, 86400, 30);
select is(pg_temp.alerts('30000000-0000-0000-0000-0000000000d1'), 3, 'a short blip is not an alert');

-- PC-02 has no session: switched off overnight is normal, but a closed app means free play.
select pg_temp.gap('key-u', 600, 60, 60);
select is(pg_temp.alerts('30000000-0000-0000-0000-0000000000d2'), 0, 'a locked PC switched off is not an alert');
select pg_temp.gap('key-u', 10, 86400, 86400);
select is(pg_temp.alerts('30000000-0000-0000-0000-0000000000d2'), 0, 'a locked PC offline is not an alert');
select pg_temp.gap('key-u', 10, 86400, 20);
select is((select session_id from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d2'), null::uuid,
  'a locked PC with its app closed is flagged');

update public.stations set status = 'maintenance' where id = '30000000-0000-0000-0000-0000000000d2';
select pg_temp.gap('key-u', 10, 86400, 20);
select is(pg_temp.alerts('30000000-0000-0000-0000-0000000000d2'), 1, 'not while staff have it in maintenance');
update public.stations set status = 'active' where id = '30000000-0000-0000-0000-0000000000d2';

select is((select count(*)::int from public.audit_log where org_id = '10000000-0000-0000-0000-0000000000d0' and action = 'pc_alert'),
  4, 'every alert is in Activity');

select pg_temp.as_pc();
select throws_ok($$ select * from public.pc_alerts $$, '42501', null, 'PCs can''t read alerts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.pc_alerts), 4, 'staff see the alerts');
select lives_ok($$ select public.dismiss_pc_alert((select id from public.pc_alerts
                     where station_id = '30000000-0000-0000-0000-0000000000d2')) $$, 'staff mark an alert as seen');
reset role;
select is((select dismissed_by from public.pc_alerts where station_id = '30000000-0000-0000-0000-0000000000d2'),
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'and who saw it is kept');

-- Vouchers --------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$ select public.create_vouchers('10000000-0000-0000-0000-0000000000d0', 1, 100) $$,
  '42501', null, 'staff can''t make vouchers');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select set_config('test.codes', array_to_string(
  public.create_vouchers('10000000-0000-0000-0000-0000000000d0', 4, 100, null, 'Instagram contest'), ','), true);
reset role;
select is((select count(*)::int from public.vouchers where org_id = '10000000-0000-0000-0000-0000000000d0'
            and code = any (string_to_array(current_setting('test.codes'), ','))), 4, 'the owner makes 4 vouchers');
select throws_ok($$ select public.create_vouchers('10000000-0000-0000-0000-0000000000d0', 101, 100) $$,
  '22023', null, 'at most 100 at a time');

-- Staff redeem the first one, typed lower case with the dash.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.redeem_voucher('70000000-0000-0000-0000-0000000000d0',
  lower(left(split_part(current_setting('test.codes'), ',', 1), 4) || '-' || right(split_part(current_setting('test.codes'), ',', 1), 4)),
  '20000000-0000-0000-0000-0000000000d0');
reset role;
select is(pg_temp.wallet(), 100.00::numeric(10,2), 'a voucher adds its value to the wallet');
select ok((select note from public.wallet_transactions where customer_id = '70000000-0000-0000-0000-0000000000d0' and method = 'bonus')
  like 'Voucher %Instagram contest', 'as bonus credit, with the voucher in the history');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok(format($$ select public.redeem_voucher('70000000-0000-0000-0000-0000000000d0', %L) $$,
  split_part(current_setting('test.codes'), ',', 1)), '22023', null, 'each code works once');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.void_voucher((select id from public.vouchers where code = split_part(current_setting('test.codes'), ',', 2)));
reset role;
update public.vouchers set expires_on = current_date - 1 where code = split_part(current_setting('test.codes'), ',', 3);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok(format($$ select public.redeem_voucher('70000000-0000-0000-0000-0000000000d0', %L) $$,
  split_part(current_setting('test.codes'), ',', 2)), '22023', null, 'a cancelled voucher doesn''t work');
select throws_ok(format($$ select public.redeem_voucher('70000000-0000-0000-0000-0000000000d0', %L) $$,
  split_part(current_setting('test.codes'), ',', 3)), '22023', null, 'nor an expired one');
reset role;

-- From the PC's games menu (Kiran's session on PC-01).
select pg_temp.as_pc();
select is(public.agent_sync('key-t') ->> 'vouchers', 'true', 'the PC menu offers vouchers to a known player');
select is(public.agent_redeem_voucher('key-t', 'ZZZZ-ZZZZ') ->> 'ok', 'false', 'a wrong code is refused');
select is((public.agent_redeem_voucher('key-t', split_part(current_setting('test.codes'), ',', 4)) ->> 'amount')::numeric,
  100::numeric, 'the player redeems a voucher from the PC');
select is(public.agent_redeem_voucher('key-u', split_part(current_setting('test.codes'), ',', 4)) ->> 'ok', 'false',
  'a PC without a player session can''t use vouchers');
reset role;
select is(pg_temp.wallet(), 200.00::numeric(10,2), 'both vouchers are in the wallet');

-- Shift close -----------------------------------------------------------------------------------
-- Rows count in a shift once their time is after its start: put earlier sales just before now.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.quick_sale('20000000-0000-0000-0000-0000000000d0',
  '[{"product_id":"60000000-0000-0000-0000-0000000000d0","name":"Coke","price":50,"quantity":4}]', 0,
  '[{"method":"cash","amount":200}]');
select public.topup_wallet('70000000-0000-0000-0000-0000000000d0', 100, 'cash', null, null, '20000000-0000-0000-0000-0000000000d0');
select public.topup_wallet('70000000-0000-0000-0000-0000000000d0', 300, 'upi', null, null, '20000000-0000-0000-0000-0000000000d0');
reset role;
update public.invoices set created_at = now() - interval '1 minute' where branch_id = '20000000-0000-0000-0000-0000000000d0';
update public.wallet_transactions set created_at = now() - interval '1 minute' where branch_id = '20000000-0000-0000-0000-0000000000d0';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((public.shift_status('20000000-0000-0000-0000-0000000000d0') ->> 'expected_cash')::numeric, 300::numeric,
  'expected cash: cash bills + cash top-ups');
select is((public.shift_status('20000000-0000-0000-0000-0000000000d0') ->> 'upi_total')::numeric, 300::numeric,
  'UPI is shown separately');
select throws_ok($$ select public.close_shift('20000000-0000-0000-0000-0000000000d0', 280, 500) $$,
  '22023', null, 'can''t leave more in the drawer than was counted');
select set_config('test.shift', public.close_shift('20000000-0000-0000-0000-0000000000d0', 280, 100, 'Paid for milk')::text, true);
reset role;
select is((select difference from public.shift_closes where id = current_setting('test.shift')::uuid), -20.00::numeric(12,2),
  'the close records ₹20 short');
select is((select (details ->> 'difference')::numeric from public.audit_log
            where org_id = '10000000-0000-0000-0000-0000000000d0' and action = 'shift_close'), -20::numeric,
  'and shows it in Activity');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((public.shift_status('20000000-0000-0000-0000-0000000000d0') ->> 'expected_cash')::numeric, 100::numeric,
  'the next shift starts from the cash left in the drawer');
select throws_ok($$ select public.close_shift('20000000-0000-0000-0000-0000000000d0', 100) $$,
  '22023', null, 'no double close by a double tap');
reset role;

select * from finish();
rollback;
