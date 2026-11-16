begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixture: owner + staff, a PS5 at ₹100/hr, Coke ₹40 and Chips ₹20 on the menu.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@snacks.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff@snacks.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000f0', 'Snack Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000f2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0',
          '20000000-0000-0000-0000-0000000000f0', 'ps5', 'PS5-1');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', 'PS5', 'ps5', 100);
insert into public.products (id, org_id, branch_id, name, category, price) values
  ('60000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f0',
   '20000000-0000-0000-0000-0000000000f0', 'Coke', 'beverage', 40),
  ('60000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f0',
   '20000000-0000-0000-0000-0000000000f0', 'Chips', 'snack', 20);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.coke() returns public.products language sql as $$
  select * from public.products where id = '60000000-0000-0000-0000-0000000000f1';
$$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Deliveries and the average buying price ----------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'receive', 10, 'Bill 1', 25);
select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'receive', 10, 'Bill 2', 30);
reset role;
select is((pg_temp.coke()).stock, 20, 'two deliveries of 10');
select is((pg_temp.coke()).cost, 27.50::numeric(10,2), 'the buying price is the average of both deliveries');
select is((select unit_cost from public.stock_moves
            where product_id = '60000000-0000-0000-0000-0000000000f1' and note = 'Bill 2'),
  30.00::numeric(10,2), 'each delivery keeps what was paid for it');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'write_off', 1, null, null, 'staff') $$,
  '42501', null, 'staff can''t write stock off');
reset role;

-- Write-offs ------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'write_off', 2, 'Dropped', null, 'broken'), 18,
  'a write-off takes stock off the shelf');
select throws_ok($$ select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'write_off', 1) $$,
  '22023', null, 'a write-off needs a reason');
select throws_ok($$ select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'write_off', 50, null, null, 'expired') $$,
  '22023', null, 'can''t write off more than is on the shelf');
-- Chips aren't counted: the loss is recorded, the count stays off.
select lives_ok($$ select public.adjust_stock('60000000-0000-0000-0000-0000000000f2', 'write_off', 3, null, null, 'staff') $$,
  'an item that isn''t counted can still be written off');
-- Shelf count finds one more missing.
select public.adjust_stock('60000000-0000-0000-0000-0000000000f1', 'count', 17, 'Night count');
reset role;
select is((select unit_cost from public.stock_moves
            where product_id = '60000000-0000-0000-0000-0000000000f1' and reason = 'broken'),
  27.50::numeric(10,2), 'a write-off is valued at the buying price');
select is((select stock from public.products where id = '60000000-0000-0000-0000-0000000000f2'), null::int,
  'the uncounted item stays uncounted');

-- Several items onto a station's bill at once ----------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.start_session('30000000-0000-0000-0000-0000000000f0', 'open', '9876500011');
select set_config('test.session', (select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000f0')::text, true);
select lives_ok(format($$ select public.add_session_items(%L, '[
    {"product_id": "60000000-0000-0000-0000-0000000000f1", "quantity": 2},
    {"product_id": "60000000-0000-0000-0000-0000000000f2", "quantity": 1},
    {"name": "Samosa", "price": 15, "quantity": 2}]') $$, current_setting('test.session')),
  'staff add three lines in one go');
select throws_ok(format($$ select public.add_session_items(%L, '[
    {"product_id": "60000000-0000-0000-0000-0000000000f2", "quantity": 1},
    {"product_id": "60000000-0000-0000-0000-0000000000f1", "quantity": 99}]') $$, current_setting('test.session')),
  '22023', null, 'one item short stops the whole order');
reset role;
select is((select count(*)::int from public.session_items where session_id = current_setting('test.session')::uuid), 3,
  'nothing from the failed order is on the bill');
select is((select unit_cost from public.session_items
            where session_id = current_setting('test.session')::uuid and product_id = '60000000-0000-0000-0000-0000000000f1'),
  27.50::numeric(10,2), 'the snack carries its buying price');
select is((pg_temp.coke()).stock, 15, 'stock went down for the two Cokes');

-- A counter sale, then the report ------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.quick_sale('20000000-0000-0000-0000-0000000000f0',
  '[{"product_id": "60000000-0000-0000-0000-0000000000f1", "quantity": 3}]', 0, '[{"method":"cash","amount":120}]');
select throws_ok($$ select public.report_snacks('20000000-0000-0000-0000-0000000000f0', pg_temp.today(), pg_temp.today()) $$,
  '42501', null, 'the snacks report is for the owner');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select set_config('test.report',
  public.report_snacks('20000000-0000-0000-0000-0000000000f0', pg_temp.today(), pg_temp.today())::text, true);
reset role;
-- Only the paid counter sale counts so far: 3 Cokes, ₹120 sold, ₹82.50 cost.
select is(current_setting('test.report')::jsonb #>> '{totals,profit}', '37.50', 'profit on what was paid for');
select is((select sum((l ->> 'value')::numeric) from jsonb_array_elements(current_setting('test.report')::jsonb -> 'losses') l),
  82.50::numeric, 'losses: 2 broken and 1 missing Coke at ₹27.50 (the uncounted chips had no price)');

select * from finish();
rollback;
