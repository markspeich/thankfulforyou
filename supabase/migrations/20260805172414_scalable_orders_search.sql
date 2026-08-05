-- Supports the leading workspace/lifecycle predicate and order-number grouping.
create index if not exists order_items_workspace_status_order_group_idx
  on public.order_items (workspace_id, status, order_number, id);

-- Supports active membership checks for one workspace batch and order item.
create index if not exists batch_items_active_membership_idx
  on public.batch_items (workspace_id, batch_id, order_item_id)
  where status = 'active';

create or replace function public.list_workspace_order_summaries(
  p_workspace_id uuid,
  p_active_batch_id uuid default null,
  p_status_filter text default 'open',
  p_batch_filter text default 'all',
  p_search_term text default '',
  p_requested_limit integer default 50,
  p_cursor_sort_key text default null,
  p_cursor_group_id text default null
)
returns table (
  group_id text,
  sort_key text,
  order_number text,
  buyer_name text,
  group_status text,
  is_in_active_batch boolean,
  ship_by_date date,
  items jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with workspace_items as (
    -- 1. Scope every candidate row to the authenticated workspace supplied by the server.
    select
      orders.id,
      orders.status,
      orders.order_number,
      orders.buyer_name,
      orders.listing_id,
      orders.transaction_id,
      orders.imported_color,
      orders.ship_by_date,
      orders.quantity,
      orders.source_json,
      orders.revision,
      orders.updated_at,
      orders.updated_by,
      orders.created_at,
      designs.id as design_id,
      designs.design_text,
      designs.production_status as design_production_status,
      case
        when nullif(btrim(orders.order_number), '') is not null
          then 'order:' || orders.order_number
        else 'item:' || orders.id
      end as group_id,
      case
        when nullif(btrim(orders.order_number), '') ~ '^[0-9]+$'
          then '3:' || lpad(btrim(orders.order_number), 64, '0')
        when nullif(btrim(orders.order_number), '') is not null
          then '2:' || lower(btrim(orders.order_number))
        else '1:'
      end as order_identity_key,
      exists (
        select 1
        from public.batch_items active_membership
        where p_active_batch_id is not null
          and active_membership.workspace_id = p_workspace_id
          and active_membership.batch_id = p_active_batch_id
          and active_membership.order_item_id = orders.id
          and active_membership.status = 'active'
      ) as is_in_active_batch
    from public.order_items orders
    left join public.designs designs
      on designs.order_item_id = orders.id
     and designs.workspace_id = p_workspace_id
    where orders.workspace_id = p_workspace_id
  ),
  eligible_group_ids as (
    select candidate.group_id
    from workspace_items candidate
    group by candidate.group_id
    having
      -- 2. Apply lifecycle and active-batch predicates to whole groups.
      (
        p_status_filter = 'all'
        or (p_status_filter = 'complete' and bool_and(candidate.status = 'complete'))
        or (p_status_filter = 'skipped' and bool_and(candidate.status = 'skipped'))
        or (
          p_status_filter = 'open'
          and not bool_and(candidate.status = 'complete')
          and not bool_and(candidate.status = 'skipped')
        )
      )
      and (
        p_batch_filter = 'all'
        or (p_batch_filter = 'inBatch' and bool_or(candidate.is_in_active_batch))
        or (p_batch_filter = 'notInBatch' and not bool_or(candidate.is_in_active_batch))
      )
      -- 3. A match in any item/design/line includes the complete order group.
      and (
        coalesce(p_search_term, '') = ''
        or bool_or(
          lower(coalesce(candidate.order_number, '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.buyer_name, '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.listing_id, '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.source_json ->> 'listingTitle', '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.transaction_id, '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.imported_color, '')) like '%' || lower(p_search_term) || '%'
          or lower(coalesce(candidate.design_text, '')) like '%' || lower(p_search_term) || '%'
          or exists (
            select 1
            from public.design_lines lines
            where lines.design_id = candidate.design_id
              and lower(coalesce(lines.text, '')) like '%' || lower(p_search_term) || '%'
          )
        )
      )
  ),
  grouped as (
    -- 4. Aggregate after eligibility so a multi-item order is never split across pages.
    select
      candidate.group_id,
      -- Newest group activity is the primary order across every order-number class;
      -- the normalized identity suffix makes equal timestamps deterministic.
      to_char(max(candidate.created_at) at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
        || ':' || max(candidate.order_identity_key) as sort_key,
      (array_agg(candidate.order_number order by candidate.created_at, candidate.id))[1] as order_number,
      (array_agg(candidate.buyer_name order by candidate.created_at, candidate.id))[1] as buyer_name,
      case
        when bool_and(candidate.status = 'complete') then 'complete'
        when bool_and(candidate.status = 'skipped') then 'skipped'
        else 'open'
      end as group_status,
      bool_or(candidate.is_in_active_batch) as is_in_active_batch,
      min(candidate.ship_by_date) as ship_by_date,
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'status', candidate.status,
          'order_number', candidate.order_number,
          'buyer_name', candidate.buyer_name,
          'listing_id', candidate.listing_id,
          'transaction_id', candidate.transaction_id,
          'imported_color', candidate.imported_color,
          'ship_by_date', candidate.ship_by_date,
          'quantity', candidate.quantity,
          'source_json', jsonb_strip_nulls(jsonb_build_object(
            'marketplace', candidate.source_json ->> 'marketplace',
            'listingTitle', candidate.source_json ->> 'listingTitle'
          )),
          'revision', candidate.revision,
          'updated_at', candidate.updated_at,
          'updated_by', candidate.updated_by,
          'is_in_active_batch', candidate.is_in_active_batch,
          'design_id', candidate.design_id,
          'design_text', coalesce(candidate.design_text, ''),
          'design_production_status', candidate.design_production_status
        )
        order by candidate.created_at, candidate.id
      ) as items
    from workspace_items candidate
    join eligible_group_ids eligible on eligible.group_id = candidate.group_id
    group by candidate.group_id
  )
  select
    grouped.group_id,
    grouped.sort_key,
    grouped.order_number,
    grouped.buyer_name,
    grouped.group_status,
    grouped.is_in_active_batch,
    grouped.ship_by_date,
    grouped.items
  from grouped
  -- 5. Descending keyset pagination uses the same tuple as the stable order below.
  where p_cursor_sort_key is null
     or p_cursor_group_id is null
     or (grouped.sort_key, grouped.group_id) < (p_cursor_sort_key, p_cursor_group_id)
  -- 6. One newest-first key handles numeric, nonnumeric/manual, and null order numbers.
  order by grouped.sort_key desc, grouped.group_id desc
  -- 7. The extra group is used only to derive hasMore.
  limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1;
$$;

revoke all on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text)
  to service_role;
