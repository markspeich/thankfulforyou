-- Selected production actions preserve designs and unchecked batch membership.
create or replace function public.mutate_selected_production_batch_items(
  p_workspace_id uuid,
  p_user_id uuid,
  p_batch_id uuid,
  p_operation text,
  p_order_item_ids text[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_count integer;
  current_active_id text;
  saved_at timestamptz := now();
begin
  if p_operation is null or p_operation not in ('complete', 'skip', 'remove')
     or coalesce(cardinality(p_order_item_ids), 0) = 0
     or exists (select 1 from unnest(p_order_item_ids) selected(id) where id is null or btrim(id) = '')
     or cardinality(p_order_item_ids) <> (select count(distinct id) from unnest(p_order_item_ids) selected(id)) then
    raise exception using errcode = '22023', message = 'Invalid selected item operation';
  end if;

  select batch.active_order_item_id into current_active_id
  from public.production_batches batch
  where batch.id = p_batch_id and batch.workspace_id = p_workspace_id
  for update;
  if not found then return false; end if;

  -- Lock both memberships and their order records before validating any writes.
  perform 1 from public.batch_items member
  join public.order_items orders on orders.id = member.order_item_id and orders.workspace_id = member.workspace_id
  where member.batch_id = p_batch_id and member.workspace_id = p_workspace_id
    and member.status = 'active' and member.order_item_id = any(p_order_item_ids)
  order by member.order_item_id
  for update of member, orders;
  get diagnostics selected_count = row_count;
  if selected_count <> cardinality(p_order_item_ids) then
    raise exception using errcode = '40001', message = 'Selected batch membership changed';
  end if;

  if p_operation in ('complete', 'skip') then
    update public.order_items orders
    set status = case when p_operation = 'complete' then 'complete' else 'skipped' end,
        revision = coalesce(orders.revision, 0) + 1,
        updated_at = saved_at, updated_by = p_user_id
    where orders.workspace_id = p_workspace_id and orders.id = any(p_order_item_ids)
      and (p_operation = 'complete' or orders.status = 'open');
  end if;

  delete from public.batch_items member
  where member.batch_id = p_batch_id and member.workspace_id = p_workspace_id
    and member.status = 'active' and member.order_item_id = any(p_order_item_ids);

  if current_active_id = any(p_order_item_ids) or not exists (
    select 1 from public.batch_items member
    where member.batch_id = p_batch_id and member.workspace_id = p_workspace_id
      and member.status = 'active' and member.order_item_id = current_active_id
  ) then
    select member.order_item_id into current_active_id from public.batch_items member
    where member.batch_id = p_batch_id and member.workspace_id = p_workspace_id and member.status = 'active'
    order by member.batch_position, member.order_item_id limit 1;
  end if;

  update public.production_batches batch
  set active_order_item_id = current_active_id,
      revision = coalesce(batch.revision, 0) + 1,
      updated_at = saved_at, updated_by = p_user_id
  where batch.id = p_batch_id and batch.workspace_id = p_workspace_id;
  return true;
end;
$$;

revoke all on function public.mutate_selected_production_batch_items(uuid, uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.mutate_selected_production_batch_items(uuid, uuid, uuid, text, text[]) to service_role;
