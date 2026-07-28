-- Amazon clipboard imports created before marketplace propagation was fixed
-- retained Amazon order and ASIN identifiers but omitted the marketplace key.
-- Restrict the repair to rows carrying both deterministic Amazon identifiers.
update public.order_items
set source_json = jsonb_set(
  source_json,
  '{marketplace}',
  '"amazon"'::jsonb,
  true
)
where order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$'
  and listing_id ~ '^B0[A-Z0-9]{8}$'
  and coalesce(source_json->>'marketplace', '') = '';
