alter table public.batch_items
  drop constraint if exists batch_items_status_check;

update public.batch_items
set status = 'archived'
where status = 'removed';

alter table public.batch_items
  add constraint batch_items_status_check
  check (status in ('active', 'skipped', 'completed', 'archived'));
