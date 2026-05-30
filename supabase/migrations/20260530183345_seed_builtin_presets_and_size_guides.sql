insert into public.size_guides (
  id,
  workspace_id,
  name,
  max_width_in,
  max_height_in,
  min_width_in,
  min_height_in,
  circle_diameter_in,
  is_builtin
)
values (
  'size-2-2x1-5',
  '11111111-1111-4111-8111-111111111111',
  '2.2 x 1.5 in',
  2.2,
  1.5,
  1.6,
  1.1,
  1.25,
  true
)
on conflict (id) do update
set workspace_id = excluded.workspace_id,
    name = excluded.name,
    max_width_in = excluded.max_width_in,
    max_height_in = excluded.max_height_in,
    min_width_in = excluded.min_width_in,
    min_height_in = excluded.min_height_in,
    circle_diameter_in = excluded.circle_diameter_in,
    is_builtin = excluded.is_builtin,
    updated_at = now();

insert into public.presets (
  id,
  workspace_id,
  name,
  default_size_guide_id,
  backing_border_mm,
  weld_exported_design,
  global_horizontal_scale,
  global_vertical_scale,
  is_builtin,
  is_default
)
values
  ('preset-a1f4c8e2b601', '11111111-1111-4111-8111-111111111111', 'All Candlepin', 'size-2-2x1-5', 3.1, true, 1, 1, true, true),
  ('preset-b7d2e9f4c318', '11111111-1111-4111-8111-111111111111', 'Candlepin, Skywalk', 'size-2-2x1-5', 3.1, true, 1, 1, true, false),
  ('preset-c3e8a1d7f520', '11111111-1111-4111-8111-111111111111', 'Skywalk, Somekind', 'size-2-2x1-5', 3.1, true, 1, 1, true, false),
  ('preset-d9b4f2a6c731', '11111111-1111-4111-8111-111111111111', 'Skywalk, Candlepin', 'size-2-2x1-5', 3.1, true, 1, 1, true, false)
on conflict (id) do update
set workspace_id = excluded.workspace_id,
    name = excluded.name,
    default_size_guide_id = excluded.default_size_guide_id,
    backing_border_mm = excluded.backing_border_mm,
    weld_exported_design = excluded.weld_exported_design,
    global_horizontal_scale = excluded.global_horizontal_scale,
    global_vertical_scale = excluded.global_vertical_scale,
    is_builtin = excluded.is_builtin,
    is_default = excluded.is_default,
    updated_at = now();

delete from public.preset_line_rules
where preset_id in (
  'preset-a1f4c8e2b601',
  'preset-b7d2e9f4c318',
  'preset-c3e8a1d7f520',
  'preset-d9b4f2a6c731'
);

insert into public.preset_line_rules (
  preset_id,
  rule_type,
  line_index,
  font_id,
  letter_bridge_mm,
  line_bridge_mm,
  offset_x_mm,
  text_height_mm,
  horizontal_scale,
  vertical_scale,
  lock_text_height
)
values
  ('preset-a1f4c8e2b601', 'default', null, 'candlepin', 0.5, 0.5, 0, 34, 1, 1, false),
  ('preset-b7d2e9f4c318', 'default', null, 'candlepin', 0.5, 0.5, 0, 34, 1, 1, false),
  ('preset-b7d2e9f4c318', 'first', null, 'candlepin', null, null, null, null, null, null, null),
  ('preset-b7d2e9f4c318', 'remaining', null, 'skywalk', null, null, null, null, null, null, null),
  ('preset-c3e8a1d7f520', 'default', null, 'candlepin', 0.5, 0.5, 0, 34, 1, 1, false),
  ('preset-c3e8a1d7f520', 'first', null, 'skywalk', null, null, null, 18, null, null, null),
  ('preset-c3e8a1d7f520', 'remaining', null, 'somekind', null, null, null, null, null, null, null),
  ('preset-c3e8a1d7f520', 'index', 1, null, null, null, null, 23, null, null, true),
  ('preset-d9b4f2a6c731', 'default', null, 'candlepin', 0.5, 0.5, 0, 34, 1, 1, false),
  ('preset-d9b4f2a6c731', 'first', null, 'skywalk', null, null, null, null, null, null, null),
  ('preset-d9b4f2a6c731', 'remaining', null, 'candlepin', null, null, null, null, null, null, null);

delete from public.preset_listing_assignments
where workspace_id = '11111111-1111-4111-8111-111111111111'
  and preset_id in (
    'preset-b7d2e9f4c318',
    'preset-c3e8a1d7f520',
    'preset-d9b4f2a6c731'
  );

insert into public.preset_listing_assignments (
  workspace_id,
  preset_id,
  listing_id,
  name,
  line_overrides_json
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'preset-b7d2e9f4c318',
    '4439916732',
    'Candlepin + Skywalk listing with taller first line',
    '[{"lineIndex":0,"settings":{"fontSizeMm":44}}]'::jsonb
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'preset-c3e8a1d7f520',
    '1884223710',
    'Skywalk + Somekind listing with shorter second line',
    '[{"lineIndex":1,"settings":{"fontSizeMm":23}}]'::jsonb
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'preset-d9b4f2a6c731',
    '4465975709',
    'Skywalk + Candlepin listing with shorter second line',
    '[{"lineIndex":1,"settings":{"fontSizeMm":21}}]'::jsonb
  )
on conflict (workspace_id, listing_id) do update
set preset_id = excluded.preset_id,
    name = excluded.name,
    line_overrides_json = excluded.line_overrides_json;
