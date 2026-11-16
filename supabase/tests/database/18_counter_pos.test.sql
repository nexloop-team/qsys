begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixture: owner + staff, two branches' worth of nothing but a menu.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@pos.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'outsider@pos.test');
insert into public.orgs (id, name) values ('10000000-0000-0000-0000-0000000000a0', 'POS Arena');
insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.branches (id, org_id, name, timezone)
  values ('20000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-0000000000a0', 'Main', 'Asia/Kolkata');
insert into public.branch_settings (branch_id, org_id)
  values ('20000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-0000000000a0');
insert into public.products (id, org_id, branch_id, name, category, price, barcode) values
  ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a0',
   '20000000-0000-0000-0000-0000000000a0', 'Red Bull', 'Energy drinks', 125, '8901234567890'),
  ('60000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a0',
   '20000000-0000-0000-0000-0000000000a0', 'Maggi', 'Food', 60, null);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

select is((select category from public.products where id = '60000000-0000-0000-0000-0000000000a1'), 'Energy drinks',
  'a venue can name its own category');
select throws_ok($$ insert into public.products (org_id, branch_id, name, category, price, barcode)
    values ('10000000-0000-0000-0000-0000000000a0', '20000000-0000-0000-0000-0000000000a0', 'Red Bull 2', 'Drinks', 125, '8901234567890') $$,
  '23505', null, 'two items in a branch can''t share a barcode');
select throws_ok($$ update public.products set barcode = 'a b' where id = '60000000-0000-0000-0000-0000000000a2' $$,
  '23514', null, 'a barcode is letters, digits or dashes');
select throws_ok($$ update public.products set category = '  ' where id = '60000000-0000-0000-0000-0000000000a2' $$,
  '23514', null, 'a category can''t be blank');

-- Two Red Bulls and one Maggi sold at the counter.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.quick_sale('20000000-0000-0000-0000-0000000000a0',
  '[{"product_id": "60000000-0000-0000-0000-0000000000a1", "quantity": 2},
    {"product_id": "60000000-0000-0000-0000-0000000000a2", "quantity": 1}]', 0, '[{"method":"cash","amount":310}]');
select is((select array_agg(product_id order by qty desc) from public.top_products('20000000-0000-0000-0000-0000000000a0')),
  array['60000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a2']::uuid[],
  'top sellers, best first');
select is((select qty from public.top_products('20000000-0000-0000-0000-0000000000a0')
            where product_id = '60000000-0000-0000-0000-0000000000a1'), 2::bigint, 'counted by quantity');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select * from public.top_products('20000000-0000-0000-0000-0000000000a0') $$,
  '42501', null, 'someone from another venue can''t see the best sellers');
reset role;

select * from finish();
rollback;
