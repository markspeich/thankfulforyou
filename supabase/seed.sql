insert into public.production_batches (
  id,
  workspace_id,
  name,
  status,
  active_order_item_id
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Primary Batch',
  'active',
  null
)
on conflict (id) do update
set workspace_id = excluded.workspace_id,
    name = excluded.name,
    status = excluded.status,
    active_order_item_id = excluded.active_order_item_id;
