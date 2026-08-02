import {
  overlayCustomerFontsOnLines,
  summarizeCustomerFontResolution,
} from "../../src/amazon-customer-fonts.js";

const DEFAULT_PERSISTED_FONT_ID = "candlepin";

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

export function createAmazonItemEnricher({ presetSnapshot, fontOptions = [], onEnriched, diagnostics } = {}) {
  const enrich = (item, { onEnriched: onCallEnriched } = {}) => {
    const preset = selectedPreset(presetSnapshot, item?.source?.listingId);
    const selections = item?.source?.customerFontSelections;
    if (!preset) {
      const lineCount = String(item?.text ?? "").split(/\r?\n/).length;
      const persistenceLines = Array.from({ length: Math.max(lineCount, 1) }, () => ({
        fontId: DEFAULT_PERSISTED_FONT_ID,
      }));
      const fontSummary = summarizeCustomerFontResolution(persistenceLines, selections, fontOptions);
      const summary = {
        presetId: null,
        designLineCount: persistenceLines.length,
        ...fontSummary,
        effectiveFontIds: persistenceLines.map((line) => line.fontId),
      };
      notifyEnriched(onEnriched, summary);
      notifyEnriched(onCallEnriched, summary);
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
    const summary = {
      presetId: preset.id,
      designLineCount: lines.length,
      ...fontSummary,
    };
    notifyEnriched(onEnriched, summary);
    notifyEnriched(onCallEnriched, summary);
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
  enrich.supportsPerCallEnrichmentSummary = true;
  enrich.diagnostics = diagnostics;
  return enrich;
}
