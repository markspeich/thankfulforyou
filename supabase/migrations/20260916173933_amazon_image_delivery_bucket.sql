-- Private image delivery copies. Only the server service role writes/signs objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('amazon-listing-delivery', 'amazon-listing-delivery', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
