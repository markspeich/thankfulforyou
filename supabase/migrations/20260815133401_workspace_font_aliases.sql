create table public.font_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  font_id text not null references public.fonts(id) on delete restrict,
  alias_name text not null,
  normalized_alias text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_alias)
);

create index font_aliases_workspace_font_idx
  on public.font_aliases (workspace_id, font_id);

alter table public.font_aliases enable row level security;

grant select on public.font_aliases to authenticated;
grant all on public.font_aliases to service_role;

create policy font_aliases_member_select
on public.font_aliases
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships memberships
    where memberships.workspace_id = font_aliases.workspace_id
      and memberships.user_id = (select auth.uid())
  )
);

create or replace function public.seed_workspace_super_boy_font_aliases()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted_count bigint;
begin
  insert into public.font_aliases (
    workspace_id,
    font_id,
    alias_name,
    normalized_alias
  )
  select
    workspaces.id,
    target_font.id,
    'Super Boy',
    'super boy'
  from public.workspaces workspaces
  join public.fonts target_font
    on target_font.workspace_id = workspaces.id
   and target_font.display_name = 'Super Boys'
   and target_font.archived_at is null
   and target_font.deleted_at is null
  on conflict (workspace_id, normalized_alias) do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;

select public.seed_workspace_super_boy_font_aliases();

revoke all on function public.seed_workspace_super_boy_font_aliases()
from public, anon, authenticated;
grant execute on function public.seed_workspace_super_boy_font_aliases()
to service_role;

create or replace function public.map_workspace_font_alias(
  p_workspace_id uuid,
  p_user_id uuid,
  p_alias_name text,
  p_normalized_alias text,
  p_font_id text,
  p_order_item_id text default null,
  p_design_id uuid default null,
  p_line_index integer default null,
  p_expected_order_revision bigint default null,
  p_expected_design_revision bigint default null,
  p_expected_alias_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_normalized_alias text;
  v_existing_alias public.font_aliases%rowtype;
  v_saved_alias public.font_aliases%rowtype;
  v_target_font public.fonts%rowtype;
  v_previous_font public.fonts%rowtype;
  v_order public.order_items%rowtype;
  v_design public.designs%rowtype;
  v_selected_line public.design_lines%rowtype;
  v_line jsonb;
  v_has_design_context boolean;
  v_design_state_invalidated boolean := false;
begin
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'Workspace is required.';
  end if;

  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Operator user is required.';
  end if;
  if not exists (
    select 1
    from public.workspace_memberships memberships
    where memberships.workspace_id = p_workspace_id
      and memberships.user_id = p_user_id
      and memberships.role = 'operator'
  ) then
    raise exception using
      errcode = '42501',
      message = 'User is not an operator in the workspace.';
  end if;

  if p_alias_name is null then
    raise exception using errcode = '22023', message = 'Alias name is required.';
  end if;

  v_normalized_alias := pg_catalog.lower(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        normalize(p_alias_name, NFKC),
        U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
        ' ',
        'g'
      )
    ) collate pg_catalog."und-x-icu"
  );
  if v_normalized_alias = '' then
    raise exception using errcode = '22023', message = 'Alias name is required.';
  end if;
  if p_normalized_alias is distinct from v_normalized_alias then
    raise exception using
      errcode = '22023',
      message = 'Normalized alias does not match the alias name.';
  end if;

  v_has_design_context := p_order_item_id is not null
    or p_design_id is not null
    or p_line_index is not null
    or p_expected_order_revision is not null
    or p_expected_design_revision is not null;
  if v_has_design_context and (
    p_order_item_id is null
    or p_design_id is null
    or p_line_index is null
    or p_expected_order_revision is null
    or p_expected_design_revision is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Complete order, design, line, and revision context is required.';
  end if;
  if p_line_index is not null and p_line_index < 0 then
    raise exception using errcode = '22023', message = 'Line index must not be negative.';
  end if;
  if p_expected_alias_revision is not null and p_expected_alias_revision < 1 then
    raise exception using errcode = '22023', message = 'Expected alias revision must be positive.';
  end if;

  -- Missing aliases cannot be row-locked, so serialize by canonical workspace key first.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || v_normalized_alias, 0)
  );

  select aliases.*
  into v_existing_alias
  from public.font_aliases aliases
  where aliases.workspace_id = p_workspace_id
    and aliases.normalized_alias = v_normalized_alias
  for update;

  if v_existing_alias.id is null and p_expected_alias_revision is not null then
    raise exception using
      errcode = '40001',
      message = 'Font alias revision conflict.';
  end if;
  if v_existing_alias.id is not null
    and v_existing_alias.revision is distinct from p_expected_alias_revision
  then
    raise exception using
      errcode = '40001',
      message = 'Font alias revision conflict.';
  end if;

  if found then
    select fonts.*
    into v_previous_font
    from public.fonts fonts
    where fonts.id = v_existing_alias.font_id;
  end if;

  select fonts.*
  into v_target_font
  from public.fonts fonts
  where fonts.id = p_font_id
    and fonts.workspace_id = p_workspace_id
    and fonts.archived_at is null
    and fonts.deleted_at is null
  for update;
  if not found then
    raise exception using
      errcode = '22023',
      message = 'Target font must be active and belong to the workspace.';
  end if;

  if v_has_design_context then
    select orders.*
    into v_order
    from public.order_items orders
    where orders.id = p_order_item_id
      and orders.workspace_id = p_workspace_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Order item does not belong to the workspace.';
    end if;

    select designs.*
    into v_design
    from public.designs designs
    where designs.id = p_design_id
      and designs.order_item_id = p_order_item_id
      and designs.workspace_id = p_workspace_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Design does not match the order item and workspace.';
    end if;

    if v_order.revision is distinct from p_expected_order_revision then
      raise exception using
        errcode = '40001',
        message = 'Order item revision conflict.';
    end if;
    if v_design.revision is distinct from p_expected_design_revision then
      raise exception using
        errcode = '40001',
        message = 'Design revision conflict.';
    end if;

    select lines.*
    into v_selected_line
    from public.design_lines lines
    where lines.design_id = p_design_id
      and lines.line_index = p_line_index
      and lines.item_kind = 'text'
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Text design line does not exist.';
    end if;

    v_design_state_invalidated := v_selected_line.font_id is distinct from p_font_id;
  end if;

  if v_existing_alias.id is null then
    insert into public.font_aliases (
      workspace_id,
      font_id,
      alias_name,
      normalized_alias,
      created_by,
      updated_by
    )
    values (
      p_workspace_id,
      p_font_id,
      p_alias_name,
      v_normalized_alias,
      p_user_id,
      p_user_id
    )
    returning * into v_saved_alias;
  else
    update public.font_aliases aliases
    set
      font_id = p_font_id,
      alias_name = p_alias_name,
      updated_by = p_user_id,
      revision = aliases.revision + 1,
      updated_at = now()
    where aliases.id = v_existing_alias.id
    returning * into v_saved_alias;
  end if;

  if v_has_design_context then
    update public.design_lines lines
    set font_id = p_font_id
    where lines.design_id = p_design_id
      and lines.line_index = p_line_index
      and lines.item_kind = 'text';

    if v_design_state_invalidated then
      update public.designs designs
      set
        production_status = 'in_progress',
        cached_build_json = null,
        previous_completed_build_json = null,
        saved_settings_signature = null,
        completed_settings_signature = null,
        analysis_badge_json = null,
        pending_analysis_signature = null,
        revision = designs.revision + 1,
        updated_by = p_user_id,
        updated_at = now()
      where designs.id = p_design_id
      returning * into v_design;

      delete from public.design_analysis_cache cache
      where cache.design_id = p_design_id;
    else
      update public.designs designs
      set
        revision = designs.revision + 1,
        updated_by = p_user_id,
        updated_at = now()
      where designs.id = p_design_id
      returning * into v_design;
    end if;

    update public.order_items orders
    set
      revision = orders.revision + 1,
      updated_by = p_user_id,
      updated_at = now()
    where orders.id = p_order_item_id
    returning * into v_order;

    select to_jsonb(lines)
    into v_line
    from public.design_lines lines
    where lines.design_id = p_design_id
      and lines.line_index = p_line_index
      and lines.item_kind = 'text';
  end if;

  return jsonb_build_object(
    'alias_id', v_saved_alias.id,
    'workspace_id', v_saved_alias.workspace_id,
    'alias_name', v_saved_alias.alias_name,
    'normalized_alias', v_saved_alias.normalized_alias,
    'alias_revision', v_saved_alias.revision,
    'previous_alias_revision', v_existing_alias.revision,
    'previous_font_id', v_existing_alias.font_id,
    'previous_font_display_name', v_previous_font.display_name,
    'previous_font_archived_at', v_previous_font.archived_at,
    'previous_font_deleted_at', v_previous_font.deleted_at,
    'font_id', v_saved_alias.font_id,
    'font_display_name', v_target_font.display_name,
    'font_archived_at', v_target_font.archived_at,
    'font_deleted_at', v_target_font.deleted_at,
    'created_by', v_saved_alias.created_by,
    'updated_by', v_saved_alias.updated_by,
    'created_at', v_saved_alias.created_at,
    'updated_at', v_saved_alias.updated_at,
    'line', v_line,
    'design_state_invalidated', v_design_state_invalidated,
    'production_status', case when v_has_design_context then v_design.production_status else null end,
    'order_revision', case when v_has_design_context then v_order.revision else null end,
    'design_revision', case when v_has_design_context then v_design.revision else null end
  );
end;
$$;

revoke all on function public.map_workspace_font_alias(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  integer,
  bigint,
  bigint,
  bigint
) from public, anon, authenticated;
grant execute on function public.map_workspace_font_alias(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  integer,
  bigint,
  bigint,
  bigint
) to service_role;
