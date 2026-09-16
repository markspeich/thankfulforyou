create table public.listing_amazon_production_attempts (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 draft_id uuid not null, revision bigint not null, seller_id text not null, sku text not null, payload_hash text not null,
 action text not null check(action in ('validate','submit','reconcile')),
 status text not null check(status in ('running','checked','invalid','accepted','unknown','failed','unconfirmed','inactive','buyable')),
 issues jsonb not null default '[]', result jsonb not null default '{}', created_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(workspace_id,draft_id) references public.listing_drafts(workspace_id,id) on delete cascade
);
alter table public.listing_amazon_production_attempts enable row level security;
revoke all on public.listing_amazon_production_attempts from public,anon,authenticated;
grant all on public.listing_amazon_production_attempts to service_role;
create index listing_amazon_production_history on public.listing_amazon_production_attempts(workspace_id,draft_id,seller_id,created_at desc);
create unique index listing_amazon_production_running on public.listing_amazon_production_attempts(draft_id,seller_id) where status='running';
create function public.claim_listing_amazon_production(p_workspace_id uuid,p_draft_id uuid,p_revision bigint,p_action text,p_payload_hash text,p_seller_id text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare attempt_id uuid;
begin
 if p_action not in ('validate','submit','reconcile') or nullif(trim(p_seller_id),'') is null then raise exception 'Invalid production operation.' using errcode='P0001'; end if;
 perform 1 from public.listing_drafts where workspace_id=p_workspace_id and id=p_draft_id and revision=p_revision for update;
 if not found then raise exception 'Draft changed or was not found.' using errcode='P0001'; end if;
 update public.listing_amazon_production_attempts set status=case when action='submit' then 'unknown' else 'failed' end,completed_at=now(),issues='[{"code":"TIMEOUT","severity":"ERROR","message":"Previous operation did not finish. Check Amazon status before continuing."}]'
 where workspace_id=p_workspace_id and draft_id=p_draft_id and seller_id=p_seller_id and status='running' and created_at<now()-interval '5 minutes';
 if exists(select 1 from public.listing_amazon_production_attempts where draft_id=p_draft_id and seller_id=p_seller_id and status='running') then raise exception 'A production operation is already running.' using errcode='P0001'; end if;
 if p_action='submit' then
  if exists(select 1 from public.listing_amazon_production_attempts where draft_id=p_draft_id and seller_id=p_seller_id and action='submit' and status in ('accepted','unknown')) then raise exception 'A production submission was already accepted or has an uncertain outcome. Check Amazon status; do not replay it.' using errcode='P0001'; end if;
  if (select status from public.listing_amazon_production_attempts where workspace_id=p_workspace_id and draft_id=p_draft_id and seller_id=p_seller_id and revision=p_revision and payload_hash=p_payload_hash and action='validate' order by created_at desc limit 1) is distinct from 'checked' then raise exception 'Run a successful production preview for this saved revision first.' using errcode='P0001'; end if;
 end if;
 insert into public.listing_amazon_production_attempts(workspace_id,draft_id,revision,seller_id,sku,payload_hash,action,status) values(p_workspace_id,p_draft_id,p_revision,p_seller_id,'TFY-'||replace(p_draft_id::text,'-',''),p_payload_hash,p_action,'running') returning id into attempt_id;
 return attempt_id;
end $$;
revoke all on function public.claim_listing_amazon_production(uuid,uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_listing_amazon_production(uuid,uuid,bigint,text,text,text) to service_role;
