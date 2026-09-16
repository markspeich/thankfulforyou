create extension if not exists pgcrypto with schema extensions;

create table if not exists public.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  etsy_shop_id text not null,
  etsy_listing_id text not null,
  target_marketplace text not null default 'amazon' check (target_marketplace = 'amazon'),
  source_url text,
  source_title text not null default '',
  source_description text not null default '',
  title text not null default '',
  description text not null default '',
  bullets_json jsonb not null default '["", "", "", "", ""]'::jsonb,
  base_price_cents integer not null default 1999 check (base_price_cents > 0),
  facts_json jsonb not null default '{}'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  copy_approved boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, etsy_shop_id, etsy_listing_id, target_marketplace)
);

create table if not exists public.listing_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null references public.listing_drafts(id) on delete cascade,
  kind text not null check (kind in ('original', 'prepared', 'uploaded')),
  source_url text,
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  source_rank integer not null default 0 check (source_rank >= 0),
  alt text not null default '',
  selected boolean not null default true,
  main boolean not null default false,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, storage_path)
);
create unique index if not exists listing_assets_one_main_per_draft_idx on public.listing_assets(draft_id) where main;
create index if not exists listing_assets_workspace_draft_idx on public.listing_assets(workspace_id, draft_id, source_rank);
alter table public.listing_drafts add constraint listing_drafts_workspace_id_id_key unique (workspace_id, id);
alter table public.listing_assets add constraint listing_assets_workspace_draft_fkey foreign key (workspace_id, draft_id) references public.listing_drafts(workspace_id, id) on delete cascade;

create table if not exists public.listing_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null references public.listing_drafts(id) on delete cascade,
  expected_revision bigint not null,
  operation_type text not null check (operation_type in ('import', 'copy_generation', 'image_preparation', 'image_upload')),
  status text not null check (status in ('running', 'completed', 'failed')),
  safe_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists listing_operations_running_unique_idx on public.listing_operations(draft_id, expected_revision, operation_type) where status = 'running';
alter table public.listing_operations alter column draft_id drop not null;
alter table public.listing_operations add column source_key text;
create unique index if not exists listing_operations_import_running_unique_idx on public.listing_operations(workspace_id, source_key) where status = 'running' and operation_type = 'import';

alter table public.listing_drafts enable row level security;
alter table public.listing_assets enable row level security;
alter table public.listing_operations enable row level security;
grant all on public.listing_drafts, public.listing_assets, public.listing_operations to service_role;
revoke insert, update, delete, truncate, references, trigger on public.listing_drafts, public.listing_assets, public.listing_operations from anon, authenticated;

drop policy if exists listing_drafts_member_all on public.listing_drafts;
drop policy if exists listing_drafts_member_select on public.listing_drafts;
create policy listing_drafts_member_select on public.listing_drafts for select to authenticated
using (exists (select 1 from public.workspace_memberships m where m.workspace_id = listing_drafts.workspace_id and m.user_id = (select auth.uid())))
;
drop policy if exists listing_assets_member_all on public.listing_assets;
drop policy if exists listing_assets_member_select on public.listing_assets;
create policy listing_assets_member_select on public.listing_assets for select to authenticated
using (exists (select 1 from public.workspace_memberships m where m.workspace_id = listing_assets.workspace_id and m.user_id = (select auth.uid())))
;
drop policy if exists listing_operations_member_all on public.listing_operations;
drop policy if exists listing_operations_member_select on public.listing_operations;
create policy listing_operations_member_select on public.listing_operations for select to authenticated
using (exists (select 1 from public.workspace_memberships m where m.workspace_id = listing_operations.workspace_id and m.user_id = (select auth.uid())))
;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-draft-assets', 'listing-draft-assets', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.update_listing_draft_atomic(
  p_workspace_id uuid, p_draft_id uuid, p_revision bigint, p_title text, p_description text,
  p_bullets jsonb, p_base_price_cents integer, p_copy_approved boolean, p_images jsonb default null, p_warnings jsonb default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.listing_drafts where id = p_draft_id and workspace_id = p_workspace_id and revision = p_revision for update;
  if not found then return false; end if;
  update public.listing_drafts set title = p_title, description = p_description, bullets_json = p_bullets,
    base_price_cents = p_base_price_cents, copy_approved = p_copy_approved, warnings_json = coalesce(p_warnings, warnings_json), revision = revision + 1, updated_at = now()
    where id = p_draft_id and workspace_id = p_workspace_id;
  if p_images is not null then
    update public.listing_assets set main = false where draft_id = p_draft_id and workspace_id = p_workspace_id and main;
    update public.listing_assets asset set selected = patch.selected, main = patch.main, approved = patch.approved, updated_at = now()
    from jsonb_to_recordset(p_images) as patch(id uuid, selected boolean, main boolean, approved boolean)
    where asset.id = patch.id and asset.draft_id = p_draft_id and asset.workspace_id = p_workspace_id;
  end if;
  return true;
end $$;
revoke all on function public.update_listing_draft_atomic(uuid, uuid, bigint, text, text, jsonb, integer, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_listing_draft_atomic(uuid, uuid, bigint, text, text, jsonb, integer, boolean, jsonb, jsonb) to service_role;

create or replace function public.add_listing_asset_atomic(p_workspace_id uuid, p_draft_id uuid, p_revision bigint, p_asset jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.listing_drafts where id = p_draft_id and workspace_id = p_workspace_id and revision = p_revision for update;
  if not found then return false; end if;
  insert into public.listing_assets (id, workspace_id, draft_id, kind, source_url, storage_bucket, storage_path, mime_type, byte_size, width, height, source_rank, alt, selected, main, approved)
  values ((p_asset->>'id')::uuid, p_workspace_id, p_draft_id, p_asset->>'kind', nullif(p_asset->>'sourceUrl',''), p_asset->>'storageBucket', p_asset->>'storagePath', p_asset->>'mimeType', (p_asset->>'byteSize')::integer, (p_asset->>'width')::integer, (p_asset->>'height')::integer, (p_asset->>'sourceRank')::integer, coalesce(p_asset->>'alt',''), coalesce((p_asset->>'selected')::boolean, true), coalesce((p_asset->>'main')::boolean, false), false);
  update public.listing_drafts set revision = revision + 1, updated_at = now() where id = p_draft_id and workspace_id = p_workspace_id;
  return true;
end $$;
revoke all on function public.add_listing_asset_atomic(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.add_listing_asset_atomic(uuid, uuid, bigint, jsonb) to service_role;

create or replace function public.import_listing_draft_atomic(p_draft jsonb, p_assets jsonb)
returns table (draft_id uuid, existing boolean) language plpgsql security definer set search_path = public as $$
declare inserted_id uuid;
begin
  insert into public.listing_drafts (id, workspace_id, etsy_shop_id, etsy_listing_id, target_marketplace, source_url, source_title, source_description, title, description, bullets_json, base_price_cents, facts_json, warnings_json, copy_approved, revision, updated_at)
  values ((p_draft->>'id')::uuid, (p_draft->>'workspaceId')::uuid, p_draft->>'etsyShopId', p_draft->>'etsyListingId', 'amazon', p_draft->>'sourceUrl', p_draft->>'sourceTitle', p_draft->>'sourceDescription', p_draft->>'title', p_draft->>'description', coalesce(p_draft->'bullets','["","","","",""]'::jsonb), (p_draft->>'basePriceCents')::integer, coalesce(p_draft->'facts','{}'::jsonb), coalesce(p_draft->'warnings','[]'::jsonb), false, 1, now())
  on conflict (workspace_id, etsy_shop_id, etsy_listing_id, target_marketplace) do nothing returning id into inserted_id;
  if inserted_id is null then
    select id into draft_id from public.listing_drafts where workspace_id = (p_draft->>'workspaceId')::uuid and etsy_shop_id = p_draft->>'etsyShopId' and etsy_listing_id = p_draft->>'etsyListingId' and target_marketplace = 'amazon'; existing := true; return next; return;
  end if;
  insert into public.listing_assets (id, workspace_id, draft_id, kind, source_url, storage_bucket, storage_path, mime_type, byte_size, width, height, source_rank, alt, selected, main, approved)
  select (asset->>'id')::uuid, (p_draft->>'workspaceId')::uuid, inserted_id, asset->>'kind', nullif(asset->>'sourceUrl',''), asset->>'storageBucket', asset->>'storagePath', asset->>'mimeType', (asset->>'byteSize')::integer, (asset->>'width')::integer, (asset->>'height')::integer, (asset->>'sourceRank')::integer, coalesce(asset->>'alt',''), true, coalesce((asset->>'main')::boolean,false), false from jsonb_array_elements(coalesce(p_assets,'[]'::jsonb)) asset;
  draft_id := inserted_id; existing := false; return next;
end $$;
revoke all on function public.import_listing_draft_atomic(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_listing_draft_atomic(jsonb, jsonb) to service_role;
