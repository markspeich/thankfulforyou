alter table public.presets
  add column if not exists fixed_designs_json jsonb not null default '[]'::jsonb;
