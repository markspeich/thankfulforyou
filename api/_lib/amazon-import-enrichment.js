import {
  overlayCustomerFontsOnLines,
  summarizeCustomerFontResolution,
} from "../../src/amazon-customer-fonts.js";

function matchesRule(match, lineIndex) {
  if (match?.type === "first") return lineIndex === 0;
  if (match?.type === "remaining") return lineIndex > 0;
  if (match?.type === "index") return lineIndex === Number(match.lineIndex);
  return false;
}

function listingAssignment(preset, listingId) {
  const target = String(listingId ?? "").trim();
  return (preset?.listingAssignments || []).find(
    (assignment) => String(assignment?.listingId ?? "").trim() === target,
  ) ?? null;
}

function selectedPreset(snapshot, listingId) {
  const presets = Array.isArray(snapshot?.presets) ? snapshot.presets : [];
  return presets.find((preset) => listingAssignment(preset, listingId))
    ?? presets.find((preset) => preset?.id === snapshot?.defaultPresetId)
    ?? presets[0]
    ?? null;
}

function presetLines(preset, listingId, lineCount) {
  const assignment = listingAssignment(preset, listingId);
  return Array.from({ length: lineCount }, (_, lineIndex) => {
    const ruleSettings = (preset?.lineRules || []).reduce((settings, rule) => (
      matchesRule(rule?.match, lineIndex) ? { ...settings, ...rule.settings } : settings
    ), {});
    const listingSettings = (assignment?.lineOverrides || []).reduce((settings, override) => (
      Number(override?.lineIndex) === lineIndex ? { ...settings, ...override.settings } : settings
    ), {});
    return { ...(preset?.lineDefaults || {}), ...ruleSettings, ...listingSettings };
  });
}

function notifyEnriched(onEnriched, summary) {
  if (typeof onEnriched !== "function") return;
  try {
    Promise.resolve(onEnriched(summary)).catch(() => {});
  } catch {
    // Diagnostics must not affect imports.
  }
}

export function createAmazonItemEnricher({ presetSnapshot, fontOptions = [], onEnriched } = {}) {
  return (item) => {
    const preset = selectedPreset(presetSnapshot, item?.source?.listingId);
    const selections = item?.source?.customerFontSelections;
    if (!preset) {
      const fontSummary = summarizeCustomerFontResolution([], selections, []);
      notifyEnriched(onEnriched, {
        presetId: null,
        designLineCount: 0,
        ...fontSummary,
      });
      return { ...item };
    }
    const lineCount = String(item?.text ?? "").split("\n").length;
    const presetLineSettings = presetLines(preset, item?.source?.listingId, lineCount);
    const lines = overlayCustomerFontsOnLines(
      presetLineSettings,
      selections,
      fontOptions,
    );
    const fontSummary = summarizeCustomerFontResolution(presetLineSettings, selections, fontOptions);
    notifyEnriched(onEnriched, {
      presetId: preset.id,
      designLineCount: lines.length,
      ...fontSummary,
    });
    return {
      ...item,
      presetId: preset.id,
      settings: {
        ...(item?.settings || {}),
        ...(preset.globalDefaults || {}),
        presetId: preset.id,
        lines,
      },
    };
  };
}
