insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-fonts',
  'workspace-fonts',
  true,
  5242880,
  array['font/otf', 'font/ttf', 'font/woff', 'font/woff2', 'application/font-sfnt', 'application/octet-stream']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.fonts (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  family_name text not null,
  storage_bucket text not null default 'workspace-fonts',
  storage_path text not null,
  public_url text,
  file_name text not null,
  file_format text not null check (file_format in ('otf', 'ttf', 'woff', 'woff2')),
  version integer not null default 1 check (version > 0),
  is_builtin boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, display_name)
);

create index if not exists fonts_workspace_active_name_idx
  on public.fonts (workspace_id, display_name)
  where deleted_at is null;

alter table public.fonts enable row level security;

grant select, insert, update, delete on public.fonts to authenticated;
grant all on public.fonts to service_role;

drop policy if exists fonts_member_all on public.fonts;
create policy fonts_member_all
on public.fonts
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = fonts.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = fonts.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists workspace_fonts_public_read on storage.objects;
create policy workspace_fonts_public_read
on storage.objects
for select
to public
using (bucket_id = 'workspace-fonts');

drop policy if exists workspace_fonts_member_write on storage.objects;
create policy workspace_fonts_member_write
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workspace-fonts'
  and exists (
    select 1
    from public.workspace_memberships memberships
    where memberships.user_id = (select auth.uid())
      and name like 'workspaces/' || memberships.workspace_id::text || '/fonts/%'
  )
);
