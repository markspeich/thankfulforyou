alter table public.order_items
  drop constraint if exists order_items_status_check;

alter table public.order_items
  add constraint order_items_status_check
  check (status in ('open', 'skipped', 'complete'));
