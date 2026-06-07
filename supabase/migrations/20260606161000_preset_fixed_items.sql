alter table public.presets
  add column if not exists fixed_items_json jsonb not null default '[]'::jsonb;
