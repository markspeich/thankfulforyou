alter table public.order_items
  add column if not exists etsy_import_diagnostics jsonb;
