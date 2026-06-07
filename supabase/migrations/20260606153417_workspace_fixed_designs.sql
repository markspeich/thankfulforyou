insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-fixed-designs',
  'workspace-fixed-designs',
  true,
  5242880,
  array['image/svg+xml', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.fixed_designs (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  storage_bucket text not null default 'workspace-fixed-designs',
  storage_path text not null,
  public_url text,
  file_name text not null,
  version integer not null default 1 check (version > 0),
  metadata_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fixed_designs_id_workspace_id_key'
      and conrelid = 'public.fixed_designs'::regclass
  ) then
    alter table public.fixed_designs
      add constraint fixed_designs_id_workspace_id_key unique (id, workspace_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'designs_id_workspace_id_key'
      and conrelid = 'public.designs'::regclass
  ) then
    alter table public.designs
      add constraint designs_id_workspace_id_key unique (id, workspace_id);
  end if;
end $$;

alter table public.design_lines
  add column if not exists workspace_id uuid,
  add column if not exists item_kind text not null default 'text'
    check (item_kind in ('text', 'fixed_svg')),
  add column if not exists fixed_design_id text references public.fixed_designs(id) on delete set null,
  add column if not exists fixed_design_version integer,
  add column if not exists svg_size_mm numeric(8, 3) not null default 32 check (svg_size_mm > 0),
  add column if not exists offset_y_mm numeric(8, 3) not null default 0;

update public.design_lines lines
set workspace_id = designs.workspace_id
from public.designs designs
where lines.design_id = designs.id
  and lines.workspace_id is null;

alter table public.design_lines
  alter column workspace_id set not null;

create or replace function public.set_design_line_workspace_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_workspace_id uuid;
begin
  select designs.workspace_id
  into parent_workspace_id
  from public.designs
  where designs.id = new.design_id;

  if parent_workspace_id is null then
    return new;
  end if;

  new.workspace_id := parent_workspace_id;
  return new;
end;
$$;

drop trigger if exists design_lines_set_workspace_id on public.design_lines;
create trigger design_lines_set_workspace_id
before insert or update of design_id, fixed_design_id on public.design_lines
for each row
execute function public.set_design_line_workspace_id();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'design_lines_design_workspace_fkey'
      and conrelid = 'public.design_lines'::regclass
  ) then
    alter table public.design_lines
      add constraint design_lines_design_workspace_fkey
      foreign key (design_id, workspace_id)
      references public.designs (id, workspace_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'design_lines_fixed_design_workspace_fkey'
      and conrelid = 'public.design_lines'::regclass
  ) then
    alter table public.design_lines
      add constraint design_lines_fixed_design_workspace_fkey
      foreign key (fixed_design_id, workspace_id)
      references public.fixed_designs (id, workspace_id)
      on delete set null (fixed_design_id);
  end if;
end $$;

alter table public.fixed_designs
  drop constraint if exists fixed_designs_workspace_id_display_name_key;

create unique index if not exists fixed_designs_workspace_active_name_uidx
  on public.fixed_designs (workspace_id, display_name)
  where deleted_at is null;

create index if not exists design_lines_fixed_design_id_idx
  on public.design_lines (fixed_design_id)
  where fixed_design_id is not null;

alter table public.fixed_designs enable row level security;

grant select, insert, update, delete on public.fixed_designs to authenticated;
grant all on public.fixed_designs to service_role;

drop policy if exists fixed_designs_member_all on public.fixed_designs;
create policy fixed_designs_member_all
on public.fixed_designs
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = fixed_designs.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = fixed_designs.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists workspace_fixed_designs_public_read on storage.objects;
create policy workspace_fixed_designs_public_read
on storage.objects
for select
to public
using (bucket_id = 'workspace-fixed-designs');

drop policy if exists workspace_fixed_designs_member_write on storage.objects;
create policy workspace_fixed_designs_member_write
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workspace-fixed-designs'
  and exists (
    select 1
    from public.workspace_memberships memberships
    where memberships.user_id = (select auth.uid())
      and name like 'workspaces/' || memberships.workspace_id::text || '/fixed-designs/%'
  )
);
