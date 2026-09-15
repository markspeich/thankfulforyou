-- Service-only initialization: order, then design locks match operator save order.
-- Existing designs with lines are never touched. Legacy zero-line imports may
-- recover only when their original draft fields and revision are still intact.
create or replace function public.initialize_import_designs(
  p_workspace_id uuid, p_user_id uuid, p_items jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_input public.designs%rowtype;
  v_design public.designs%rowtype;
  v_line public.design_lines%rowtype;
  v_line_json jsonb;
begin
  if p_workspace_id is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Workspace and import items are required';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) order by value->'design'->>'order_item_id'
  loop
    v_input := jsonb_populate_record(null::public.designs, v_item->'design');
    if v_input.workspace_id is distinct from p_workspace_id
      or v_input.updated_by is distinct from p_user_id
      or v_input.revision is distinct from 1
      or v_input.production_status is distinct from 'draft'
      or jsonb_typeof(v_item->'lines') is distinct from 'array'
      or jsonb_array_length(v_item->'lines') = 0 then
      raise exception 'Invalid import design';
    end if;
    perform 1 from public.order_items
      where id = v_input.order_item_id and workspace_id = p_workspace_id for update;
    if not found then
      raise exception 'Import order item is missing from workspace';
    end if;
    select * into v_design from public.designs
      where order_item_id = v_input.order_item_id for update;
    if found then
      if v_design.workspace_id is distinct from p_workspace_id then
        raise exception 'Import design belongs to another workspace';
      end if;
      if v_design.revision <> 1 or v_design.production_status <> 'draft'
        or nullif(v_design.saved_settings_signature, '') is not null
        or nullif(v_design.completed_settings_signature, '') is not null
        or row(v_design.workspace_id, v_design.order_item_id, v_design.design_text, v_design.preset_id, v_design.size_guide_id, v_design.backing_border_mm, v_design.weld_exported_design, v_design.global_horizontal_scale, v_design.global_vertical_scale, v_design.production_status, v_design.revision)
          is distinct from row(v_input.workspace_id, v_input.order_item_id, v_input.design_text, v_input.preset_id, v_input.size_guide_id, v_input.backing_border_mm, v_input.weld_exported_design, v_input.global_horizontal_scale, v_input.global_vertical_scale, v_input.production_status, v_input.revision)
        or exists(select 1 from public.design_lines where design_id = v_design.id) then
        continue;
      end if;
    else
      insert into public.designs (workspace_id, order_item_id, design_text, preset_id, size_guide_id, backing_border_mm, weld_exported_design, global_horizontal_scale, global_vertical_scale, production_status, revision, updated_by)
      values (v_input.workspace_id, v_input.order_item_id, v_input.design_text, v_input.preset_id, v_input.size_guide_id, v_input.backing_border_mm, v_input.weld_exported_design, v_input.global_horizontal_scale, v_input.global_vertical_scale, v_input.production_status, v_input.revision, v_input.updated_by)
      returning * into v_design;
    end if;
    for v_line_json in select value from jsonb_array_elements(v_item->'lines')
    loop
      v_line := jsonb_populate_record(null::public.design_lines, v_line_json);
      insert into public.design_lines (design_id, line_index, item_kind, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, offset_y_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height, fixed_design_id, fixed_design_version, svg_size_mm, fixed_svg_backing_border)
      values (v_design.id, v_line.line_index, v_line.item_kind, v_line.text, v_line.font_id, v_line.letter_bridge_mm, v_line.line_bridge_mm, v_line.offset_x_mm, v_line.offset_y_mm, v_line.text_height_mm, v_line.horizontal_scale, v_line.vertical_scale, v_line.lock_text_height, v_line.fixed_design_id, v_line.fixed_design_version, v_line.svg_size_mm, v_line.fixed_svg_backing_border);
    end loop;
  end loop;
end;
$$;
revoke all on function public.initialize_import_designs(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.initialize_import_designs(uuid, uuid, jsonb) to service_role;
