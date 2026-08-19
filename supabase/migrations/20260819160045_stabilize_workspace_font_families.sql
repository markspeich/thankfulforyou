update public.fonts
set family_name = 'WorkspaceFont_' || encode(convert_to(id, 'UTF8'), 'hex')
where family_name is distinct from 'WorkspaceFont_' || encode(convert_to(id, 'UTF8'), 'hex');

alter table public.fonts
  add constraint fonts_workspace_family_name_key unique (workspace_id, family_name);
