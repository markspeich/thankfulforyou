-- Run only against an isolated local database with the migration installed.
-- All test records and writes are rolled back.
begin;
do $$
declare
  row_json jsonb := jsonb_build_object('id', 'color-safeguard-regression',
    'workspace_id', '11111111-1111-4111-8111-111111111111', 'status', 'open',
    'quantity', 1, 'revision', 2, 'updated_at', now(),
    'imported_color', 'Hot Pink', 'source_json', jsonb_build_object('colorName', 'Hot Pink'));
  current_color text;
  current_source text;
  current_revision bigint;
  invalid_update jsonb;
begin
  perform public.save_production_order_items(jsonb_build_array(row_json));
  row_json := row_json || jsonb_build_object('revision', 3, 'imported_color', null, 'source_json', jsonb_build_object('colorName', ''));
  perform public.save_production_order_items(jsonb_build_array(row_json));
  select imported_color, source_json ->> 'colorName', revision into current_color, current_source, current_revision
    from public.order_items where id = row_json ->> 'id';
  assert current_color = 'Hot Pink' and current_source = 'Hot Pink' and current_revision = 3, 'Blank snapshot erased stored color';
  row_json := row_json || jsonb_build_object('revision', 4, 'imported_color', 'Stale Blue', 'source_json', jsonb_build_object('colorName', 'Stale Blue'));
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select imported_color = 'Hot Pink' from public.order_items where id = row_json ->> 'id'), 'Stale snapshot changed color';
  row_json := row_json || jsonb_build_object('revision', 5);
  perform public.save_production_order_items(jsonb_build_array(row_json), '[{"orderItemId":"color-safeguard-regression","action":"set","colorName":" Purple "}]');
  assert (select imported_color = 'Purple' and source_json ->> 'colorName' = 'Purple' from public.order_items where id = row_json ->> 'id'), 'Explicit set failed';
  row_json := row_json || jsonb_build_object('revision', 6);
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select imported_color = 'Purple' from public.order_items where id = row_json ->> 'id'), 'Repeated stale save changed explicit color';
  row_json := row_json || jsonb_build_object('revision', 7);
  perform public.save_production_order_items(jsonb_build_array(row_json), '[{"orderItemId":"color-safeguard-regression","action":"clear"}]');
  row_json := row_json || jsonb_build_object('revision', 8);
  perform public.save_production_order_items(jsonb_build_array(row_json));
  assert (select imported_color is null and source_json ->> 'colorName' = '' from public.order_items where id = row_json ->> 'id'), 'Stale save restored cleared color';
  for invalid_update in select value from jsonb_array_elements('[
    [{"orderItemId":"color-safeguard-regression","action":"set","colorName":" "}],
    [{"orderItemId":"color-safeguard-regression","action":"set"}],
    [{"orderItemId":"color-safeguard-regression","action":"clear","colorName":"Hot Pink"}],
    [{"orderItemId":"other-item","action":"clear"}],
    [{"orderItemId":"color-safeguard-regression","action":"clear"},{"orderItemId":"color-safeguard-regression","action":"clear"}]
  ]') loop
    begin
      perform public.save_production_order_items(jsonb_build_array(row_json || '{"revision":9}'), invalid_update);
      raise exception 'Invalid color intent was accepted: %', invalid_update;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.save_production_order_items(jsonb_build_array(row_json), '[{"orderItemId":"color-safeguard-regression","action":"set","colorName":"Wrong"}]');
    raise exception 'Stale explicit edit overwrote a newer revision';
  exception when sqlstate 'PT409' then null;
  end;
  assert (select revision = 8 and imported_color is null from public.order_items where id = row_json ->> 'id'), 'Rejected request wrote data';
  assert not has_function_privilege('anon', 'public.save_production_order_items(jsonb,jsonb)', 'execute'), 'Anonymous RPC access';
  assert not has_function_privilege('authenticated', 'public.save_production_order_items(jsonb,jsonb)', 'execute'), 'Browser RPC access';
end;
$$;
select 'Color persistence regression checks passed' as result;
rollback;
