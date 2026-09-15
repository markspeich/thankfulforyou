-- Reopening completed orders uses the existing open/complete/skipped status
-- values and does not require a data backfill or a constraint change.
-- Record the lifecycle contract alongside the database-dependent API change.
comment on column public.order_items.status is
  'Order lifecycle: open, skipped, or complete. Reopening skipped or complete items sets open without creating or reactivating production batch membership.';
