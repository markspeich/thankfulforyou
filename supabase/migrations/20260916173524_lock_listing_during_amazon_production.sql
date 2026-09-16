-- Keep the reviewed draft immutable from the operation claim through its result.
-- Claims and edits acquire the same draft row lock, so neither can pass the other.
create function public.guard_listing_production_edit() returns trigger
language plpgsql security invoker set search_path=public as $$
declare target_draft uuid; target_workspace uuid;
begin
 if tg_table_name='listing_drafts' then
  target_draft=old.id; target_workspace=old.workspace_id;
 else
  if tg_op='DELETE' then target_draft=old.draft_id; target_workspace=old.workspace_id;
  else target_draft=new.draft_id; target_workspace=new.workspace_id; end if;
  perform 1 from public.listing_drafts where id=target_draft and workspace_id=target_workspace for update;
  if tg_op='UPDATE' and (old.draft_id is distinct from new.draft_id or old.workspace_id is distinct from new.workspace_id) then
   raise exception 'Listing assets cannot be moved between drafts.' using errcode='P0001';
  end if;
 end if;
 if exists(select 1 from public.listing_amazon_production_attempts where workspace_id=target_workspace and draft_id=target_draft and status='running') then
  raise exception 'An Amazon production operation is running. Wait for completion or check Amazon status before editing this draft.' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_listing_production_edit() from public,anon,authenticated;
grant execute on function public.guard_listing_production_edit() to service_role;
create trigger guard_listing_draft_production_edit before update or delete on public.listing_drafts
 for each row execute function public.guard_listing_production_edit();
create trigger guard_listing_asset_production_edit before insert or update or delete on public.listing_assets
 for each row execute function public.guard_listing_production_edit();
