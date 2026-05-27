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

create table if not exists public.design_queues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text,
  status text not null default 'active' check (status in ('active', 'archived')),
  queue_json jsonb not null default '{}'::jsonb,
  active_order_id text,
  orders_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists design_queues_workspace_updated_idx
  on public.design_queues (workspace_id, updated_at desc);

create index if not exists design_queues_updated_by_idx
  on public.design_queues (updated_by);

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.design_queues enable row level security;

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

drop policy if exists design_queues_select_member on public.design_queues;
create policy design_queues_select_member
on public.design_queues
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships as memberships
    where memberships.workspace_id = design_queues.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

grant select on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;
grant select on public.design_queues to authenticated;

grant select on public.workspaces to service_role;
grant select on public.workspace_memberships to service_role;
grant select, update on public.design_queues to service_role;
grant select on auth.users to service_role;

create or replace function public.save_design_queue_snapshot(
  p_queue_id uuid,
  p_workspace_id uuid,
  p_active_order_id text,
  p_orders_json jsonb,
  p_revisions_json jsonb,
  p_updated_by uuid
)
returns table(queue_json jsonb, active_order_id text, orders_json jsonb)
language plpgsql
set search_path to 'public', 'auth', 'pg_catalog'
as $function$
declare
  v_queue public.design_queues%rowtype;
  v_now timestamptz := now();
  v_updated_by_email text := null;
  v_conflict jsonb := null;
  v_canonical_orders jsonb := '[]'::jsonb;
begin
  if coalesce(jsonb_typeof(p_orders_json), 'null') <> 'array' then
    raise exception 'p_orders_json must be a JSON array';
  end if;

  if coalesce(jsonb_typeof(p_revisions_json), 'null') <> 'array' then
    raise exception 'p_revisions_json must be a JSON array';
  end if;

  if p_updated_by is not null then
    select users.email
    into v_updated_by_email
    from auth.users as users
    where users.id = p_updated_by;
  end if;

  select *
  into v_queue
  from public.design_queues
  where id = p_queue_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Shared queue not found.';
  end if;

  with expected_revisions as (
    select
      trim(coalesce(revision_item.value->>'id', '')) as order_id,
      coalesce((revision_item.value->>'revision')::integer, 0) as expected_revision
    from jsonb_array_elements(coalesce(p_revisions_json, '[]'::jsonb)) as revision_item(value)
    where trim(coalesce(revision_item.value->>'id', '')) <> ''
  ),
  current_revisions as (
    select
      trim(coalesce(order_item.value->>'id', '')) as order_id,
      coalesce((order_item.value->>'revision')::integer, 0) as current_revision,
      order_item.value as order_json
    from jsonb_array_elements(coalesce(v_queue.orders_json, '[]'::jsonb)) as order_item(value)
    where trim(coalesce(order_item.value->>'id', '')) <> ''
  )
  select jsonb_build_object(
    'orderId', current_revisions.order_id,
    'revision', current_revisions.current_revision,
    'updatedAt', current_revisions.order_json->>'updatedAt',
    'updatedBy', current_revisions.order_json->'updatedBy'
  )
  into v_conflict
  from current_revisions
  join expected_revisions using (order_id)
  where current_revisions.current_revision <> expected_revisions.expected_revision
  limit 1;

  if v_conflict is not null then
    raise exception 'Revision conflict' using detail = v_conflict::text;
  end if;

  with incoming_orders as (
    select
      incoming.value as order_json,
      incoming.ordinality as order_position
    from jsonb_array_elements(coalesce(p_orders_json, '[]'::jsonb)) with ordinality as incoming(value, ordinality)
  ),
  existing_orders as (
    select existing.value as order_json
    from jsonb_array_elements(coalesce(v_queue.orders_json, '[]'::jsonb)) as existing(value)
  ),
  merged_orders as (
    select
      incoming_orders.order_position,
      incoming_orders.order_json,
      existing_orders.order_json as previous_order_json,
      trim(coalesce(incoming_orders.order_json->>'id', '')) as order_id
    from incoming_orders
    left join existing_orders
      on trim(coalesce(existing_orders.order_json->>'id', '')) = trim(coalesce(incoming_orders.order_json->>'id', ''))
  ),
  stamped_orders as (
    select
      order_position,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            order_json,
            '{revision}',
            to_jsonb(
              case
                when order_id = '' then 1
                when previous_order_json is null then greatest(coalesce((order_json->>'revision')::integer, 0), 0) + 1
                when coalesce(order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
                  is distinct from coalesce(previous_order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
                  then greatest(
                    coalesce((previous_order_json->>'revision')::integer, 0),
                    coalesce((order_json->>'revision')::integer, 0)
                  ) + 1
                else greatest(
                  coalesce((previous_order_json->>'revision')::integer, 0),
                  coalesce((order_json->>'revision')::integer, 0)
                )
              end
            ),
            true
          ),
          '{updatedAt}',
          to_jsonb(
            case
              when previous_order_json is null
                or coalesce(order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
                   is distinct from coalesce(previous_order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
                then to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              else coalesce(previous_order_json->>'updatedAt', order_json->>'updatedAt')
            end
          ),
          true
        ),
        '{updatedBy}',
        case
          when previous_order_json is null
            or coalesce(order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
               is distinct from coalesce(previous_order_json - 'revision' - 'updatedAt' - 'updatedBy', '{}'::jsonb)
            then case
              when p_updated_by is null then 'null'::jsonb
              else jsonb_build_object('id', p_updated_by, 'email', v_updated_by_email)
            end
          else coalesce(previous_order_json->'updatedBy', order_json->'updatedBy', 'null'::jsonb)
        end,
        true
      ) as stamped_order_json
    from merged_orders
  )
  select coalesce(jsonb_agg(stamped_order_json order by order_position), '[]'::jsonb)
  into v_canonical_orders
  from stamped_orders;

  update public.design_queues
  set active_order_id = p_active_order_id,
      orders_json = v_canonical_orders,
      updated_at = v_now,
      updated_by = p_updated_by,
      queue_json = jsonb_build_object(
        'id', id,
        'workspaceId', workspace_id,
        'name', name,
        'status', status,
        'updatedAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedBy', case
          when p_updated_by is null then null
          else jsonb_build_object('id', p_updated_by, 'email', v_updated_by_email)
        end
      )
  where id = p_queue_id
    and workspace_id = p_workspace_id
  returning design_queues.queue_json, design_queues.active_order_id, design_queues.orders_json
  into queue_json, active_order_id, orders_json;

  return next;
end;
$function$;

revoke execute on function public.save_design_queue_snapshot(uuid, uuid, text, jsonb, jsonb, uuid) from public;
revoke execute on function public.save_design_queue_snapshot(uuid, uuid, text, jsonb, jsonb, uuid) from anon;
revoke execute on function public.save_design_queue_snapshot(uuid, uuid, text, jsonb, jsonb, uuid) from authenticated;
grant execute on function public.save_design_queue_snapshot(uuid, uuid, text, jsonb, jsonb, uuid) to service_role;

insert into public.workspaces (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Primary Workspace')
on conflict (id) do update
set name = excluded.name;

insert into public.design_queues (
  id,
  workspace_id,
  name,
  status,
  queue_json,
  active_order_id,
  orders_json,
  updated_by
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Primary Queue',
  'active',
  jsonb_build_object(
    'id', '22222222-2222-4222-8222-222222222222',
    'workspaceId', '11111111-1111-4111-8111-111111111111',
    'name', 'Primary Queue',
    'status', 'active',
    'updatedAt', null,
    'updatedBy', null
  ),
  null,
  '[]'::jsonb,
  null
)
on conflict (id) do update
set workspace_id = excluded.workspace_id,
    name = excluded.name,
    status = excluded.status;
