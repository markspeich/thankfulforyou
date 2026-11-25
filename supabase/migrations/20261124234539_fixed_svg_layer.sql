-- Fixed designs can now be cut as part of the backing border instead of the
-- top layer. design_lines.fixed_svg_layer records which acrylic layer a fixed
-- SVG belongs to: 'top' (default, existing behavior) or 'backing' (the artwork
-- is merged into the backing border silhouette at export).
-- fixed_svg_backing_border keeps its meaning (trace an offset backing outline
-- around top-layer artwork) and is always false for backing-layer artwork.
-- Additive: adds a defaulted column and replaces two import function bodies so
-- imported preset fixed designs keep their layer. No data is removed.

alter table public.design_lines
  add column if not exists fixed_svg_layer text not null default 'top';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'design_lines_fixed_svg_layer_check'
      and conrelid = 'public.design_lines'::regclass
  ) then
    alter table public.design_lines
      add constraint design_lines_fixed_svg_layer_check
      check (fixed_svg_layer in ('top', 'backing'));
  end if;
end;
$$;

-- Etsy and other non-Amazon imports: same body as
-- 20260915152532_recover_incomplete_import_designs.sql plus fixed_svg_layer.
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
      insert into public.design_lines (design_id, line_index, item_kind, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, offset_y_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height, fixed_design_id, fixed_design_version, svg_size_mm, fixed_svg_backing_border, fixed_svg_layer)
      values (v_design.id, v_line.line_index, v_line.item_kind, v_line.text, v_line.font_id, v_line.letter_bridge_mm, v_line.line_bridge_mm, v_line.offset_x_mm, v_line.offset_y_mm, v_line.text_height_mm, v_line.horizontal_scale, v_line.vertical_scale, v_line.lock_text_height, v_line.fixed_design_id, v_line.fixed_design_version, v_line.svg_size_mm, v_line.fixed_svg_backing_border, coalesce(v_line.fixed_svg_layer, 'top'));
    end loop;
  end loop;
end;
$$;
revoke all on function public.initialize_import_designs(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.initialize_import_designs(uuid, uuid, jsonb) to service_role;

-- Amazon imports: the strict import_amazon_order_items_without_raw_customization
-- allowlist rejects unknown line keys, so the wrapper strips fixed_svg_layer
-- before the strict call (like text_color on orderItem), then stores it only on
-- design lines of order items this call newly imported. Otherwise the same body
-- as 20261124144137_amazon_import_accepts_text_color.sql.
create or replace function public.import_amazon_order_items(
  p_workspace_id uuid, p_user_id uuid, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sanitized_items jsonb;
  v_result jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return public.import_amazon_order_items_without_raw_customization(p_workspace_id, p_user_id, p_items);
  end if;

  select coalesce(jsonb_agg(
    case when jsonb_typeof(item.value) = 'object' and jsonb_typeof(item.value -> 'orderItem') = 'object'
      then jsonb_set(
        case when jsonb_typeof(item.value -> 'lines') = 'array'
          then jsonb_set(item.value, '{lines}', (
            select coalesce(jsonb_agg(
              case when jsonb_typeof(line.value) = 'object' then line.value - 'fixed_svg_layer' else line.value end
              order by line.ordinality
            ), '[]'::jsonb)
            from jsonb_array_elements(item.value -> 'lines') with ordinality as line(value, ordinality)
          ))
          else item.value end,
        '{orderItem}', (item.value -> 'orderItem')
        - 'amazon_customization_json' - 'etsy_import_diagnostics' - 'order_date' - 'badge_reel_type_id'
        - 'text_color')
      else item.value end order by item.ordinality
  ), '[]'::jsonb)
  into v_sanitized_items
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality);

  v_result := public.import_amazon_order_items_without_raw_customization(
    p_workspace_id, p_user_id, v_sanitized_items
  );

  update public.order_items stored
  set amazon_customization_json = incoming.document
  from (
    select item.value -> 'orderItem' ->> 'id' as order_item_id,
      item.value -> 'orderItem' -> 'amazon_customization_json' as document
    from jsonb_array_elements(p_items) item(value)
    where jsonb_typeof(item.value -> 'orderItem' -> 'amazon_customization_json') = 'object'
  ) incoming
  where stored.id = incoming.order_item_id and stored.workspace_id = p_workspace_id;

  update public.order_items stored
  set order_date = incoming.order_date
  from (
    select item.value -> 'orderItem' ->> 'id' as order_item_id,
      (item.value -> 'orderItem' ->> 'order_date')::timestamptz as order_date
    from jsonb_array_elements(p_items) item(value)
    where nullif(item.value -> 'orderItem' ->> 'order_date', '') is not null
  ) incoming
  where stored.id = incoming.order_item_id and stored.workspace_id = p_workspace_id;

  update public.order_items stored
  set badge_reel_type_id = incoming.badge_reel_type_id
  from (
    select item.value -> 'orderItem' ->> 'id' as order_item_id,
      nullif(btrim(item.value -> 'orderItem' ->> 'badge_reel_type_id'), '') as badge_reel_type_id
    from jsonb_array_elements(p_items) item(value)
  ) incoming
  where stored.id = incoming.order_item_id
    and stored.workspace_id = p_workspace_id
    and stored.badge_reel_type_id is null
    and incoming.badge_reel_type_id is not null;

  update public.order_items stored
  set text_color = incoming.text_color
  from (
    select item.value -> 'orderItem' ->> 'id' as order_item_id,
      nullif(btrim(item.value -> 'orderItem' ->> 'text_color'), '') as text_color
    from jsonb_array_elements(p_items) item(value)
  ) incoming
  where stored.id = incoming.order_item_id
    and stored.workspace_id = p_workspace_id
    and stored.text_color is null
    and incoming.text_color is not null;

  update public.design_lines stored
  set fixed_svg_layer = incoming.fixed_svg_layer
  from (
    select item.value -> 'orderItem' ->> 'id' as order_item_id,
      (line.value ->> 'line_index')::integer as line_index,
      line.value ->> 'fixed_svg_layer' as fixed_svg_layer
    from jsonb_array_elements(p_items) item(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(item.value -> 'lines') = 'array' then item.value -> 'lines' else '[]'::jsonb end
    ) line(value)
    where jsonb_typeof(line.value) = 'object'
      and line.value ->> 'fixed_svg_layer' in ('top', 'backing')
      and line.value ->> 'line_index' ~ '^[0-9]+$'
  ) incoming,
  public.designs design
  where design.order_item_id = incoming.order_item_id
    and design.workspace_id = p_workspace_id
    and stored.design_id = design.id
    and stored.line_index = incoming.line_index
    and stored.item_kind = 'fixed_svg'
    and incoming.order_item_id in (
      select jsonb_array_elements_text(coalesce(v_result -> 'importedOrderItemIds', '[]'::jsonb))
    );

  return v_result;
end;
$$;
revoke all on function public.import_amazon_order_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_amazon_order_items(uuid, uuid, jsonb)
  to service_role;
