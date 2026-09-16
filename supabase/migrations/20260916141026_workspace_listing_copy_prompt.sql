create table public.workspace_listing_copy_prompts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 20000),
  updated_at timestamptz not null default now()
);

alter table public.workspace_listing_copy_prompts enable row level security;
revoke all on table public.workspace_listing_copy_prompts from public, anon, authenticated;
grant all on table public.workspace_listing_copy_prompts to service_role;
