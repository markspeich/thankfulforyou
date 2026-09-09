alter table public.order_items
  add column if not exists badge_reel_type_id text;

-- The first reel-type field is authoritative even when its value is not a
-- recognized canonical type.  This prevents a later duplicate field from
-- silently changing a historical order's selection.
update public.order_items stored
set badge_reel_type_id = incoming.badge_reel_type_id
from (
  select candidate.id, selected.badge_reel_type_id
  from public.order_items candidate
  cross join lateral (
    select case btrim(regexp_replace(regexp_replace(lower(coalesce(entry.value ->> 'value', '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
      when 'swivel alligator' then 'swivel-alligator'
      when 'swivel alligator clip' then 'swivel-alligator'
      else null
    end as badge_reel_type_id
    from jsonb_array_elements(coalesce(candidate.source_json -> 'personalizationResponses', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    where btrim(regexp_replace(regexp_replace(lower(coalesce(entry.value ->> 'name', entry.value ->> 'label', '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
      in ('badge reel', 'badge reel type')
    order by entry.ordinality
    limit 1
  ) selected
  where lower(coalesce(candidate.source_json ->> 'marketplace', '')) = 'amazon'
    and candidate.badge_reel_type_id is null
    and selected.badge_reel_type_id is not null
) incoming
where stored.id = incoming.id
  and stored.badge_reel_type_id is null
  and incoming.badge_reel_type_id is not null;

update public.order_items stored
set badge_reel_type_id = incoming.badge_reel_type_id
from (
  select candidate.id, selected.badge_reel_type_id
  from public.order_items candidate
  cross join lateral (
    select case btrim(regexp_replace(regexp_replace(lower(coalesce(entry.value ->> 'formatted_value', '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
      when 'swivel alligator' then 'swivel-alligator'
      when 'swivel alligator clip' then 'swivel-alligator'
      else null
    end as badge_reel_type_id
    from jsonb_array_elements(coalesce(candidate.source_json -> 'variations', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    where btrim(regexp_replace(regexp_replace(lower(coalesce(entry.value ->> 'formatted_name', '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
      in ('badge reel', 'badge reel type')
    order by entry.ordinality
    limit 1
  ) selected
  where lower(coalesce(candidate.source_json ->> 'marketplace', '')) = 'etsy'
    and candidate.badge_reel_type_id is null
    and selected.badge_reel_type_id is not null
) incoming
where stored.id = incoming.id
  and stored.badge_reel_type_id is null
  and incoming.badge_reel_type_id is not null;

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
        - 'amazon_customization_json' - 'etsy_import_diagnostics' - 'order_date' - 'badge_reel_type_id')
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

  return v_result;
end;
$$;

revoke all on function public.import_amazon_order_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_amazon_order_items(uuid, uuid, jsonb)
  to service_role;

create or replace function public.list_workspace_order_summaries(
  p_workspace_id uuid,
  p_active_batch_id uuid default null,
  p_status_filter text default 'open',
  p_batch_filter text default 'all',
  p_search_term text default '',
  p_requested_limit integer default 50,
  p_cursor_sort_key text default null,
  p_cursor_group_id text default null,
  p_sort_by text default 'shipByDate',
  p_sort_direction text default 'asc'
)
returns table (
  group_id text, sort_key text, order_number text, buyer_name text, group_status text,
  is_in_active_batch boolean, ship_by_date date, order_date timestamptz, item_count bigint, items jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with search_params as (
    select replace(replace(replace(lower(coalesce(p_search_term, '')), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as term
  ), grouped_candidates as materialized (
    select case when nullif(btrim(orders.order_number), '') is not null then 'order:' || orders.order_number else 'item:' || orders.id end as group_id,
      (array_agg(orders.order_number order by orders.created_at, orders.id))[1] as order_number,
      (array_agg(orders.buyer_name order by orders.created_at, orders.id))[1] as buyer_name,
      case when bool_and(orders.status = 'complete') then 'complete' when bool_and(orders.status = 'skipped') then 'skipped' else 'open' end as group_status,
      bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active')) as is_in_active_batch,
      min(orders.ship_by_date) as ship_by_date, min(orders.order_date) as order_date, count(*) as item_count
    from public.order_items orders
    left join public.designs designs on designs.workspace_id = p_workspace_id and designs.order_item_id = orders.id
    cross join search_params search
    where orders.workspace_id = p_workspace_id
    group by case when nullif(btrim(orders.order_number), '') is not null then 'order:' || orders.order_number else 'item:' || orders.id end
    having (p_status_filter = 'all' or (p_status_filter = 'complete' and bool_and(orders.status = 'complete')) or (p_status_filter = 'skipped' and bool_and(orders.status = 'skipped')) or (p_status_filter = 'open' and not bool_and(orders.status = 'complete') and not bool_and(orders.status = 'skipped')))
      and (p_batch_filter = 'all' or (p_batch_filter = 'inBatch' and bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active'))) or (p_batch_filter = 'notInBatch' and not bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active'))))
      and (coalesce(p_search_term, '') = '' or bool_or(lower(coalesce(orders.order_number, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.buyer_name, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.listing_id, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.transaction_id, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.imported_color, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.source_json ->> 'listingTitle', '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(designs.design_text, '')) like '%' || search.term || '%' escape E'\\' or exists (select 1 from public.design_lines lines where lines.design_id = designs.id and lower(coalesce(lines.text, '')) like '%' || search.term || '%' escape E'\\')))
  ), sortable as (
    select candidate.*, case p_sort_by when 'orderNumber' then case when nullif(btrim(candidate.order_number), '') ~ '^[0-9]+$' then '3:' || lpad(btrim(candidate.order_number), 64, '0') when nullif(btrim(candidate.order_number), '') is not null then '2:' || lower(btrim(candidate.order_number)) end when 'orderDate' then to_char(candidate.order_date at time zone 'UTC', 'YYYYMMDDHH24MISSUS') when 'buyerName' then nullif(lower(btrim(candidate.buyer_name)), '') when 'itemCount' then lpad(candidate.item_count::text, 20, '0') when 'inBatch' then case when candidate.is_in_active_batch then '1' else '0' end else to_char(candidate.ship_by_date, 'YYYYMMDD') end as sort_value
    from grouped_candidates candidate
  ), keyed as (
    select sortable.*, (case when sortable.sort_value is null then '1:' else '0:' end) || coalesce(sortable.sort_value, '') as sort_key from sortable
  ), page_keys as materialized (
    select keyed.* from keyed
    where p_cursor_sort_key is null or p_cursor_group_id is null or left(keyed.sort_key, 2) > left(p_cursor_sort_key, 2) or (left(keyed.sort_key, 2) = left(p_cursor_sort_key, 2) and ((p_sort_direction = 'asc' and (substr(keyed.sort_key, 3), keyed.group_id) > (substr(p_cursor_sort_key, 3), p_cursor_group_id)) or (p_sort_direction = 'desc' and (substr(keyed.sort_key, 3), keyed.group_id) < (substr(p_cursor_sort_key, 3), p_cursor_group_id))))
    order by (keyed.sort_value is null) asc, case when p_sort_direction = 'asc' then keyed.sort_value end asc, case when p_sort_direction = 'desc' then keyed.sort_value end desc, case when p_sort_direction = 'asc' then keyed.group_id end asc, case when p_sort_direction = 'desc' then keyed.group_id end desc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), hydrated as (
    select page.group_id, page.sort_key, page.sort_value, orders.*, designs.id as design_id, designs.design_text, designs.production_status as design_production_status,
      exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active') as item_is_in_active_batch
    from page_keys page
    join public.order_items orders on orders.workspace_id = p_workspace_id and (case when nullif(btrim(orders.order_number), '') is not null then 'order:' || orders.order_number else 'item:' || orders.id end) = page.group_id
    left join public.designs designs on designs.workspace_id = p_workspace_id and designs.order_item_id = orders.id
  )
  select hydrated.group_id, hydrated.sort_key, (array_agg(hydrated.order_number order by hydrated.created_at, hydrated.id))[1], (array_agg(hydrated.buyer_name order by hydrated.created_at, hydrated.id))[1], case when bool_and(hydrated.status = 'complete') then 'complete' when bool_and(hydrated.status = 'skipped') then 'skipped' else 'open' end, bool_or(hydrated.item_is_in_active_batch), min(hydrated.ship_by_date), min(hydrated.order_date), count(*),
    jsonb_agg(jsonb_build_object('id', hydrated.id, 'status', hydrated.status, 'order_number', hydrated.order_number, 'buyer_name', hydrated.buyer_name, 'listing_id', hydrated.listing_id, 'transaction_id', hydrated.transaction_id, 'imported_color', hydrated.imported_color, 'badge_reel_type_id', hydrated.badge_reel_type_id, 'ship_by_date', hydrated.ship_by_date, 'order_date', hydrated.order_date, 'quantity', hydrated.quantity, 'source_json', jsonb_strip_nulls(jsonb_build_object('marketplace', hydrated.source_json ->> 'marketplace', 'listingTitle', hydrated.source_json ->> 'listingTitle', 'listingImageUrl75x75', hydrated.source_json ->> 'listingImageUrl75x75')), 'revision', hydrated.revision, 'updated_at', hydrated.updated_at, 'updated_by', hydrated.updated_by, 'is_in_active_batch', hydrated.item_is_in_active_batch, 'design_id', hydrated.design_id, 'design_text', coalesce(hydrated.design_text, ''), 'design_production_status', hydrated.design_production_status) order by hydrated.created_at, hydrated.id)
  from hydrated
  group by hydrated.group_id, hydrated.sort_key, hydrated.sort_value
  order by (hydrated.sort_value is null) asc, case when p_sort_direction = 'asc' then hydrated.sort_value end asc, case when p_sort_direction = 'desc' then hydrated.sort_value end desc, case when p_sort_direction = 'asc' then hydrated.group_id end asc, case when p_sort_direction = 'desc' then hydrated.group_id end desc
$$;

revoke all on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text, text, text)
  to service_role;
