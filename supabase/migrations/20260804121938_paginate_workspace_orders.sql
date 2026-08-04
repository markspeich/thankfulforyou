create index if not exists order_items_workspace_group_cursor_idx
  on public.order_items (
    workspace_id,
    (case when nullif(btrim(order_number), '') is null then 1 else 0 end),
    (coalesce(lower(nullif(btrim(order_number), '')), '')),
    (case
      when nullif(btrim(order_number), '') is null then 'item:' || id
      else 'order:' || order_number
    end)
  );

create or replace function public.list_workspace_order_summaries_page(
  p_workspace_id uuid,
  p_status text default 'open',
  p_search text default '',
  p_active_batch_id uuid default null,
  p_limit integer default 50,
  p_after_group_rank integer default null,
  p_after_order_key text default null,
  p_after_group_id text default null
)
returns table (
  item_id text,
  item_status text,
  order_number text,
  buyer_name text,
  listing_id text,
  transaction_id text,
  imported_color text,
  ship_by_date date,
  quantity integer,
  source_json jsonb,
  item_revision bigint,
  item_updated_at timestamptz,
  item_updated_by uuid,
  design_id uuid,
  design_text text,
  design_production_status text,
  is_in_active_batch boolean,
  group_rank integer,
  order_key text,
  group_id text,
  has_more boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible_items as not materialized (
    select
      item.*,
      case when nullif(btrim(item.order_number), '') is null then 1 else 0 end as derived_group_rank,
      coalesce(lower(nullif(btrim(item.order_number), '')), '') as derived_order_key,
      case
        when nullif(btrim(item.order_number), '') is null then 'item:' || item.id
        else 'order:' || item.order_number
      end as derived_group_id
    from public.order_items as item
    where item.workspace_id = p_workspace_id
      and case
        when p_status = 'complete' then item.status = 'complete'
        when p_status = 'skipped' then item.status = 'skipped'
        when p_status = 'all' then true
        else item.status not in ('complete', 'skipped', 'archived')
      end
  ),
  matched_groups as (
    select distinct
      eligible.derived_group_rank as group_rank,
      eligible.derived_order_key as order_key,
      eligible.derived_group_id as group_id
    from eligible_items as eligible
    where nullif(btrim(p_search), '') is null

    union all

    select distinct
      eligible.derived_group_rank as group_rank,
      eligible.derived_order_key as order_key,
      eligible.derived_group_id as group_id
    from eligible_items as eligible
    left join public.designs as searchable_design
      on searchable_design.workspace_id = p_workspace_id
     and searchable_design.order_item_id = eligible.id
    where nullif(btrim(p_search), '') is not null
      and position(
        lower(btrim(p_search)) in lower(concat_ws(
          ' ',
          eligible.order_number,
          eligible.buyer_name,
          eligible.listing_id,
          eligible.transaction_id,
          eligible.imported_color,
          searchable_design.design_text
        ))
      ) > 0
  ),
  candidate_groups as (
    select matched.group_rank, matched.order_key, matched.group_id
    from matched_groups as matched
    where p_after_group_rank is null
      or (matched.group_rank, matched.order_key, matched.group_id)
        > (p_after_group_rank, coalesce(p_after_order_key, ''), coalesce(p_after_group_id, ''))
    order by group_rank, order_key, group_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50) + 1
  ),
  page_groups as (
    select candidate.group_rank, candidate.order_key, candidate.group_id
    from candidate_groups as candidate
    order by candidate.group_rank, candidate.order_key, candidate.group_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  ),
  page_state as (
    select count(*) > least(greatest(coalesce(p_limit, 50), 1), 50) as has_more
    from candidate_groups
  ),
  page_items as (
    select page_group.group_rank, page_group.order_key, page_group.group_id, item.*
    from page_groups as page_group
    join eligible_items as item
      on page_group.group_rank = 0
     and item.order_number = substr(page_group.group_id, length('order:') + 1)

    union all

    select page_group.group_rank, page_group.order_key, page_group.group_id, item.*
    from page_groups as page_group
    join eligible_items as item
      on page_group.group_rank = 1
     and item.id = substr(page_group.group_id, length('item:') + 1)
  )
  select
    item.id as item_id,
    item.status as item_status,
    item.order_number,
    item.buyer_name,
    item.listing_id,
    item.transaction_id,
    item.imported_color,
    item.ship_by_date,
    item.quantity,
    item.source_json,
    item.revision as item_revision,
    item.updated_at as item_updated_at,
    item.updated_by as item_updated_by,
    design.id as design_id,
    coalesce(design.design_text, '') as design_text,
    design.production_status as design_production_status,
    exists (
      select 1
      from public.batch_items as batch_item
      where batch_item.workspace_id = p_workspace_id
        and batch_item.batch_id = p_active_batch_id
        and batch_item.order_item_id = item.id
        and batch_item.status = 'active'
    ) as is_in_active_batch,
    item.group_rank,
    item.order_key,
    item.group_id,
    page_state.has_more
  from page_items as item
  left join public.designs as design
    on design.workspace_id = p_workspace_id
   and design.order_item_id = item.id
  cross join page_state
  order by item.group_rank, item.order_key, item.group_id, item.created_at, item.id;
$$;

revoke all on function public.list_workspace_order_summaries_page(
  uuid, text, text, uuid, integer, integer, text, text
) from public, anon, authenticated;

grant execute on function public.list_workspace_order_summaries_page(
  uuid, text, text, uuid, integer, integer, text, text
) to service_role;
