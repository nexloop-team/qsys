begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixture: owner + staff, a PC (device key 'key-m') at ₹60/hr, Coke ₹40, player Meera (9876500009).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@bonus.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'staff@bonus.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000c0', 'Bonus Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('10000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000c2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0',
          '20000000-0000-0000-0000-0000000000c0', 'pc', 'PC-07');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000c0', '20000000-0000-0000-0000-0000000000c0', 'PC', 'pc', 60);
insert into public.products (id, org_id, branch_id, name, category, price)
  values ('60000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0',
          '20000000-0000-0000-0000-0000000000c0', 'Coke', 'beverage', 40);
insert into public.customers (id, org_id, phone, name)
  values ('70000000-0000-0000-0000-0000000000c0', '10000000-0000-0000-0000-0000000000c0', '9876500009', 'Meera Rao');
insert into public.devices (org_id, branch_id, station_id, token_hash, channel)
  values ('10000000-0000-0000-0000-0000000000c0', '20000000-0000-0000-0000-0000000000c0', '30000000-0000-0000-0000-0000000000c0',
          encode(extensions.digest('key-m', 'sha256'), 'hex'), gen_random_uuid());

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_pc() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.wallet() returns numeric language sql as $$
  select wallet_balance from public.customers where id = '70000000-0000-0000-0000-0000000000c0';
$$;
create function pg_temp.coke(n int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', '60000000-0000-0000-0000-0000000000c0', 'name', 'Coke', 'price', 40, 'quantity', n));
$$;

-- Bonus on spending -------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
update public.orgs set spend_bonus_pct = 20 where id = '10000000-0000-0000-0000-0000000000c0';
reset role;
select is((select spend_bonus_pct from public.orgs where id = '10000000-0000-0000-0000-0000000000c0'), 0.0::numeric(4,1),
  'staff can''t set the bonus');
select throws_ok($$ update public.orgs set spend_bonus_pct = 25 where id = '10000000-0000-0000-0000-0000000000c0' $$,
  '23514', null, 'the bonus is at most 20%');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update public.orgs set spend_bonus_pct = 5 where id = '10000000-0000-0000-0000-0000000000c0';
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.topup_wallet('70000000-0000-0000-0000-0000000000c0', 100, 'cash');
-- Bill 1: 5 Cokes (₹200) in cash, for Meera by mobile number.
select set_config('test.bill1', public.quick_sale('20000000-0000-0000-0000-0000000000c0', pg_temp.coke(5), 0,
  '[{"method":"cash","amount":200}]', 'Meera', '98765 00009')::text, true);
reset role;
select is(pg_temp.wallet(), 110.00::numeric(10,2), '5% of a ₹200 cash bill goes to the wallet');
select is((select note from public.wallet_transactions
            where invoice_id = current_setting('test.bill1')::uuid and method = 'bonus'),
  '5% back on bill ' || (select number from public.invoices where id = current_setting('test.bill1')::uuid),
  'the wallet shows where the bonus came from');

-- Bill 2: ₹200, half from the wallet, half UPI: only the UPI half earns a bonus.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.quick_sale('20000000-0000-0000-0000-0000000000c0', pg_temp.coke(5), 0,
  '[{"method":"wallet","amount":100},{"method":"upi","amount":100}]', 'Meera', '9876500009');
-- Bill 3: a walk-in without a number earns nothing (and nothing breaks).
select lives_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000c0', pg_temp.coke(1), 0,
  '[{"method":"cash","amount":40}]') $$, 'a walk-in bill works as before');
reset role;
select is(pg_temp.wallet(), 15.00::numeric(10,2), 'money paid from the wallet earns no bonus');
select is((select count(*)::int from public.wallet_transactions
            where org_id = '10000000-0000-0000-0000-0000000000c0' and method = 'bonus'), 2, 'one bonus per player bill');

-- Cancelling bill 1 takes its ₹10 back.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.void_invoice(current_setting('test.bill1')::uuid, 'Wrong player');
reset role;
select is(pg_temp.wallet(), 5.00::numeric(10,2), 'cancelling the bill takes the bonus back');

-- The games menu ------------------------------------------------------------------------------
select throws_ok($$ update public.branch_settings set pc_restrictions = '{task_manager,format_c}'
                    where branch_id = '20000000-0000-0000-0000-0000000000c0' $$,
  '23514', null, 'only known restrictions');
update public.branch_settings
   set pc_games = '[{"id": "g1abcd", "name": "Counter-Strike 2", "target": "steam://rungameid/730"}]',
       pc_restrictions = '{task_manager,usb_drives}'
 where branch_id = '20000000-0000-0000-0000-0000000000c0';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select public.start_session('30000000-0000-0000-0000-0000000000c0', 'open', '9876500009');
reset role;

select pg_temp.as_pc();
select set_config('test.sync', public.agent_sync('key-m',
  '{"hostname": "PC-07", "health": {"cpu": 41.5, "ram_used_gb": 7.2, "ram_total_gb": 16, "gpu": {"temp": 88}}}')::text, true);
select is(current_setting('test.sync')::jsonb #>> '{games,0,name}', 'Counter-Strike 2', 'the PC gets the games list');
select ok(current_setting('test.sync')::jsonb -> 'restrictions' ? 'usb_drives', 'and the restrictions');
select is((current_setting('test.sync')::jsonb ->> 'wallet')::numeric, 5::numeric, 'and the player''s wallet balance');
select is(current_setting('test.sync')::jsonb #>> '{menu,0,name}', 'Coke', 'and the snacks to order');
reset role;

select is((select (health ->> 'cpu')::numeric from public.devices where station_id = '30000000-0000-0000-0000-0000000000c0'),
  41.5, 'health readings are stored');
select pg_temp.as_pc();
select public.agent_sync('key-m', '{"health": "not an object"}');
reset role;
select is((select health #>> '{gpu,temp}' from public.devices where station_id = '30000000-0000-0000-0000-0000000000c0'),
  '88', 'a malformed reading is ignored');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is((select (health ->> 'ram_total_gb')::int from public.devices where station_id = '30000000-0000-0000-0000-0000000000c0'),
  16, 'staff see the readings on the floor');
reset role;

-- Requests from the PC (the QR page is off: the PC still works).
select set_config('test.code', (select public_code from public.stations where id = '30000000-0000-0000-0000-0000000000c0'), true);
select pg_temp.as_pc();
select lives_ok($$ select public.agent_request('key-m', 'call') $$, 'the player calls staff from the PC');
select throws_ok($$ select public.agent_request('key-m', 'call') $$, '22023', null, 'once until staff answer');
select lives_ok($$ select public.agent_request('key-m', 'snack', '60000000-0000-0000-0000-0000000000c0', 2) $$,
  'orders 2 Cokes');
select throws_ok($$ select public.agent_request('key-m', 'extend') $$, '22023', null, 'open time needs no extra minutes');
select is(jsonb_array_length(public.agent_sync('key-m') -> 'requests'), 2, 'the menu shows the requests');
select throws_ok($$ select public.public_station_request(current_setting('test.code'), 'call') $$,
  '22023', null, 'the QR page still needs to be turned on');

-- A USB drive during a player's time shows in Activity.
select public.agent_report('key-m', 'usb_drive', '{"drive": "E:\\", "blocked": false}');
reset role;
select is((select details ->> 'drive' from public.audit_log
            where org_id = '10000000-0000-0000-0000-0000000000c0' and action = 'usb_drive'), 'E:\',
  'a plugged-in USB drive is reported');

select * from finish();
rollback;
