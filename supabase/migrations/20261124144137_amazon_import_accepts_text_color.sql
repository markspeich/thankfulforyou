-- Amazon imports failed at persistence after order_items.text_color was added:
-- the shared order item row builder now emits text_color, but the strict legacy
-- import_amazon_order_items_without_raw_customization allowlist rejects unknown
-- orderItem keys (22023 "p_items[n].orderItem is invalid").
-- The wrapper now strips text_color before the strict call, like order_date and
-- badge_reel_type_id, then stores it only where the stored value is still null,
-- so re-imports fill a missing text color without overwriting an edited one.
-- Additive: replaces the wrapper function body only; no data is removed.
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
      then jsonb_set(item.value, '{orderItem}', (item.value -> 'orderItem')
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

  return v_result;
end;
$$;
revoke all on function public.import_amazon_order_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_amazon_order_items(uuid, uuid, jsonb)
  to service_role;
