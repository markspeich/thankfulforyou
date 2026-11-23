-- Raised-text acrylic color captured from the listing (for example an Etsy
-- "Text Color" variation). Imports store the resolved value: the listing value
-- when present, otherwise Black for white backings and White for everything else.
-- Null means the order predates text color capture; readers derive the default
-- from imported_color, and a later re-import fills it in.
alter table public.order_items add column if not exists text_color text;
