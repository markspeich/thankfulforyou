const GLOBAL_SETTING_KEYS = [
  "presetId",
  "boundingSizePresetId",
  "backingMm",
  "weldExportedDesign",
];

const LINE_SETTING_KEYS = [
  "fontId",
  "bridgeMm",
  "lineBridgeMm",
  "offsetXMm",
  "fontSizeMm",
  "horizontalScale",
  "verticalScale",
  "lockTextHeight",
];

const FIXED_SVG_LINE_SETTING_KEYS = [
  "kind",
  "fixedDesignId",
  "fixedDesignName",
  "fixedDesignVersion",
  "svgSizeMm",
  "offsetXMm",
  "offsetYMm",
  "backingBorder",
];

function normalizeLines(lines) {
  return Array.isArray(lines) ? lines : [];
}

function pickFields(source = {}, keys = []) {
  const normalizedSource = source != null && typeof source === "object" ? source : {};

  return keys.reduce((result, key) => {
    if (Object.hasOwn(normalizedSource, key)) {
      result[key] = normalizedSource[key];
    }

    return result;
  }, {});
}

function getLineSettingKeys(line = {}) {
  return line?.kind === "fixedSvg" ? FIXED_SVG_LINE_SETTING_KEYS : LINE_SETTING_KEYS;
}

function buildSnapshotSettings(settings = {}) {
  return {
    ...pickFields(settings, GLOBAL_SETTING_KEYS),
    lines: normalizeLines(settings.lines).map((line) => pickFields(line, getLineSettingKeys(line))),
  };
}

export function buildLayoutControlsSnapshot(order = {}) {
  return {
    sourceOrderId: order.id ?? null,
    sourceOrderLabel: order.label ?? null,
    settings: buildSnapshotSettings(order.settings),
  };
}

export function applyLayoutControlsSnapshot(targetSettings = {}, snapshot = {}) {
  const sourceSettings = snapshot?.settings ?? {};
  const targetLines = normalizeLines(targetSettings.lines);
  const sourceLines = normalizeLines(sourceSettings.lines);
  const settings = {
    ...targetSettings,
    ...pickFields(sourceSettings, GLOBAL_SETTING_KEYS),
    lines: targetLines.map((line, index) => (
      index < sourceLines.length
        ? {
            ...pickFields(line, Object.keys(line ?? {})),
            ...pickFields(sourceLines[index], getLineSettingKeys(sourceLines[index])),
          }
        : { ...pickFields(line, Object.keys(line ?? {})) }
    )),
  };

  return {
    settings,
    appliedLineCount: Math.min(targetLines.length, sourceLines.length),
  };
}
