import { createSupabaseAdminClient } from "./supabase-admin.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeJsonValue(value, fallback) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value == null ? fallback : value;
}

async function resolveWorkspaceId(supabase, workspaceKey) {
  if (UUID_PATTERN.test(workspaceKey)) {
    return workspaceKey;
  }

  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.id) {
    throw new Error("No Supabase workspace is available for preset storage.");
  }

  return data.id;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lineSettingsFromRuleRow(row) {
  const settings = {};
  const pairs = [
    ["font_id", "fontId"],
    ["letter_bridge_mm", "bridgeMm"],
    ["line_bridge_mm", "lineBridgeMm"],
    ["offset_x_mm", "offsetXMm"],
    ["text_height_mm", "fontSizeMm"],
    ["horizontal_scale", "horizontalScale"],
    ["vertical_scale", "verticalScale"],
    ["lock_text_height", "lockTextHeight"],
  ];

  for (const [rowKey, settingsKey] of pairs) {
    if (row[rowKey] != null) {
      settings[settingsKey] = row[rowKey];
    }
  }

  return settings;
}

function ruleMatchFromRow(row) {
  if (row.rule_type === "index") {
    return { kind: "index", lineIndex: row.line_index };
  }

  if (row.rule_type === "default") {
    return { kind: "all" };
  }

  return { kind: row.rule_type };
}

function buildPresetSnapshot({ presets, lineRules, assignments, sizeGuides }) {
  const rulesByPresetId = new Map();
  const assignmentsByPresetId = new Map();

  for (const rule of lineRules || []) {
    const existing = rulesByPresetId.get(rule.preset_id) || [];
    existing.push(rule);
    rulesByPresetId.set(rule.preset_id, existing);
  }

  for (const assignment of assignments || []) {
    const existing = assignmentsByPresetId.get(assignment.preset_id) || [];
    existing.push(assignment);
    assignmentsByPresetId.set(assignment.preset_id, existing);
  }

  const defaultPreset = presets.find((preset) => preset.is_default) || presets[0] || null;

  return {
    version: 1,
    defaultPresetId: defaultPreset?.id || "",
    sizePresets: (sizeGuides || []).map((guide) => ({
      id: guide.id,
      label: guide.name,
      max: {
        widthIn: guide.max_width_in,
        heightIn: guide.max_height_in,
      },
      min: {
        widthIn: guide.min_width_in,
        heightIn: guide.min_height_in,
      },
      ...(guide.circle_diameter_in == null ? {} : { circleDiameterIn: guide.circle_diameter_in }),
    })),
    presets: presets.map((preset) => {
      const presetRules = rulesByPresetId.get(preset.id) || [];
      const defaultRule = presetRules.find((rule) => rule.rule_type === "default");
      const lineRulesForPreset = presetRules
        .filter((rule) => rule.rule_type !== "default")
        .sort((first, second) => {
          const order = { first: 0, remaining: 1, index: 2 };
          return (order[first.rule_type] ?? 99) - (order[second.rule_type] ?? 99)
            || (first.line_index ?? 0) - (second.line_index ?? 0);
        });

      return {
        schemaVersion: 1,
        id: preset.id,
        name: preset.name,
        description: "",
        globalDefaults: {
          ...(preset.default_size_guide_id ? { boundingSizePresetId: preset.default_size_guide_id } : {}),
          backingMm: preset.backing_border_mm,
          weldExportedDesign: preset.weld_exported_design,
          globalHorizontalScale: preset.global_horizontal_scale,
          globalVerticalScale: preset.global_vertical_scale,
        },
        lineDefaults: defaultRule ? lineSettingsFromRuleRow(defaultRule) : {},
        lineRules: lineRulesForPreset.map((rule) => ({
          match: ruleMatchFromRow(rule),
          settings: lineSettingsFromRuleRow(rule),
        })),
        fixedItems: normalizeJsonValue(preset.fixed_items_json, []),
        listingAssignments: (assignmentsByPresetId.get(preset.id) || []).map((assignment) => ({
          listingId: assignment.listing_id,
          name: assignment.name || "",
          lineOverrides: normalizeJsonValue(assignment.line_overrides_json, []),
        })),
      };
    }),
  };
}

function buildRuleRows({ presetId, lineDefaults, lineRules }) {
  const rows = [];

  rows.push({
    preset_id: presetId,
    rule_type: "default",
    line_index: null,
    ...lineSettingsToRow(lineDefaults || {}),
  });

  for (const rule of lineRules || []) {
    const kind = rule?.match?.kind === "all" ? "default" : rule?.match?.kind;
    if (!["first", "remaining", "index"].includes(kind)) {
      continue;
    }

    rows.push({
      preset_id: presetId,
      rule_type: kind,
      line_index: kind === "index" ? rule.match.lineIndex : null,
      ...lineSettingsToRow(rule.settings || {}),
    });
  }

  return rows;
}

function lineSettingsToRow(settings) {
  return {
    font_id: settings.fontId ?? null,
    letter_bridge_mm: toNullableNumber(settings.bridgeMm),
    line_bridge_mm: toNullableNumber(settings.lineBridgeMm),
    offset_x_mm: toNullableNumber(settings.offsetXMm),
    text_height_mm: toNullableNumber(settings.fontSizeMm),
    horizontal_scale: toNullableNumber(settings.horizontalScale),
    vertical_scale: toNullableNumber(settings.verticalScale),
    lock_text_height: typeof settings.lockTextHeight === "boolean" ? settings.lockTextHeight : null,
  };
}

export async function loadPresetSnapshot(workspaceKey) {
  const supabase = createSupabaseAdminClient();
  const workspaceId = await resolveWorkspaceId(supabase, workspaceKey);

  const [
    { data: presets, error: presetsError },
    { data: sizeGuides, error: sizeGuidesError },
  ] = await Promise.all([
    supabase
      .from("presets")
      .select("id, workspace_id, name, default_size_guide_id, backing_border_mm, weld_exported_design, global_horizontal_scale, global_vertical_scale, fixed_items_json, is_default, updated_at")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("size_guides")
      .select("id, workspace_id, name, max_width_in, max_height_in, min_width_in, min_height_in, circle_diameter_in, updated_at")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
  ]);

  if (presetsError) {
    throw presetsError;
  }

  if (sizeGuidesError) {
    throw sizeGuidesError;
  }

  if (!presets?.length) {
    return null;
  }

  const presetIds = presets.map((preset) => preset.id);
  const [
    { data: lineRules, error: lineRulesError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    supabase
      .from("preset_line_rules")
      .select("preset_id, rule_type, line_index, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height")
      .in("preset_id", presetIds),
    supabase
      .from("preset_listing_assignments")
      .select("preset_id, listing_id, name, line_overrides_json")
      .in("preset_id", presetIds),
  ]);

  if (lineRulesError) {
    throw lineRulesError;
  }

  if (assignmentsError) {
    throw assignmentsError;
  }

  return {
    workspaceKey,
    snapshot: buildPresetSnapshot({
      presets,
      lineRules,
      assignments,
      sizeGuides,
    }),
    updatedAt: presets.reduce((latest, preset) => preset.updated_at > latest ? preset.updated_at : latest, presets[0].updated_at),
  };
}

export async function savePresetSnapshot(workspaceKey, snapshot) {
  const supabase = createSupabaseAdminClient();
  const workspaceId = await resolveWorkspaceId(supabase, workspaceKey);
  const savedAt = new Date().toISOString();
  const sizeGuides = (snapshot.sizePresets || []).map((guide) => ({
    id: guide.id,
    workspace_id: workspaceId,
    name: guide.label,
    max_width_in: guide.max?.widthIn,
    max_height_in: guide.max?.heightIn,
    min_width_in: guide.min?.widthIn,
    min_height_in: guide.min?.heightIn,
    circle_diameter_in: guide.circleDiameterIn ?? null,
    is_builtin: guide.id === "size-2-2x1-5",
    updated_at: savedAt,
  }));
  const presets = (snapshot.presets || []).map((preset) => ({
    id: preset.id,
    workspace_id: workspaceId,
    name: preset.name,
    default_size_guide_id: preset.globalDefaults?.boundingSizePresetId ?? null,
    backing_border_mm: preset.globalDefaults?.backingMm ?? 3.1,
    weld_exported_design: preset.globalDefaults?.weldExportedDesign !== false,
    global_horizontal_scale: preset.globalDefaults?.globalHorizontalScale ?? 1,
    global_vertical_scale: preset.globalDefaults?.globalVerticalScale ?? 1,
    fixed_items_json: preset.fixedItems || [],
    is_builtin: false,
    is_default: preset.id === snapshot.defaultPresetId,
    updated_at: savedAt,
  }));

  if (sizeGuides.length) {
    const { error } = await supabase
      .from("size_guides")
      .upsert(sizeGuides, { onConflict: "id" });

    if (error) {
      throw error;
    }
  }

  if (presets.length) {
    const { error } = await supabase
      .from("presets")
      .upsert(presets, { onConflict: "id" });

    if (error) {
      throw error;
    }
  }

  const presetIds = presets.map((preset) => preset.id);
  if (presetIds.length) {
    const { error: deleteRulesError } = await supabase
      .from("preset_line_rules")
      .delete()
      .in("preset_id", presetIds);

    if (deleteRulesError) {
      throw deleteRulesError;
    }

    const { error: deleteAssignmentsError } = await supabase
      .from("preset_listing_assignments")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("preset_id", presetIds);

    if (deleteAssignmentsError) {
      throw deleteAssignmentsError;
    }
  }

  const ruleRows = (snapshot.presets || []).flatMap((preset) => buildRuleRows({
    presetId: preset.id,
    lineDefaults: preset.lineDefaults,
    lineRules: preset.lineRules,
  }));
  const assignmentRows = (snapshot.presets || []).flatMap((preset) => (preset.listingAssignments || []).map((assignment) => ({
    workspace_id: workspaceId,
    preset_id: preset.id,
    listing_id: assignment.listingId,
    name: assignment.name || null,
    line_overrides_json: assignment.lineOverrides || [],
  })));

  if (ruleRows.length) {
    const { error } = await supabase
      .from("preset_line_rules")
      .insert(ruleRows);

    if (error) {
      throw error;
    }
  }

  if (assignmentRows.length) {
    const { error } = await supabase
      .from("preset_listing_assignments")
      .insert(assignmentRows);

    if (error) {
      throw error;
    }
  }

  return {
    workspaceKey,
    snapshot,
    updatedAt: savedAt,
  };
}
