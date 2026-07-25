create table public.amazon_import_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  import_lock_until timestamptz,
  import_lock_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_import_state_lock_pair_check check (
    (import_lock_until is null and import_lock_token is null)
    or (
      import_lock_until is not null
      and import_lock_token is not null
      and btrim(import_lock_token) <> ''
    )
  )
);

alter table public.amazon_import_state enable row level security;

revoke all on table public.amazon_import_state from public, anon, authenticated;
grant all on table public.amazon_import_state to service_role;

create or replace function public.import_amazon_order_items(
  p_workspace_id uuid,
  p_user_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_order_item jsonb;
  v_design jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_order_row public.order_items%rowtype;
  v_design_row public.designs%rowtype;
  v_line_row public.design_lines%rowtype;
  v_design_id uuid;
  v_inserted_id text;
  v_item_index integer;
  v_line_index integer;
  v_imported_ids text[] := array[]::text[];
  v_existing_ids text[] := array[]::text[];
begin
  if p_workspace_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_workspace_id is required';
  end if;

  if not exists (
    select 1
    from public.workspaces
    where id = p_workspace_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'p_workspace_id does not reference an existing workspace';
  end if;

  if p_user_id is not null and not exists (
    select 1
    from auth.users
    where id = p_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'p_user_id does not reference an existing user';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_items must be a JSON array';
  end if;

  for v_item, v_item_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_item) as item_key
        where item_key not in ('orderItem', 'design', 'lines')
      )
      or not (v_item ?& array['orderItem', 'design', 'lines'])
    then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s] must contain only orderItem, design, and lines', v_item_index - 1);
    end if;

    v_order_item := v_item -> 'orderItem';
    v_design := v_item -> 'design';
    v_lines := v_item -> 'lines';

    if jsonb_typeof(v_order_item) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_order_item) as order_key
        where order_key not in (
          'id', 'workspace_id', 'status', 'order_number', 'buyer_name',
          'listing_id', 'transaction_id', 'imported_color', 'ship_by_date',
          'quantity', 'source_json', 'revision', 'updated_by'
        )
      )
    then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s].orderItem is invalid', v_item_index - 1);
    end if;

    if jsonb_typeof(v_design) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_design) as design_key
        where design_key not in (
          'workspace_id', 'order_item_id', 'design_text', 'preset_id',
          'size_guide_id', 'backing_border_mm', 'weld_exported_design',
          'global_horizontal_scale', 'global_vertical_scale',
          'production_status', 'revision', 'updated_by'
        )
      )
    then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s].design is invalid', v_item_index - 1);
    end if;

    if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s].lines must be a non-empty array', v_item_index - 1);
    end if;

    v_order_row := jsonb_populate_record(null::public.order_items, v_order_item);
    v_design_row := jsonb_populate_record(null::public.designs, v_design);

    if v_order_row.id is null
      or btrim(v_order_row.id) = ''
      or v_order_row.workspace_id is distinct from p_workspace_id
      or v_order_row.status is distinct from 'open'
      or v_order_row.quantity is null
      or v_order_row.quantity <= 0
      or v_order_row.source_json is null
      or v_order_row.revision is distinct from 1
      or v_order_row.updated_by is distinct from p_user_id
    then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s].orderItem has invalid values', v_item_index - 1);
    end if;

    if v_design_row.workspace_id is distinct from p_workspace_id
      or v_design_row.order_item_id is distinct from v_order_row.id
      or v_design_row.design_text is null
      or v_design_row.production_status is distinct from 'draft'
      or v_design_row.revision is distinct from 1
      or v_design_row.updated_by is distinct from p_user_id
    then
      raise exception using
        errcode = '22023',
        message = format('p_items[%s].design has invalid values', v_item_index - 1);
    end if;

    for v_line, v_line_index in
      select value, ordinality::integer
      from jsonb_array_elements(v_lines) with ordinality
    loop
      if jsonb_typeof(v_line) <> 'object'
        or exists (
          select 1
          from jsonb_object_keys(v_line) as line_key
          where line_key not in (
            'line_index', 'item_kind', 'text', 'font_id',
            'letter_bridge_mm', 'line_bridge_mm', 'offset_x_mm',
            'offset_y_mm', 'text_height_mm', 'horizontal_scale',
            'vertical_scale', 'lock_text_height', 'fixed_design_id',
            'fixed_design_version', 'svg_size_mm', 'fixed_svg_backing_border'
          )
        )
      then
        raise exception using
          errcode = '22023',
          message = format(
            'p_items[%s].lines[%s] is invalid',
            v_item_index - 1,
            v_line_index - 1
          );
      end if;

      v_line_row := jsonb_populate_record(null::public.design_lines, v_line);
      if v_line_row.line_index is distinct from v_line_index - 1
        or v_line_row.item_kind is null
        or v_line_row.text is null
        or v_line_row.font_id is null
        or btrim(v_line_row.font_id) = ''
      then
        raise exception using
          errcode = '22023',
          message = format(
            'p_items[%s].lines[%s] has invalid values',
            v_item_index - 1,
            v_line_index - 1
          );
      end if;
    end loop;

    insert into public.order_items (
      id,
      workspace_id,
      status,
      order_number,
      buyer_name,
      listing_id,
      transaction_id,
      imported_color,
      ship_by_date,
      quantity,
      source_json,
      revision,
      updated_by
    )
    values (
      v_order_row.id,
      v_order_row.workspace_id,
      v_order_row.status,
      v_order_row.order_number,
      v_order_row.buyer_name,
      v_order_row.listing_id,
      v_order_row.transaction_id,
      v_order_row.imported_color,
      v_order_row.ship_by_date,
      v_order_row.quantity,
      v_order_row.source_json,
      v_order_row.revision,
      v_order_row.updated_by
    )
    on conflict (id) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
      v_existing_ids := array_append(v_existing_ids, v_order_row.id);
      continue;
    end if;

    v_imported_ids := array_append(v_imported_ids, v_inserted_id);

    insert into public.designs (
      workspace_id,
      order_item_id,
      design_text,
      preset_id,
      size_guide_id,
      backing_border_mm,
      weld_exported_design,
      global_horizontal_scale,
      global_vertical_scale,
      production_status,
      revision,
      updated_by
    )
    values (
      v_design_row.workspace_id,
      v_design_row.order_item_id,
      v_design_row.design_text,
      v_design_row.preset_id,
      v_design_row.size_guide_id,
      v_design_row.backing_border_mm,
      v_design_row.weld_exported_design,
      v_design_row.global_horizontal_scale,
      v_design_row.global_vertical_scale,
      v_design_row.production_status,
      v_design_row.revision,
      v_design_row.updated_by
    )
    returning id into v_design_id;

    for v_line in
      select value
      from jsonb_array_elements(v_lines) with ordinality
      order by ordinality
    loop
      v_line_row := jsonb_populate_record(null::public.design_lines, v_line);

      insert into public.design_lines (
        design_id,
        line_index,
        item_kind,
        text,
        font_id,
        letter_bridge_mm,
        line_bridge_mm,
        offset_x_mm,
        offset_y_mm,
        text_height_mm,
        horizontal_scale,
        vertical_scale,
        lock_text_height,
        fixed_design_id,
        fixed_design_version,
        svg_size_mm,
        fixed_svg_backing_border
      )
      values (
        v_design_id,
        v_line_row.line_index,
        v_line_row.item_kind,
        v_line_row.text,
        v_line_row.font_id,
        v_line_row.letter_bridge_mm,
        v_line_row.line_bridge_mm,
        v_line_row.offset_x_mm,
        v_line_row.offset_y_mm,
        v_line_row.text_height_mm,
        v_line_row.horizontal_scale,
        v_line_row.vertical_scale,
        v_line_row.lock_text_height,
        v_line_row.fixed_design_id,
        v_line_row.fixed_design_version,
        v_line_row.svg_size_mm,
        v_line_row.fixed_svg_backing_border
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'importedOrderItemIds', to_jsonb(v_imported_ids),
    'existingOrderItemIds', to_jsonb(v_existing_ids)
  );
end;
$$;

revoke all on function public.import_amazon_order_items(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.import_amazon_order_items(uuid, uuid, jsonb)
to service_role;
