-- Run only against an isolated local database with the migration installed.
-- All test records and writes are rolled back.
begin;
do $$
declare
  row_json jsonb := jsonb_build_object('id', 'text-color-safeguard-regression',
    'workspace_id', '11111111-1111-4111-8111-111111111111', 'status', 'open',
    'quantity', 1, 'revision', 2, 'updated_at', now(), 'imported_color', 'Blue Dots',
    'text_color', 'Navy Blue', 'source_json', jsonb_build_object('colorName', 'Blue Dots', 'textColorName', 'Navy Blue'));
  invalid_update jsonb;
begin
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select text_color = 'Navy Blue' and source_json ->> 'textColorName' = 'Navy Blue'
    from public.order_items where id = row_json ->> 'id'), 'Insert did not store text color';
  row_json := row_json || jsonb_build_object('revision', 3, 'text_color', 'Stale Red', 'source_json', jsonb_build_object('colorName', 'Blue Dots', 'textColorName', 'Stale Red'));
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select text_color = 'Navy Blue' and source_json ->> 'textColorName' = 'Navy Blue'
    from public.order_items where id = row_json ->> 'id'), 'Stale snapshot changed text color';
  row_json := row_json || jsonb_build_object('revision', 4);
  perform public.save_production_order_items(jsonb_build_array(row_json), '[]',
    '[{"orderItemId":"text-color-safeguard-regression","action":"set","textColorName":" Gold "}]');
  assert (select text_color = 'Gold' and source_json ->> 'textColorName' = 'Gold' and imported_color = 'Blue Dots'
    from public.order_items where id = row_json ->> 'id'), 'Explicit text color set failed';
  row_json := row_json || jsonb_build_object('revision', 5);
  perform public.save_production_order_items(jsonb_build_array(row_json), '[]',
    '[{"orderItemId":"text-color-safeguard-regression","action":"clear"}]');
  row_json := row_json || jsonb_build_object('revision', 6);
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select text_color is null and source_json ->> 'textColorName' = ''
    from public.order_items where id = row_json ->> 'id'), 'Stale save restored cleared text color';
  for invalid_update in select value from jsonb_array_elements('[
    [{"orderItemId":"text-color-safeguard-regression","action":"set","textColorName":" "}],
    [{"orderItemId":"text-color-safeguard-regression","action":"set"}],
    [{"orderItemId":"text-color-safeguard-regression","action":"clear","textColorName":"Gold"}],
    [{"orderItemId":"other-item","action":"clear"}],
    [{"orderItemId":"text-color-safeguard-regression","action":"clear"},{"orderItemId":"text-color-safeguard-regression","action":"clear"}]
  ]') loop
    begin
      perform public.save_production_order_items(jsonb_build_array(row_json || '{"revision":7}'), '[]', invalid_update);
      raise exception 'Invalid text color intent was accepted: %', invalid_update;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  assert not has_function_privilege('anon', 'public.save_production_order_items(jsonb,jsonb,jsonb)', 'execute'), 'Anonymous RPC access';
  assert not has_function_privilege('authenticated', 'public.save_production_order_items(jsonb,jsonb,jsonb)', 'execute'), 'Browser RPC access';
end;
$$;
select 'Text color persistence regression checks passed' as result;
rollback;
