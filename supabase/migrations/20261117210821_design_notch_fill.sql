-- Temporary per-design backing option: fill deep notches where neighboring
-- glyph backing offsets barely meet. Defaults on; operators can turn it off
-- for a design if the fill causes a production problem.
alter table public.designs
  add column notch_fill boolean not null default true;
