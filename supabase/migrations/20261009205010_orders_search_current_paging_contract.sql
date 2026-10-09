-- Restore bounded discovery for the current default ship-by ordering and legacy title search.
-- Existing order data and projection locking remain unchanged.
-- Alternate sorts and nonempty searches retain the existing grouped query path.
alter table public.order_group_summaries add column ship_by_sort_key text generated always as (
  case when ship_by_date is null then '1:' else '0:'
    || lpad(extract(year from ship_by_date)::text, 4, '0')
    || lpad(extract(month from ship_by_date)::text, 2, '0')
    || lpad(extract(day from ship_by_date)::text, 2, '0') end
) stored;
alter table public.order_group_batch_visibility add column ship_by_sort_key text not null default '1:';
update public.order_group_batch_visibility visibility set ship_by_sort_key = summaries.ship_by_sort_key
from public.order_group_summaries summaries
where summaries.workspace_id = visibility.workspace_id and summaries.group_id = visibility.group_id;
create index order_group_summaries_ship_by_page_idx on public.order_group_summaries(workspace_id, ship_by_sort_key, group_id);
create index order_group_summaries_ship_by_status_page_idx on public.order_group_summaries(workspace_id, group_status, ship_by_sort_key, group_id);
create index order_group_batch_visibility_ship_by_page_idx on public.order_group_batch_visibility(workspace_id, batch_id, is_in_batch, ship_by_sort_key, group_id);
create index order_group_batch_visibility_ship_by_status_page_idx on public.order_group_batch_visibility(workspace_id, batch_id, is_in_batch, group_status, ship_by_sort_key, group_id);

create or replace function public.refresh_order_group_batch_visibility(
  p_workspace_id uuid,
  p_group_id text,
  p_batch_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_workspace_id is null or p_group_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'order-group-projection|' || p_workspace_id::text || '|' || p_group_id,
      0
    )
  );

  delete from public.order_group_batch_visibility visibility
  where visibility.workspace_id = p_workspace_id
    and visibility.group_id = p_group_id
    and (p_batch_id is null or visibility.batch_id = p_batch_id)
    and (
      not exists (
        select 1
        from public.order_group_summaries summaries
        where summaries.workspace_id = p_workspace_id
          and summaries.group_id = p_group_id
      )
      or not exists (
        select 1
        from public.production_batches batches
        where batches.workspace_id = p_workspace_id
          and batches.id = visibility.batch_id
      )
    );

  insert into public.order_group_batch_visibility (
    workspace_id,
    batch_id,
    group_id,
    sort_key,
    ship_by_sort_key,
    group_status,
    is_in_batch,
    updated_at
  )
  select
    summaries.workspace_id,
    batches.id,
    summaries.group_id,
    summaries.sort_key,
    summaries.ship_by_sort_key,
    summaries.group_status,
    exists (
      select 1
      from public.order_items orders
      join public.batch_items active_membership
        on active_membership.workspace_id = summaries.workspace_id
       and active_membership.batch_id = batches.id
       and active_membership.order_item_id = orders.id
       and active_membership.status = 'active'
      where orders.workspace_id = summaries.workspace_id
        and (
          case
            when nullif(btrim(orders.order_number), '') is not null
              then 'order:' || orders.order_number
            else 'item:' || orders.id
          end
        ) = summaries.group_id
    ),
    now()
  from public.order_group_summaries summaries
  join public.production_batches batches
    on batches.workspace_id = summaries.workspace_id
  where summaries.workspace_id = p_workspace_id
    and summaries.group_id = p_group_id
    and (p_batch_id is null or batches.id = p_batch_id)
  on conflict (workspace_id, batch_id, group_id) do update
    set sort_key = excluded.sort_key,
        ship_by_sort_key = excluded.ship_by_sort_key,
        group_status = excluded.group_status,
        is_in_batch = excluded.is_in_batch,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.refresh_order_group_batch_visibility(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_order_group_batch_visibility(uuid, text, uuid)
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
  p_sort_direction text default 'asc',
  p_ship_by_from date default null,
  p_ship_by_to date default null
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
      case when bool_and(orders.status = 'complete') then 'complete' when bool_and(orders.status = 'skipped') then 'skipped' when not bool_or(orders.status = 'open') then 'archived' else 'open' end as group_status,
      bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active')) as is_in_active_batch,
      min(orders.ship_by_date) as ship_by_date, min(orders.order_date) as order_date, count(*) as item_count
    from public.order_items orders
    left join public.designs designs on designs.workspace_id = p_workspace_id and designs.order_item_id = orders.id
    cross join search_params search
    where orders.workspace_id = p_workspace_id and not (coalesce(p_search_term, '') = '' and coalesce(p_sort_by, '') = 'shipByDate' and coalesce(p_sort_direction, '') = 'asc')
    group by case when nullif(btrim(orders.order_number), '') is not null then 'order:' || orders.order_number else 'item:' || orders.id end
    having (p_status_filter = 'all' or (p_status_filter = 'complete' and bool_and(orders.status = 'complete')) or (p_status_filter = 'skipped' and bool_and(orders.status = 'skipped')) or (p_status_filter = 'open' and bool_or(orders.status = 'open')))
      and (p_batch_filter = 'all' or (p_batch_filter = 'inBatch' and bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active'))) or (p_batch_filter = 'notInBatch' and not bool_or(exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active'))))
      and (p_ship_by_from is null or min(orders.ship_by_date) >= p_ship_by_from)
      and (p_ship_by_to is null or min(orders.ship_by_date) <= p_ship_by_to)
      and (coalesce(p_search_term, '') = '' or bool_or(lower(coalesce(orders.order_number, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.buyer_name, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.listing_id, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.transaction_id, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.imported_color, '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.source_json ->> 'listingTitle', '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(orders.source_json ->> 'title', '')) like '%' || search.term || '%' escape E'\\' or lower(coalesce(designs.design_text, '')) like '%' || search.term || '%' escape E'\\' or exists (select 1 from public.design_lines lines where lines.design_id = designs.id and lower(coalesce(lines.text, '')) like '%' || search.term || '%' escape E'\\')))
  ), sortable as (
    select candidate.*, case p_sort_by when 'orderNumber' then case when nullif(btrim(candidate.order_number), '') ~ '^[0-9]+$' then '3:' || lpad(btrim(candidate.order_number), 64, '0') when nullif(btrim(candidate.order_number), '') is not null then '2:' || lower(btrim(candidate.order_number)) end when 'orderDate' then to_char(candidate.order_date at time zone 'UTC', 'YYYYMMDDHH24MISSUS') when 'buyerName' then nullif(lower(btrim(candidate.buyer_name)), '') when 'itemCount' then lpad(candidate.item_count::text, 20, '0') when 'inBatch' then case when candidate.is_in_active_batch then '1' else '0' end else to_char(candidate.ship_by_date, 'YYYYMMDD') end as sort_value
    from grouped_candidates candidate
  ), keyed as (
    select sortable.*, (case when sortable.sort_value is null then '1:' else '0:' end) || coalesce(sortable.sort_value, '') as sort_key from sortable
  ), searched_page_keys as materialized (
    select keyed.group_id, keyed.sort_key, keyed.sort_value from keyed
    where p_cursor_sort_key is null or p_cursor_group_id is null or left(keyed.sort_key, 2) > left(p_cursor_sort_key, 2) or (left(keyed.sort_key, 2) = left(p_cursor_sort_key, 2) and ((p_sort_direction = 'asc' and (substr(keyed.sort_key, 3), keyed.group_id) > (substr(p_cursor_sort_key, 3), p_cursor_group_id)) or (p_sort_direction = 'desc' and (substr(keyed.sort_key, 3), keyed.group_id) < (substr(p_cursor_sort_key, 3), p_cursor_group_id))))
    order by (keyed.sort_value is null) asc, case when p_sort_direction = 'asc' then keyed.sort_value end asc, case when p_sort_direction = 'desc' then keyed.sort_value end desc, case when p_sort_direction = 'asc' then keyed.group_id end asc, case when p_sort_direction = 'desc' then keyed.group_id end desc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), summary_all as materialized (
    select summaries.group_id, summaries.ship_by_sort_key as sort_key, nullif(substr(summaries.ship_by_sort_key, 3), '') as sort_value
    from public.order_group_summaries summaries
    where coalesce(p_search_term, '') = '' and coalesce(p_sort_by, '') = 'shipByDate' and coalesce(p_sort_direction, '') = 'asc'
      and summaries.workspace_id = p_workspace_id
      and p_status_filter = 'all'
      and (p_batch_filter = 'all' or (p_batch_filter = 'notInBatch' and not exists (select 1 from public.production_batches batches where batches.workspace_id = p_workspace_id and batches.id = p_active_batch_id)))
      and (summaries.ship_by_sort_key, summaries.group_id) > (case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_sort_key end, case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_group_id end)
      and (p_ship_by_from is null or summaries.ship_by_sort_key >= '0:' || to_char(p_ship_by_from, 'YYYYMMDD'))
      and (p_ship_by_to is null or summaries.ship_by_sort_key <= '0:' || to_char(p_ship_by_to, 'YYYYMMDD'))
      and (p_ship_by_from is null or summaries.ship_by_sort_key <> '1:')
    order by summaries.ship_by_sort_key asc, summaries.group_id asc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), summary_status as materialized (
    select summaries.group_id, summaries.ship_by_sort_key as sort_key, nullif(substr(summaries.ship_by_sort_key, 3), '') as sort_value
    from public.order_group_summaries summaries
    where coalesce(p_search_term, '') = '' and coalesce(p_sort_by, '') = 'shipByDate' and coalesce(p_sort_direction, '') = 'asc'
      and summaries.workspace_id = p_workspace_id
      and p_status_filter in ('open','skipped','complete') and summaries.group_status = p_status_filter
      and (p_batch_filter = 'all' or (p_batch_filter = 'notInBatch' and not exists (select 1 from public.production_batches batches where batches.workspace_id = p_workspace_id and batches.id = p_active_batch_id)))
      and (summaries.ship_by_sort_key, summaries.group_id) > (case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_sort_key end, case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_group_id end)
      and (p_ship_by_from is null or summaries.ship_by_sort_key >= '0:' || to_char(p_ship_by_from, 'YYYYMMDD'))
      and (p_ship_by_to is null or summaries.ship_by_sort_key <= '0:' || to_char(p_ship_by_to, 'YYYYMMDD'))
      and (p_ship_by_from is null or summaries.ship_by_sort_key <> '1:')
    order by summaries.ship_by_sort_key asc, summaries.group_id asc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), batch_all as materialized (
    select visibility.group_id, visibility.ship_by_sort_key as sort_key, nullif(substr(visibility.ship_by_sort_key, 3), '') as sort_value
    from public.order_group_batch_visibility visibility
    where coalesce(p_search_term, '') = '' and coalesce(p_sort_by, '') = 'shipByDate' and coalesce(p_sort_direction, '') = 'asc'
      and visibility.workspace_id = p_workspace_id
      and p_status_filter = 'all'
      and p_batch_filter in ('inBatch','notInBatch')
      and visibility.batch_id = p_active_batch_id
      and visibility.is_in_batch = (p_batch_filter = 'inBatch')
      and (visibility.ship_by_sort_key, visibility.group_id) > (case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_sort_key end, case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_group_id end)
      and (p_ship_by_from is null or visibility.ship_by_sort_key >= '0:' || to_char(p_ship_by_from, 'YYYYMMDD'))
      and (p_ship_by_to is null or visibility.ship_by_sort_key <= '0:' || to_char(p_ship_by_to, 'YYYYMMDD'))
      and (p_ship_by_from is null or visibility.ship_by_sort_key <> '1:')
    order by visibility.ship_by_sort_key asc, visibility.group_id asc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), batch_status as materialized (
    select visibility.group_id, visibility.ship_by_sort_key as sort_key, nullif(substr(visibility.ship_by_sort_key, 3), '') as sort_value
    from public.order_group_batch_visibility visibility
    where coalesce(p_search_term, '') = '' and coalesce(p_sort_by, '') = 'shipByDate' and coalesce(p_sort_direction, '') = 'asc'
      and visibility.workspace_id = p_workspace_id
      and p_status_filter in ('open','skipped','complete') and visibility.group_status = p_status_filter
      and p_batch_filter in ('inBatch','notInBatch')
      and visibility.batch_id = p_active_batch_id
      and visibility.is_in_batch = (p_batch_filter = 'inBatch')
      and (visibility.ship_by_sort_key, visibility.group_id) > (case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_sort_key end, case when p_cursor_sort_key is null or p_cursor_group_id is null then '' else p_cursor_group_id end)
      and (p_ship_by_from is null or visibility.ship_by_sort_key >= '0:' || to_char(p_ship_by_from, 'YYYYMMDD'))
      and (p_ship_by_to is null or visibility.ship_by_sort_key <= '0:' || to_char(p_ship_by_to, 'YYYYMMDD'))
      and (p_ship_by_from is null or visibility.ship_by_sort_key <> '1:')
    order by visibility.ship_by_sort_key asc, visibility.group_id asc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ), page_keys as materialized (
    select * from searched_page_keys
    union all select * from summary_all
    union all select * from summary_status
    union all select * from batch_all
    union all select * from batch_status
  ), hydrated as (
    select page.group_id, page.sort_key, page.sort_value, orders.*, designs.id as design_id, designs.design_text, designs.production_status as design_production_status,
      exists (select 1 from public.batch_items memberships where p_active_batch_id is not null and memberships.workspace_id = p_workspace_id and memberships.batch_id = p_active_batch_id and memberships.order_item_id = orders.id and memberships.status = 'active') as item_is_in_active_batch
    from page_keys page
    join public.order_items orders on orders.workspace_id = p_workspace_id and (case when nullif(btrim(orders.order_number), '') is not null then 'order:' || orders.order_number else 'item:' || orders.id end) = page.group_id
    left join public.designs designs on designs.workspace_id = p_workspace_id and designs.order_item_id = orders.id
  )
  select hydrated.group_id, hydrated.sort_key, (array_agg(hydrated.order_number order by hydrated.created_at, hydrated.id))[1], (array_agg(hydrated.buyer_name order by hydrated.created_at, hydrated.id))[1], case when bool_and(hydrated.status = 'complete') then 'complete' when bool_and(hydrated.status = 'skipped') then 'skipped' when not bool_or(hydrated.status = 'open') then 'archived' else 'open' end, bool_or(hydrated.item_is_in_active_batch), min(hydrated.ship_by_date), min(hydrated.order_date), count(*),
    jsonb_agg(jsonb_build_object('id', hydrated.id, 'status', hydrated.status, 'order_number', hydrated.order_number, 'buyer_name', hydrated.buyer_name, 'listing_id', hydrated.listing_id, 'transaction_id', hydrated.transaction_id, 'imported_color', hydrated.imported_color, 'badge_reel_type_id', hydrated.badge_reel_type_id, 'badge_reel_type_candidate_present', public.retained_badge_reel_type_candidate(hydrated.source_json) -> 'present', 'ship_by_date', hydrated.ship_by_date, 'order_date', hydrated.order_date, 'quantity', hydrated.quantity, 'source_json', jsonb_strip_nulls(jsonb_build_object('marketplace', hydrated.source_json ->> 'marketplace', 'listingTitle', hydrated.source_json ->> 'listingTitle', 'listingImageUrl75x75', hydrated.source_json ->> 'listingImageUrl75x75')), 'revision', hydrated.revision, 'updated_at', hydrated.updated_at, 'updated_by', hydrated.updated_by, 'is_in_active_batch', hydrated.item_is_in_active_batch, 'design_id', hydrated.design_id, 'design_text', coalesce(hydrated.design_text, ''), 'design_production_status', hydrated.design_production_status) order by hydrated.created_at, hydrated.id)
  from hydrated
  group by hydrated.group_id, hydrated.sort_key, hydrated.sort_value
  order by (hydrated.sort_value is null) asc, case when p_sort_direction = 'asc' then hydrated.sort_value end asc, case when p_sort_direction = 'desc' then hydrated.sort_value end desc, case when p_sort_direction = 'asc' then hydrated.group_id end asc, case when p_sort_direction = 'desc' then hydrated.group_id end desc
$$;

revoke all on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text, text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text, text, text, date, date)
  to service_role;
