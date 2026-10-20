-- Operator-entered production notes belong to the saved design, independently of geometry caches.
alter table public.designs
  add column custom_notes text not null default '';
