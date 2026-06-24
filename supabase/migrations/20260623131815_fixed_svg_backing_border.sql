alter table public.design_lines
  add column if not exists fixed_svg_backing_border boolean not null default false;
