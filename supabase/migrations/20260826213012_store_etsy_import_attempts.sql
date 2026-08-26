create table public.etsy_import_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  initiated_by uuid,
  attempted_at timestamptz not null default now(),
  order_number text,
  transaction_id text,
  listing_id text,
  outcome text not null check (outcome in ('imported', 'existing', 'failed')),
  stage text not null,
  raw_receipt jsonb,
  raw_transaction jsonb,
  raw_listing jsonb,
  raw_image jsonb,
  normalized_item jsonb,
  persistence jsonb,
  fetch_errors jsonb,
  error jsonb
);

create index etsy_import_attempts_workspace_order_attempted_idx
  on public.etsy_import_attempts (workspace_id, order_number, attempted_at desc);

create index etsy_import_attempts_run_id_idx
  on public.etsy_import_attempts (run_id);

alter table public.etsy_import_attempts enable row level security;

revoke all on table public.etsy_import_attempts from public, anon, authenticated;
grant select, insert on table public.etsy_import_attempts to service_role;
