-- Supports empty-search keyset scans in newest-first group order.
create index if not exists order_items_workspace_newest_group_idx
  on public.order_items (
    workspace_id,
    created_at desc,
    (
      case
        when nullif(btrim(order_number), '') ~ '^[0-9]+$'
          then '3:' || lpad(btrim(order_number), 64, '0')
        when nullif(btrim(order_number), '') is not null
          then '2:' || lower(btrim(order_number))
        else '1:'
      end
    ) desc,
    (
      case
        when nullif(btrim(order_number), '') is not null
          then 'order:' || order_number
        else 'item:' || id
      end
    ) desc,
    id desc
  );

-- Supports newest-representative checks, whole-group filters, and page hydration.
create index if not exists order_items_workspace_group_members_idx
  on public.order_items (
    workspace_id,
    (
      case
        when nullif(btrim(order_number), '') is not null
          then 'order:' || order_number
        else 'item:' || id
      end
    ),
    created_at desc,
    id desc
  );

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
  with search_params as (
    select
      -- Escape the escape character before LIKE metacharacters so user input is always literal.
      replace(
        replace(
          replace(lower(coalesce(p_search_term, '')), E'\\', E'\\\\'),
          '%', E'\\%'
        ),
        '_', E'\\_'
      ) as escaped_search_term
  ),
  cursor_params as (
    select
      case
        when p_cursor_sort_key is null or p_cursor_group_id is null then 'infinity'::timestamptz
        else make_timestamptz(
          substr(p_cursor_sort_key, 1, 4)::integer,
          substr(p_cursor_sort_key, 5, 2)::integer,
          substr(p_cursor_sort_key, 7, 2)::integer,
          substr(p_cursor_sort_key, 9, 2)::integer,
          substr(p_cursor_sort_key, 11, 2)::integer,
          substr(p_cursor_sort_key, 13, 2)::double precision
            + substr(p_cursor_sort_key, 15, 6)::double precision / 1000000,
          'UTC'
        )
      end as cursor_created_at,
      case
        when p_cursor_sort_key is null or p_cursor_group_id is null then ''
        else substr(p_cursor_sort_key, 22)
      end as cursor_order_sort,
      coalesce(p_cursor_group_id, '') as cursor_group_id
  ),
  empty_page_group_keys as materialized (
    -- Empty search stays page-bounded: start at the cursor in the newest-first index,
    -- qualify one newest representative per group, and stop at limit + 1.
    select
      case
        when nullif(btrim(representative.order_number), '') is not null
          then 'order:' || representative.order_number
        else 'item:' || representative.id
      end as group_id,
      to_char(representative.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
        || ':' || case
          when nullif(btrim(representative.order_number), '') ~ '^[0-9]+$'
            then '3:' || lpad(btrim(representative.order_number), 64, '0')
          when nullif(btrim(representative.order_number), '') is not null
            then '2:' || lower(btrim(representative.order_number))
          else '1:'
        end as sort_key
    from public.order_items representative
    cross join search_params params
    cross join cursor_params cursor
    cross join lateral (
      select
        bool_and(group_member.status = 'complete') as all_complete,
        bool_and(group_member.status = 'skipped') as all_skipped,
        bool_or(group_member.status = 'open') as any_open,
        bool_or(exists (
          select 1
          from public.batch_items active_membership
          where p_active_batch_id is not null
            and active_membership.workspace_id = p_workspace_id
            and active_membership.batch_id = p_active_batch_id
            and active_membership.order_item_id = group_member.id
            and active_membership.status = 'active'
        )) as any_in_active_batch
      from public.order_items group_member
      where group_member.workspace_id = p_workspace_id
        and (
          case
            when nullif(btrim(group_member.order_number), '') is not null
              then 'order:' || group_member.order_number
            else 'item:' || group_member.id
          end
        ) = (
          case
            when nullif(btrim(representative.order_number), '') is not null
              then 'order:' || representative.order_number
            else 'item:' || representative.id
          end
        )
    ) group_state
    where params.escaped_search_term = ''
      and representative.workspace_id = p_workspace_id
      and not exists (
        select 1
        from public.order_items newer_group_member
        where newer_group_member.workspace_id = p_workspace_id
          and (
            case
              when nullif(btrim(newer_group_member.order_number), '') is not null
                then 'order:' || newer_group_member.order_number
              else 'item:' || newer_group_member.id
            end
          ) = (
            case
              when nullif(btrim(representative.order_number), '') is not null
                then 'order:' || representative.order_number
              else 'item:' || representative.id
            end
          )
          and (newer_group_member.created_at, newer_group_member.id)
            > (representative.created_at, representative.id)
      )
      and (
          representative.created_at,
          case
            when nullif(btrim(representative.order_number), '') ~ '^[0-9]+$'
              then '3:' || lpad(btrim(representative.order_number), 64, '0')
            when nullif(btrim(representative.order_number), '') is not null
              then '2:' || lower(btrim(representative.order_number))
            else '1:'
          end,
          case
            when nullif(btrim(representative.order_number), '') is not null
              then 'order:' || representative.order_number
            else 'item:' || representative.id
          end
        ) < (
          cursor.cursor_created_at,
          cursor.cursor_order_sort,
          cursor.cursor_group_id
        )
      and (
        p_status_filter = 'all'
        or (p_status_filter = 'complete' and group_state.all_complete)
        or (p_status_filter = 'skipped' and group_state.all_skipped)
        or (p_status_filter = 'open' and group_state.any_open)
      )
      and (
        p_batch_filter = 'all'
        or (p_batch_filter = 'inBatch' and group_state.any_in_active_batch)
        or (p_batch_filter = 'notInBatch' and not group_state.any_in_active_batch)
      )
    order by
      representative.created_at desc,
      case
        when nullif(btrim(representative.order_number), '') ~ '^[0-9]+$'
          then '3:' || lpad(btrim(representative.order_number), 64, '0')
        when nullif(btrim(representative.order_number), '') is not null
          then '2:' || lower(btrim(representative.order_number))
        else '1:'
      end desc,
      case
        when nullif(btrim(representative.order_number), '') is not null
          then 'order:' || representative.order_number
        else 'item:' || representative.id
      end desc,
      representative.id desc
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ),
  searched_eligible_group_keys as (
    -- Non-empty substring search retains the measured workspace-wide search branch.
    select
      case
        when nullif(btrim(orders.order_number), '') is not null
          then 'order:' || orders.order_number
        else 'item:' || orders.id
      end as group_id,
      to_char(max(orders.created_at) at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
        || ':' || max(
          case
            when nullif(btrim(orders.order_number), '') ~ '^[0-9]+$'
              then '3:' || lpad(btrim(orders.order_number), 64, '0')
            when nullif(btrim(orders.order_number), '') is not null
              then '2:' || lower(btrim(orders.order_number))
            else '1:'
          end
        ) as sort_key
    from public.order_items orders
    left join public.designs designs
      on designs.order_item_id = orders.id
     and designs.workspace_id = p_workspace_id
    cross join search_params params
    where orders.workspace_id = p_workspace_id
      and params.escaped_search_term <> ''
    group by
      case
        when nullif(btrim(orders.order_number), '') is not null
          then 'order:' || orders.order_number
        else 'item:' || orders.id
      end,
      params.escaped_search_term
    having
      -- 2. Apply lifecycle and active-batch predicates to whole groups.
      (
        p_status_filter = 'all'
        or (p_status_filter = 'complete' and bool_and(orders.status = 'complete'))
        or (p_status_filter = 'skipped' and bool_and(orders.status = 'skipped'))
        -- Legacy archived rows are never considered open.
        or (p_status_filter = 'open' and bool_or(orders.status = 'open'))
      )
      and (
        p_batch_filter = 'all'
        or (
          p_batch_filter = 'inBatch'
          and bool_or(exists (
            select 1
            from public.batch_items active_membership
            where p_active_batch_id is not null
              and active_membership.workspace_id = p_workspace_id
              and active_membership.batch_id = p_active_batch_id
              and active_membership.order_item_id = orders.id
              and active_membership.status = 'active'
          ))
        )
        or (
          p_batch_filter = 'notInBatch'
          and not bool_or(exists (
            select 1
            from public.batch_items active_membership
            where p_active_batch_id is not null
              and active_membership.workspace_id = p_workspace_id
              and active_membership.batch_id = p_active_batch_id
              and active_membership.order_item_id = orders.id
              and active_membership.status = 'active'
          ))
        )
      )
      -- A match in any item/design/line includes the complete order group.
      and bool_or(
          lower(coalesce(orders.order_number, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.buyer_name, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.listing_id, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.source_json ->> 'listingTitle', '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.source_json ->> 'title', '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.transaction_id, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(orders.imported_color, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or lower(coalesce(designs.design_text, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          or exists (
            select 1
            from public.design_lines lines
            where lines.design_id = designs.id
              and lower(coalesce(lines.text, '')) like '%' || params.escaped_search_term || '%' escape E'\\'
          )
      )
  ),
  searched_page_group_keys as (
    select candidate.group_id, candidate.sort_key
    from searched_eligible_group_keys candidate
    -- Descending keyset pagination runs before JSON aggregation/hydration.
    where p_cursor_sort_key is null
       or p_cursor_group_id is null
       or (candidate.sort_key, candidate.group_id) < (p_cursor_sort_key, p_cursor_group_id)
    order by candidate.sort_key desc, candidate.group_id desc
    -- The extra key is used only to derive hasMore.
    limit least(greatest(coalesce(p_requested_limit, 50), 1), 50) + 1
  ),
  page_group_keys as materialized (
    select empty_page.group_id, empty_page.sort_key
    from empty_page_group_keys empty_page
    union all
    select searched_page.group_id, searched_page.sort_key
    from searched_page_group_keys searched_page
  ),
  hydrated_items as (
    -- Hydrate only the selected keys through the group-member index.
    select
      page.group_id,
      page.sort_key,
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
      exists (
        select 1
        from public.batch_items active_membership
        where p_active_batch_id is not null
          and active_membership.workspace_id = p_workspace_id
          and active_membership.batch_id = p_active_batch_id
          and active_membership.order_item_id = orders.id
          and active_membership.status = 'active'
      ) as is_in_active_batch
    from page_group_keys page
    join public.order_items orders
      on orders.workspace_id = p_workspace_id
     and (
       case
         when nullif(btrim(orders.order_number), '') is not null
           then 'order:' || orders.order_number
         else 'item:' || orders.id
       end
     ) = page.group_id
    left join public.designs designs
      on designs.order_item_id = orders.id
     and designs.workspace_id = p_workspace_id
  ),
  grouped as (
    select
      candidate.group_id,
      candidate.sort_key,
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
    from hydrated_items candidate
    group by candidate.group_id, candidate.sort_key
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
  -- One newest-first key handles numeric, nonnumeric/manual, and null order numbers.
  order by grouped.sort_key desc, grouped.group_id desc
$$;

revoke all on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.list_workspace_order_summaries(uuid, uuid, text, text, text, integer, text, text)
  to service_role;
