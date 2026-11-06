begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Fixture: owner + staff, one PC at ₹60/hr, one catalogue item (Coke ₹20), two players.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@wallet.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff@wallet.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000f0', 'Wallet Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0',
          '20000000-0000-0000-0000-0000000000f0', 'pc', 'PC-01');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'PC', 'pc', 60);
insert into public.products (id, org_id, branch_id, name, category, price)
  values ('60000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0',
          '20000000-0000-0000-0000-0000000000f0', 'Coke', 'beverage', 20);
insert into public.customers (id, org_id, phone, name) values
  ('70000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-0000000000f0', '9876500001', 'Asha'),
  ('70000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000f0', '9876500002', 'Asha');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Staff: top up Asha (A) ₹100; refunds are owner-only; catalogue is owner-only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is(public.topup_wallet('70000000-0000-0000-0000-0000000000a0', 100, 'cash'), 100::numeric,
  'staff can top up a wallet');
select throws_ok($$ select public.deduct_wallet('70000000-0000-0000-0000-0000000000a0', 10) $$,
  '42501', null, 'staff cannot refund from a wallet');
select throws_ok($$ update public.customers set wallet_balance = 999 where id = '70000000-0000-0000-0000-0000000000a0' $$,
  '42501', null, 'nobody can write a balance directly');
update public.products set price = 1 where id = '60000000-0000-0000-0000-0000000000f0';
reset role;
select is((select price from public.products where id = '60000000-0000-0000-0000-0000000000f0'), 20.00::numeric(10,2),
  'staff cannot change catalogue prices');

-- Staff runs a session for player A, adds a Coke sending a fake price of ₹1.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
do $$
begin
  perform public.start_session('30000000-0000-0000-0000-0000000000f0', 'open', '9876500001');
  perform public.add_session_item(
    (select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f0' and status = 'running'),
    'Coke', 1, 1, '60000000-0000-0000-0000-0000000000f0');
end $$;
select is((select price from public.session_items limit 1), 20.00::numeric(10,2),
  'catalogue items use the catalogue price, not the price sent by the app');

reset role;
update public.sessions set started_at = now() - interval '60 minutes'
 where station_id = '30000000-0000-0000-0000-0000000000f0' and status = 'running';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((public.end_session((select id from public.sessions where status = 'running')) ->> 'total')::numeric,
  80::numeric, '60 min at ₹60/hr + ₹20 Coke = ₹80');

-- Pay all ₹80 from A's wallet. B has the same name and must not be touched.
select lives_ok($$ select public.checkout(array(select id from public.sessions), 0, '[{"method":"wallet","amount":80}]') $$,
  'checkout paid from the wallet');
select is((select wallet_balance from public.customers where id = '70000000-0000-0000-0000-0000000000a0'),
  20.00::numeric(10,2), 'wallet charged once: ₹100 − ₹80 = ₹20');
select is((select wallet_balance from public.customers where id = '70000000-0000-0000-0000-0000000000b0'),
  0.00::numeric(10,2), 'a different player with the same name is not charged');
select is((select count(*)::int from public.session_items where invoice_id is not null), 1,
  'the snack is marked as billed');
select throws_ok($$ select public.checkout(array(select id from public.sessions), 0, '[{"method":"cash","amount":20}]') $$,
  '22023', null, 'a second checkout (double click) bills nothing more');

-- Quick sale: wallet needs a player with enough money; catalogue price wins.
select throws_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000f0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000f0","quantity":1}]', 0,
    '[{"method":"wallet","amount":20}]', 'Asha', '98765 00002') $$,
  '22023', null, 'wallet with ₹0 cannot pay');
select throws_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000f0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000f0","quantity":1}]', 0,
    '[{"method":"wallet","amount":20}]') $$,
  '22023', null, 'wallet payment needs a player');
-- (CTE so the sale runs exactly once.)
select is((with q as (select public.quick_sale('20000000-0000-0000-0000-0000000000f0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000f0","name":"Coke","price":1,"quantity":1}]', 0,
    '[{"method":"cash","amount":20}]') as id)
  select i.total from public.invoices i join q on q.id = i.id), 20.00::numeric(10,2),
  'quick sale charges the catalogue price');

select * from finish();
rollback;
