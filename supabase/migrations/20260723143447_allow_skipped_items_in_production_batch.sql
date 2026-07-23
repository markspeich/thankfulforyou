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
  saved_at timestamptz := now();
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
    and batch_id = p_batch_id;

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
     and orders.status in ('open', 'complete', 'skipped')
    where not exists (
      select 1
      from public.batch_items active_batch
      where active_batch.workspace_id = p_workspace_id
        and active_batch.batch_id = p_batch_id
        and active_batch.order_item_id = orders.id
        and active_batch.status = 'active'
    )
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
          added_at = saved_at
      where public.batch_items.status <> 'active'
    returning public.batch_items.order_item_id
  ),
  reopened as (
    update public.order_items orders
    set status = 'open',
        updated_at = saved_at,
        updated_by = p_user_id
    where orders.workspace_id = p_workspace_id
      and orders.status = 'skipped'
      and orders.id in (select inserted.order_item_id from inserted)
    returning orders.id
  )
  select inserted.order_item_id as added_order_item_id
  from inserted;
end;
$$;

revoke all on function public.add_order_items_to_production_batch(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.add_order_items_to_production_batch(uuid, uuid, uuid, text[]) to service_role;
