create table public.listing_amazon_sandbox_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null,
  revision bigint not null,
  sku text not null,
  payload_hash text not null,
  action text not null check (action in ('validate','submit','reconcile')),
  status text not null check (status in ('running','checked','invalid','accepted','unknown','failed','unconfirmed')),
  issues jsonb not null default '[]',
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (workspace_id, draft_id) references public.listing_drafts(workspace_id,id) on delete cascade
);
create index listing_amazon_sandbox_history on public.listing_amazon_sandbox_attempts(workspace_id,draft_id,created_at desc);
create unique index listing_amazon_sandbox_running on public.listing_amazon_sandbox_attempts(draft_id) where status='running';
alter table public.listing_amazon_sandbox_attempts enable row level security;
revoke all on public.listing_amazon_sandbox_attempts from anon, authenticated;
grant select on public.listing_amazon_sandbox_attempts to authenticated;
grant all on public.listing_amazon_sandbox_attempts to service_role;
create policy listing_amazon_sandbox_read on public.listing_amazon_sandbox_attempts for select to authenticated
using (exists(select 1 from public.workspace_memberships m where m.workspace_id=listing_amazon_sandbox_attempts.workspace_id and m.user_id=(select auth.uid())));

create function public.claim_listing_amazon_sandbox(p_workspace_id uuid,p_draft_id uuid,p_revision bigint,p_action text,p_payload_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare attempt_id uuid;
begin
  perform 1 from public.listing_drafts where workspace_id=p_workspace_id and id=p_draft_id and revision=p_revision for update;
  if not found then raise exception 'Draft changed or was not found.' using errcode='P0001'; end if;
  update public.listing_amazon_sandbox_attempts set status=case when action='submit' then 'unknown' else 'failed' end,
    issues='[{"code":"TIMEOUT","message":"The previous test did not finish. Check sandbox status before retrying a submission.","severity":"ERROR"}]',completed_at=now()
    where draft_id=p_draft_id and status='running' and created_at<now()-interval '2 minutes';
  if exists(select 1 from public.listing_amazon_sandbox_attempts where draft_id=p_draft_id and status='running') then
    raise exception 'A sandbox test is already running.' using errcode='P0001';
  end if;
  if p_action='submit' then
    if exists(select 1 from public.listing_amazon_sandbox_attempts where draft_id=p_draft_id and status in ('unknown','unconfirmed')) then
      raise exception 'Submission outcome is uncertain. Check sandbox status; do not replay it.' using errcode='P0001';
    end if;
    if exists(select 1 from public.listing_amazon_sandbox_attempts where draft_id=p_draft_id and revision=p_revision and action='submit' and status='accepted') then
      raise exception 'This revision already received a sandbox submission response.' using errcode='P0001';
    end if;
    if (select status from public.listing_amazon_sandbox_attempts where draft_id=p_draft_id and revision=p_revision and payload_hash=p_payload_hash and action='validate' order by created_at desc limit 1) is distinct from 'checked' then
      raise exception 'Run a successful sandbox preview for this revision first.' using errcode='P0001';
    end if;
  end if;
  insert into public.listing_amazon_sandbox_attempts(workspace_id,draft_id,revision,sku,payload_hash,action,status)
    values(p_workspace_id,p_draft_id,p_revision,'TFY-'||replace(p_draft_id::text,'-',''),p_payload_hash,p_action,'running') returning id into attempt_id;
  return attempt_id;
end $$;
revoke all on function public.claim_listing_amazon_sandbox(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.claim_listing_amazon_sandbox(uuid,uuid,bigint,text,text) to service_role;
