alter table public.fonts add column if not exists archived_at timestamptz;

update public.fonts set archived_at = deleted_at
where archived_at is null and deleted_at is not null;

update public.fonts set is_builtin = false
where id in ('candlepin', 'skywalk', 'somekind');

create index if not exists fonts_workspace_active_name_archived_idx
  on public.fonts (workspace_id, display_name)
  where archived_at is null and deleted_at is null;

-- Legacy deleted_at/is_builtin columns remain during the additive compatibility period.
-- Stable seed ids are inserted only when absent, never overwriting operator changes.
insert into public.fonts (id, workspace_id, display_name, family_name, storage_bucket, storage_path, public_url, file_name, file_format, version, is_builtin, deleted_at, archived_at)
select seed.id, workspaces.id, seed.display_name, seed.family_name, 'workspace-fonts', seed.public_path, seed.public_path, seed.file_name, seed.file_format, 1, false, null, null
from public.workspaces workspaces
cross join (values
  ('candlepin', 'Candlepin Laser', 'CandlepinLaser', 'public/fonts/Candlepin-Laser.otf', 'Candlepin-Laser.otf', 'otf'),
  ('skywalk', 'Skywalk Laser', 'SkywalkLaser', 'public/fonts/SkywalkLaserRegular.otf', 'SkywalkLaserRegular.otf', 'otf'),
  ('somekind', 'Somekind', 'Somekind', 'public/fonts/Somekind.ttf', 'Somekind.ttf', 'ttf')
) as seed(id, display_name, family_name, public_path, file_name, file_format)
on conflict (id) do nothing;
