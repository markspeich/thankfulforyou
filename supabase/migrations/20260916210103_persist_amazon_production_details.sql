alter table public.listing_drafts
  add column if not exists amazon_production_details jsonb not null default '{}'::jsonb;

create function public.update_listing_draft_atomic_v2(
  p_workspace_id uuid, p_draft_id uuid, p_revision bigint, p_title text, p_description text,
  p_bullets jsonb, p_base_price_cents integer, p_copy_approved boolean, p_amazon_production_details jsonb,
  p_images jsonb default null, p_warnings jsonb default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.listing_drafts where id = p_draft_id and workspace_id = p_workspace_id and revision = p_revision for update;
  if not found then return false; end if;
  update public.listing_drafts set title = p_title, description = p_description, bullets_json = p_bullets,
    base_price_cents = p_base_price_cents, copy_approved = p_copy_approved,
    amazon_production_details = p_amazon_production_details, warnings_json = coalesce(p_warnings, warnings_json),
    revision = revision + 1, updated_at = now()
    where id = p_draft_id and workspace_id = p_workspace_id;
  if p_images is not null then
    update public.listing_assets set main = false where draft_id = p_draft_id and workspace_id = p_workspace_id and main;
    update public.listing_assets asset set selected = patch.selected, main = patch.main, approved = patch.approved, updated_at = now()
    from jsonb_to_recordset(p_images) as patch(id uuid, selected boolean, main boolean, approved boolean)
    where asset.id = patch.id and asset.draft_id = p_draft_id and asset.workspace_id = p_workspace_id;
  end if;
  return true;
end $$;

revoke all on function public.update_listing_draft_atomic_v2(uuid, uuid, bigint, text, text, jsonb, integer, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_listing_draft_atomic_v2(uuid, uuid, bigint, text, text, jsonb, integer, boolean, jsonb, jsonb, jsonb) to service_role;
