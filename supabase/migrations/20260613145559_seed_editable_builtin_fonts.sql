grant all on public.workspaces to service_role;
grant all on public.workspace_memberships to service_role;

insert into public.fonts (
  id,
  workspace_id,
  display_name,
  family_name,
  storage_bucket,
  storage_path,
  public_url,
  file_name,
  file_format,
  version,
  is_builtin,
  deleted_at
)
select
  font_seed.id,
  workspaces.id,
  font_seed.display_name,
  font_seed.family_name,
  'workspace-fonts',
  font_seed.public_path,
  font_seed.public_path,
  font_seed.file_name,
  font_seed.file_format,
  1,
  true,
  null
from public.workspaces workspaces
cross join (
  values
    ('candlepin', 'Candlepin Laser', 'CandlepinLaser', 'public/fonts/Candlepin-Laser.otf', 'Candlepin-Laser.otf', 'otf'),
    ('skywalk', 'Skywalk Laser', 'SkywalkLaser', 'public/fonts/SkywalkLaserRegular.otf', 'SkywalkLaserRegular.otf', 'otf'),
    ('somekind', 'Somekind', 'Somekind', 'public/fonts/Somekind.ttf', 'Somekind.ttf', 'ttf')
) as font_seed(id, display_name, family_name, public_path, file_name, file_format)
where workspaces.id = '11111111-1111-4111-8111-111111111111'
on conflict (id) do update
set
  workspace_id = excluded.workspace_id,
  display_name = excluded.display_name,
  family_name = excluded.family_name,
  storage_bucket = excluded.storage_bucket,
  storage_path = excluded.storage_path,
  public_url = excluded.public_url,
  file_name = excluded.file_name,
  file_format = excluded.file_format,
  is_builtin = true,
  deleted_at = null,
  updated_at = now()
where public.fonts.version = 1
  and public.fonts.storage_path like 'public/fonts/%';
