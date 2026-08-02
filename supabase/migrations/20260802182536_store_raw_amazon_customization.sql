alter table public.order_items
  add column amazon_customization_json jsonb;

alter function public.import_amazon_order_items(uuid, uuid, jsonb)
  rename to import_amazon_order_items_without_raw_customization;

revoke all on function public.import_amazon_order_items_without_raw_customization(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

create function public.import_amazon_order_items(
  p_workspace_id uuid,
  p_user_id uuid,
  p_items jsonb
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
    return public.import_amazon_order_items_without_raw_customization(
      p_workspace_id,
      p_user_id,
      p_items
    );
  end if;

  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(item.value) = 'object'
          and jsonb_typeof(item.value -> 'orderItem') = 'object'
        then jsonb_set(
          item.value,
          '{orderItem}',
          (item.value -> 'orderItem') - 'amazon_customization_json'
        )
        else item.value
      end
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_sanitized_items
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality);

  v_result := public.import_amazon_order_items_without_raw_customization(
    p_workspace_id,
    p_user_id,
    v_sanitized_items
  );

  update public.order_items as stored
  set amazon_customization_json = incoming.document
  from (
    select
      item.value -> 'orderItem' ->> 'id' as order_item_id,
      item.value -> 'orderItem' -> 'amazon_customization_json' as document
    from jsonb_array_elements(p_items) as item(value)
    where jsonb_typeof(item.value) = 'object'
      and jsonb_typeof(item.value -> 'orderItem') = 'object'
      and jsonb_typeof(item.value -> 'orderItem' -> 'amazon_customization_json') = 'object'
  ) as incoming
  where stored.id = incoming.order_item_id
    and stored.workspace_id = p_workspace_id;

  return v_result;
end;
$$;

revoke all on function public.import_amazon_order_items(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.import_amazon_order_items(uuid, uuid, jsonb)
to service_role;
