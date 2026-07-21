alter table public.order_items
  add column if not exists ship_by_date date;
