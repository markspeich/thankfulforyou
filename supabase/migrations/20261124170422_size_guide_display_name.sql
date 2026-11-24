-- Optional operator-facing name for size guides. The existing `name` column
-- keeps the generated dimension label (for example "2.2 x 1.5").
alter table public.size_guides
  add column if not exists display_name text;

alter table public.size_guides
  drop constraint if exists size_guides_display_name_length;

alter table public.size_guides
  add constraint size_guides_display_name_length
  check (display_name is null or char_length(display_name) between 1 and 80);
