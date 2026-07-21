create or replace function public.add_order_items_to_production_batch(
  p_workspace_id uuid,
  p_user_id uuid,
  p_batch_id uuid,
  p_order_item_ids text[]
)
returns table(added_order_item_id text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_position integer;
begin
  if p_workspace_id is null or p_batch_id is null then
    return;
  end if;

  perform 1
  from public.production_batches
  where id = p_batch_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    return;
  end if;

  select coalesce(max(batch_position), -1) + 1
  into next_position
  from public.batch_items
  where workspace_id = p_workspace_id
    and batch_id = p_batch_id
    and status <> 'archived';

  return query
  with requested as (
    select requested_id, ordinal::integer
    from unnest(coalesce(p_order_item_ids, array[]::text[])) with ordinality as input(requested_id, ordinal)
    where requested_id is not null and btrim(requested_id) <> ''
  ),
  eligible as (
    select distinct on (orders.id)
      orders.id,
      requested.ordinal
    from requested
    join public.order_items orders
      on orders.id = requested.requested_id
     and orders.workspace_id = p_workspace_id
     and orders.status in ('open', 'complete')
    order by orders.id, requested.ordinal
  ),
  positioned as (
    select
      eligible.id,
      next_position + row_number() over (order by eligible.ordinal, eligible.id) - 1 as batch_position
    from eligible
  ),
  inserted as (
    insert into public.batch_items (
      workspace_id,
      batch_id,
      order_item_id,
      batch_position,
      status,
      added_by
    )
    select
      p_workspace_id,
      p_batch_id,
      positioned.id,
      positioned.batch_position,
      'active',
      p_user_id
    from positioned
    on conflict (batch_id, order_item_id) do update
      set status = 'active',
          batch_position = excluded.batch_position,
          added_by = excluded.added_by,
          added_at = now()
      where public.batch_items.status = 'archived'
    returning public.batch_items.order_item_id
  )
  select inserted.order_item_id as added_order_item_id
  from inserted;
end;
$$;

revoke all on function public.add_order_items_to_production_batch(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.add_order_items_to_production_batch(uuid, uuid, uuid, text[]) to service_role;

create or replace function public.complete_production_batch_fast(
  p_workspace_id uuid,
  p_user_id uuid,
  p_batch_id uuid
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  status text,
  revision bigint,
  updated_at timestamptz,
  updated_by uuid,
  completed_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_at timestamptz := now();
begin
  perform 1
  from public.production_batches
  where public.production_batches.id = p_batch_id
    and public.production_batches.workspace_id = p_workspace_id
  for update;

  if not found then
    return;
  end if;

  return query
  with active_items as (
    select batch.order_item_id
    from public.batch_items batch
    where batch.workspace_id = p_workspace_id
      and batch.batch_id = p_batch_id
      and batch.status <> 'archived'
  ),
  completed as (
    update public.order_items orders
    set status = 'complete',
        updated_at = saved_at,
        updated_by = p_user_id
    where orders.workspace_id = p_workspace_id
      and orders.id in (select active_items.order_item_id from active_items)
    returning orders.id
  ),
  removed as (
    delete from public.batch_items batch
    where batch.workspace_id = p_workspace_id
      and batch.batch_id = p_batch_id
      and batch.order_item_id in (select active_items.order_item_id from active_items)
    returning batch.order_item_id
  ),
  updated_batch as (
    update public.production_batches batch
    set active_order_item_id = null,
        updated_at = saved_at,
        updated_by = p_user_id
    where batch.id = p_batch_id
      and batch.workspace_id = p_workspace_id
    returning batch.id, batch.workspace_id, batch.name, batch.status, batch.revision, batch.updated_at, batch.updated_by
  )
  select
    updated_batch.id,
    updated_batch.workspace_id,
    updated_batch.name,
    updated_batch.status,
    updated_batch.revision,
    updated_batch.updated_at,
    updated_batch.updated_by,
    (select count(*) from completed)::bigint
  from updated_batch;
end;
$$;

revoke all on function public.complete_production_batch_fast(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_production_batch_fast(uuid, uuid, uuid) to service_role;
