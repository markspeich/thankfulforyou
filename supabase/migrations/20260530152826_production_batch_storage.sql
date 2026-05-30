create extension if not exists pgcrypto with schema extensions;

create table if not exists public.size_guides (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  max_width_in numeric(8, 3) not null check (max_width_in > 0),
  max_height_in numeric(8, 3) not null check (max_height_in > 0),
  min_width_in numeric(8, 3) not null check (min_width_in > 0),
  min_height_in numeric(8, 3) not null check (min_height_in > 0),
  circle_diameter_in numeric(8, 3) check (circle_diameter_in is null or circle_diameter_in > 0),
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.presets (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  default_size_guide_id text references public.size_guides(id) on delete set null,
  backing_border_mm numeric(8, 3) not null default 3.1 check (backing_border_mm >= 0),
  weld_exported_design boolean not null default true,
  global_horizontal_scale numeric(8, 4) not null default 1 check (global_horizontal_scale > 0),
  global_vertical_scale numeric(8, 4) not null default 1 check (global_vertical_scale > 0),
  is_builtin boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create unique index if not exists presets_one_default_per_workspace_idx
  on public.presets (workspace_id)
  where is_default;

create table if not exists public.preset_line_rules (
  id uuid primary key default gen_random_uuid(),
  preset_id text not null references public.presets(id) on delete cascade,
  rule_type text not null check (rule_type in ('default', 'first', 'remaining', 'index')),
  line_index integer check (line_index is null or line_index >= 0),
  font_id text,
  letter_bridge_mm numeric(8, 3),
  line_bridge_mm numeric(8, 3),
  offset_x_mm numeric(8, 3),
  text_height_mm numeric(8, 3),
  horizontal_scale numeric(8, 4),
  vertical_scale numeric(8, 4),
  lock_text_height boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (rule_type = 'index' and line_index is not null)
    or (rule_type <> 'index' and line_index is null)
  )
);

create unique index if not exists preset_line_rules_single_default_idx
  on public.preset_line_rules (preset_id, rule_type)
  where rule_type <> 'index';

create unique index if not exists preset_line_rules_index_idx
  on public.preset_line_rules (preset_id, line_index)
  where rule_type = 'index';

create table if not exists public.preset_listing_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  preset_id text not null references public.presets(id) on delete cascade,
  listing_id text not null,
  name text,
  line_overrides_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, listing_id)
);

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text,
  status text not null default 'active' check (status in ('active', 'producing', 'completed', 'archived')),
  active_order_item_id text,
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_batches_workspace_updated_idx
  on public.production_batches (workspace_id, updated_at desc);

create table if not exists public.order_items (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'cancelled', 'produced', 'shipped', 'archived')),
  order_number text,
  buyer_name text,
  listing_id text,
  transaction_id text,
  imported_color text,
  quantity integer not null default 1 check (quantity > 0),
  source_json jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_items_workspace_order_number_idx
  on public.order_items (workspace_id, order_number);

create index if not exists order_items_workspace_listing_idx
  on public.order_items (workspace_id, listing_id);

create table if not exists public.batch_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  order_item_id text not null references public.order_items(id) on delete cascade,
  batch_position integer not null check (batch_position >= 0),
  status text not null default 'active' check (status in ('active', 'skipped', 'completed', 'removed')),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  unique (batch_id, order_item_id),
  unique (batch_id, batch_position)
);

create index if not exists batch_items_workspace_batch_idx
  on public.batch_items (workspace_id, batch_id, batch_position);

alter table public.production_batches
  drop constraint if exists production_batches_active_order_item_id_fkey;

alter table public.production_batches
  add constraint production_batches_active_order_item_id_fkey
  foreign key (active_order_item_id)
  references public.order_items(id)
  on delete set null
  deferrable initially deferred;

create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_item_id text not null references public.order_items(id) on delete cascade,
  design_text text not null default '',
  preset_id text references public.presets(id) on delete set null,
  size_guide_id text references public.size_guides(id) on delete set null,
  backing_border_mm numeric(8, 3) not null default 3.1 check (backing_border_mm >= 0),
  weld_exported_design boolean not null default true,
  global_horizontal_scale numeric(8, 4) not null default 1 check (global_horizontal_scale > 0),
  global_vertical_scale numeric(8, 4) not null default 1 check (global_vertical_scale > 0),
  production_status text not null default 'draft' check (production_status in ('draft', 'in_progress', 'saved', 'analysis_running', 'export_ready', 'exported')),
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id)
);

create index if not exists designs_workspace_status_idx
  on public.designs (workspace_id, production_status);

create table if not exists public.design_lines (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.designs(id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  text text not null default '',
  font_id text not null,
  letter_bridge_mm numeric(8, 3) not null default 0.5,
  line_bridge_mm numeric(8, 3) not null default 0.5,
  offset_x_mm numeric(8, 3) not null default 0,
  text_height_mm numeric(8, 3) not null default 34 check (text_height_mm > 0),
  horizontal_scale numeric(8, 4) not null default 1 check (horizontal_scale > 0),
  vertical_scale numeric(8, 4) not null default 1 check (vertical_scale > 0),
  lock_text_height boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (design_id, line_index)
);

create table if not exists public.design_analysis_cache (
  design_id uuid primary key references public.designs(id) on delete cascade,
  settings_signature text not null,
  layout_json jsonb not null default '{}'::jsonb,
  analysis_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.size_guides enable row level security;
alter table public.presets enable row level security;
alter table public.preset_line_rules enable row level security;
alter table public.preset_listing_assignments enable row level security;
alter table public.production_batches enable row level security;
alter table public.order_items enable row level security;
alter table public.batch_items enable row level security;
alter table public.designs enable row level security;
alter table public.design_lines enable row level security;
alter table public.design_analysis_cache enable row level security;

grant select, insert, update, delete on public.size_guides to authenticated;
grant select, insert, update, delete on public.presets to authenticated;
grant select, insert, update, delete on public.preset_line_rules to authenticated;
grant select, insert, update, delete on public.preset_listing_assignments to authenticated;
grant select, insert, update, delete on public.production_batches to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant select, insert, update, delete on public.batch_items to authenticated;
grant select, insert, update, delete on public.designs to authenticated;
grant select, insert, update, delete on public.design_lines to authenticated;
grant select, insert, update, delete on public.design_analysis_cache to authenticated;

grant all on public.size_guides to service_role;
grant all on public.presets to service_role;
grant all on public.preset_line_rules to service_role;
grant all on public.preset_listing_assignments to service_role;
grant all on public.production_batches to service_role;
grant all on public.order_items to service_role;
grant all on public.batch_items to service_role;
grant all on public.designs to service_role;
grant all on public.design_lines to service_role;
grant all on public.design_analysis_cache to service_role;

drop policy if exists size_guides_member_all on public.size_guides;
create policy size_guides_member_all
on public.size_guides
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = size_guides.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = size_guides.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists presets_member_all on public.presets;
create policy presets_member_all
on public.presets
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = presets.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = presets.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists preset_line_rules_member_all on public.preset_line_rules;
create policy preset_line_rules_member_all
on public.preset_line_rules
for all
to authenticated
using (
  exists (
    select 1
    from public.presets parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = preset_line_rules.preset_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.presets parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = preset_line_rules.preset_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists preset_listing_assignments_member_all on public.preset_listing_assignments;
create policy preset_listing_assignments_member_all
on public.preset_listing_assignments
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = preset_listing_assignments.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = preset_listing_assignments.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists production_batches_member_all on public.production_batches;
create policy production_batches_member_all
on public.production_batches
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = production_batches.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = production_batches.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists order_items_member_all on public.order_items;
create policy order_items_member_all
on public.order_items
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = order_items.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = order_items.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists batch_items_member_all on public.batch_items;
create policy batch_items_member_all
on public.batch_items
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = batch_items.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = batch_items.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists designs_member_all on public.designs;
create policy designs_member_all
on public.designs
for all
to authenticated
using (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = designs.workspace_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_memberships memberships
    where memberships.workspace_id = designs.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists design_lines_member_all on public.design_lines;
create policy design_lines_member_all
on public.design_lines
for all
to authenticated
using (
  exists (
    select 1
    from public.designs parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = design_lines.design_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.designs parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = design_lines.design_id
      and memberships.user_id = (select auth.uid())
  )
);

drop policy if exists design_analysis_cache_member_all on public.design_analysis_cache;
create policy design_analysis_cache_member_all
on public.design_analysis_cache
for all
to authenticated
using (
  exists (
    select 1
    from public.designs parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = design_analysis_cache.design_id
      and memberships.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.designs parent
    join public.workspace_memberships memberships on memberships.workspace_id = parent.workspace_id
    where parent.id = design_analysis_cache.design_id
      and memberships.user_id = (select auth.uid())
  )
);
