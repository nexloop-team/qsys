begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fixture: owner + staff, PC at ₹60/hr, Coke ₹20 with 2 in stock, one player, offer "pay 500 → +50".
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@void.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'staff@void.test');
insert into public.orgs (id, name, wallet_offers)
  values ('10000000-0000-0000-0000-0000000000e0', 'Void Arena', '[{"pay": 500, "bonus": 50}]');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('10000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0',
          '20000000-0000-0000-0000-0000000000e0', 'pc', 'PC-01');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000e0', '20000000-0000-0000-0000-0000000000e0', 'PC', 'pc', 60);
insert into public.products (id, org_id, branch_id, name, category, price, stock)
  values ('60000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0',
          '20000000-0000-0000-0000-0000000000e0', 'Coke', 'beverage', 20, 2);
insert into public.customers (id, org_id, phone, name)
  values ('70000000-0000-0000-0000-0000000000e0', '10000000-0000-0000-0000-0000000000e0', '9876500009', 'Ravi');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Wallet offers ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(public.topup_wallet('70000000-0000-0000-0000-0000000000e0', 500, 'cash'), 550::numeric,
  'top-up of ₹500 gets the ₹50 offer');
select throws_ok($$ select public.topup_wallet('70000000-0000-0000-0000-0000000000e0', 100, 'cash', null, 30) $$,
  '42501', null, 'staff cannot give a hand-picked bonus');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.topup_wallet('70000000-0000-0000-0000-0000000000e0', 100, 'upi', null, 20), 670::numeric,
  'owner can give a custom bonus (₹100 + ₹20)');
reset role;

-- Stock and discounts ------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000e0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000e0","quantity":3}]', 0, '[{"method":"cash","amount":60}]') $$,
  '22023', null, 'cannot sell more than is in stock');
select throws_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000e0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000e0","quantity":2}]', 12, '[{"method":"cash","amount":28}]',
    null, null, 'Regular') $$,
  '42501', null, 'staff cannot discount more than 10%');
select throws_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000e0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000e0","quantity":2}]', 4, '[{"method":"cash","amount":36}]') $$,
  '22023', null, 'a discount needs a reason');
select lives_ok($$ select public.quick_sale('20000000-0000-0000-0000-0000000000e0',
    '[{"product_id":"60000000-0000-0000-0000-0000000000e0","quantity":2}]', 4, '[{"method":"cash","amount":36}]',
    null, null, 'Regular player') $$,
  'staff discount within 10% with a reason');
select is((select stock from public.products where id = '60000000-0000-0000-0000-0000000000e0'), 0,
  'the sale took 2 from stock');

-- Cancel a bill ------------------------------------------------------------
select throws_ok($$ select public.void_invoice((select id from public.invoices where voided_at is null limit 1), 'mistake') $$,
  '42501', null, 'staff cannot cancel a bill');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ select public.void_invoice((select id from public.invoices where voided_at is null limit 1), 'Rang up wrong item') $$,
  'owner cancels the bill');
select is((select stock from public.products where id = '60000000-0000-0000-0000-0000000000e0'), 2,
  'cancelled counter sale goes back in stock');
select is((public.report_summary('20000000-0000-0000-0000-0000000000e0',
    (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) ->> 'revenue')::numeric,
  0::numeric, 'cancelled bills are not revenue');

-- A shelf count below the expected number is logged as missing.
do $$ begin perform public.adjust_stock('60000000-0000-0000-0000-0000000000e0', 'count', 1, 'Monday count'); end $$;
select is((select count(*)::int from public.stock_moves where reason = 'count' and delta = -1), 1,
  'shortfall recorded by the count');

-- Cancelling a wallet-paid bill refunds the wallet and reopens the session.
do $$
begin
  perform public.start_session('30000000-0000-0000-0000-0000000000e0', 'open', '9876500009');
end $$;
reset role;
update public.sessions set started_at = now() - interval '60 minutes' where status = 'running';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
do $$
begin
  perform public.end_session((select id from public.sessions where status = 'running'));
  perform public.checkout(array(select id from public.sessions), 0, '[{"method":"wallet","amount":60}]');
  perform public.void_invoice(
    (select distinct invoice_id from public.invoice_lines where session_id is not null), 'Billed the wrong player');
end $$;
select is((select wallet_balance from public.customers where id = '70000000-0000-0000-0000-0000000000e0'),
  670.00::numeric(10,2), 'wallet refunded: 670 − 60 + 60');
select is((select outstanding from public.sessions limit 1), 60.00::numeric(10,2),
  'the session is unpaid again, ready to re-bill');

select * from finish();
rollback;
