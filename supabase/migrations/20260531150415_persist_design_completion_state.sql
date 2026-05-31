alter table public.designs
  add column if not exists cached_build_json jsonb,
  add column if not exists previous_completed_build_json jsonb,
  add column if not exists saved_settings_signature text,
  add column if not exists completed_settings_signature text,
  add column if not exists analysis_badge_json jsonb,
  add column if not exists pending_analysis_signature text;
