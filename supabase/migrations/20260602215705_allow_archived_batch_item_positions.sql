alter table public.batch_items
  drop constraint if exists batch_items_batch_id_batch_position_key;

create unique index if not exists batch_items_active_batch_position_key
  on public.batch_items (batch_id, batch_position)
  where status <> 'archived';
