-- Quick Sale / Walk-in F&B Counter Orders (No Station Required)

create or replace function public.quick_sale(
  p_branch_id uuid,
  p_items jsonb, -- array of { product_id, name, price, quantity }
  p_discount numeric default 0,
  p_payments jsonb default '[]', -- array of { method, amount, reference }
  p_customer_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_lines jsonb := '[]'::jsonb;
  item jsonb;
  v_invoice_id uuid;
  v_branch_settings public.branch_settings;
  v_qty int;
  v_price numeric;
  v_name text;
begin
  select org_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform private.assert_member(v_org);

  select * into v_branch_settings from public.branch_settings where branch_id = p_branch_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((item ->> 'quantity')::int, 1), 1);
    v_price := coalesce((item ->> 'price')::numeric, 0);
    v_name := coalesce(trim(item ->> 'name'), 'Item');

    if v_price < 0 then
      raise exception 'Price cannot be negative.' using errcode = '22023';
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'session_id', null,
      'description', v_name || case when v_qty > 1 then ' × ' || v_qty else '' end,
      'amount', v_price * v_qty,
      'gst_rate', case when v_branch_settings.gst_enabled then coalesce(v_branch_settings.gst_rate, 0) else 0 end
    ));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No items in sale.' using errcode = '22023';
  end if;

  v_invoice_id := private.create_invoice(
    p_branch_id,
    v_lines,
    coalesce(p_discount, 0),
    p_payments,
    p_customer_name,
    p_customer_phone
  );

  return v_invoice_id;
end $$;

grant execute on function public.quick_sale(uuid, jsonb, numeric, jsonb, text, text) to authenticated;

