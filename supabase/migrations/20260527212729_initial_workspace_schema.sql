create extension if not exists pgcrypto with schema extensions;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_memberships_user_id_idx
  on public.workspace_memberships (user_id);

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
on public.workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships as memberships
    where memberships.workspace_id = workspaces.id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists workspace_memberships_select_self on public.workspace_memberships;
create policy workspace_memberships_select_self
on public.workspace_memberships
for select
to authenticated
using (user_id = (select auth.uid()));

grant select on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;

grant select on public.workspaces to service_role;
grant select on public.workspace_memberships to service_role;
grant select on auth.users to service_role;

insert into public.workspaces (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Primary Workspace')
on conflict (id) do update
set name = excluded.name;
