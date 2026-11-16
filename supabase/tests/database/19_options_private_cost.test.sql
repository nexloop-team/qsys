begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Fixture: owner + staff, a PS5, and Maggi with sizes and add-ons.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@options.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff@options.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000b0', 'Options Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('10000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2', 'staff');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000b0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000b0');
insert into public.stations (id, org_id, branch_id, type, name)
  values ('30000000-0000-0000-0000-0000000000b0', '10000000-0000-0000-0000-0000000000b0',
          '20000000-0000-0000-0000-0000000000b0', 'ps5', 'PS5-1');
insert into public.rate_plans (org_id, branch_id, name, station_type, per_hour)
  values ('10000000-0000-0000-0000-0000000000b0', '20000000-0000-0000-0000-0000000000b0', 'PS5', 'ps5', 100);
insert into public.products (id, org_id, branch_id, name, category, price, cost, options) values
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b0',
   '20000000-0000-0000-0000-0000000000b0', 'Maggi', 'Food', 1, 25,
   '{"sizes": [{"name": "Half", "price": 40}, {"name": "Full", "price": 70}],
     "addons": [{"name": "Extra cheese", "price": 20}, {"name": "Egg", "price": 15}]}');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Sizes and add-ons ---------------------------------------------------------------------------
select is((select price from public.products where id = '60000000-0000-0000-0000-0000000000b1'), 40.00::numeric(10,2),
  'an item with sizes is priced at its first size');
select throws_ok($$ update public.products
    set options = '{"sizes": [{"name": "Half", "price": 40}, {"name": "half", "price": 50}]}'
  where id = '60000000-0000-0000-0000-0000000000b1' $$,
  '23514', null, 'two sizes can''t share a name');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select set_config('test.bill', public.quick_sale('20000000-0000-0000-0000-0000000000b0',
  '[{"product_id": "60000000-0000-0000-0000-0000000000b1", "quantity": 2, "size": "Full", "addons": ["Extra cheese"],
     "price": 1}]', 0, '[{"method":"cash","amount":180}]')::text, true);
reset role;
select is((select description from public.invoice_lines where invoice_id = current_setting('test.bill')::uuid),
  'Maggi (Full) + Extra cheese × 2', 'the bill names the size and add-ons');
select is((select amount from public.invoice_lines where invoice_id = current_setting('test.bill')::uuid), 180.00::numeric,
  'and prices them from the item, not from what the browser sent');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.start_session('30000000-0000-0000-0000-0000000000b0', 'open', '9876500021');
select set_config('test.session', (select id from public.sessions where station_id = '30000000-0000-0000-0000-0000000000b0')::text, true);
select public.add_session_items(current_setting('test.session')::uuid,
  '[{"product_id": "60000000-0000-0000-0000-0000000000b1", "size": "Half", "addons": ["Egg", "Extra cheese"]},
    {"product_id": "60000000-0000-0000-0000-0000000000b1", "size": "Half", "addons": ["Egg", "Extra cheese"]}]');
select throws_ok(format($$ select public.add_session_items(%L, '[{"product_id": "60000000-0000-0000-0000-0000000000b1", "addons": ["Ketchup"]}]') $$,
    current_setting('test.session')),
  '22023', null, 'an add-on the item doesn''t have is refused');
select throws_ok(format($$ select public.add_session_items(%L, '[{"product_id": "60000000-0000-0000-0000-0000000000b1", "size": "Jumbo"}]') $$,
    current_setting('test.session')),
  '22023', null, 'so is a size it doesn''t come in');
reset role;
select is((select name || ' / ' || price || ' / ' || quantity from public.session_items
            where session_id = current_setting('test.session')::uuid),
  'Maggi (Half) + Egg, Extra cheese / 75.00 / 2', 'the same pick twice is one line of two');

-- QR page and PC orders pass no size: they get the first one.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.add_session_item(current_setting('test.session')::uuid, null, null, 1, '60000000-0000-0000-0000-0000000000b1');
reset role;
select ok(exists (select 1 from public.session_items where session_id = current_setting('test.session')::uuid
                   and name = 'Maggi (Half)' and price = 40), 'no size picked means the first size');

-- Buying prices: owner only ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select cost from public.products $$, '42501', null, 'staff can''t read buying prices');
select throws_ok($$ select unit_cost from public.session_items $$, '42501', null, 'or the cost kept with a sale');
select throws_ok($$ select * from public.product_costs('20000000-0000-0000-0000-0000000000b0') $$,
  '42501', null, 'or ask for them');
select lives_ok($$ select name, price, stock, options from public.products $$, 'staff still see the menu');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select cost from public.product_costs('20000000-0000-0000-0000-0000000000b0')
            where product_id = '60000000-0000-0000-0000-0000000000b1'), 25.00::numeric, 'the owner reads them');
reset role;

select * from finish();
rollback;
