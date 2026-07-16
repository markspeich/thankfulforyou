create table public.etsy_connections (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  etsy_user_id text not null,
  etsy_shop_id text not null,
  etsy_shop_name text,
  scopes text[] not null default '{}'::text[],
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  access_token_envelope jsonb not null,
  refresh_token_envelope jsonb not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  last_synced_at timestamptz,
  import_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.etsy_connections enable row level security;

revoke all on public.etsy_connections from anon, authenticated;
grant all on public.etsy_connections to service_role;
