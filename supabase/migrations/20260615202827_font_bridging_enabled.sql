alter table public.fonts
  add column if not exists bridging_enabled boolean not null default true;

update public.fonts
set bridging_enabled = true
where bridging_enabled is distinct from true;
