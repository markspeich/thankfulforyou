export function buildReloadedPresetSettings({
  settings,
  presetId,
  listingId = null,
  normalizeSettings,
  getPresetBaseSettings,
  buildPresetLines,
  createDefaultLineSettings,
  getRawTextLines,
}) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);
  const presetBaseSettings = getPresetBaseSettings(presetId);

  return normalizeSettings({
    ...normalized,
    presetId,
    backingMm: presetBaseSettings.backingMm,
    weldExportedDesign: presetBaseSettings.weldExportedDesign,
    lines: buildPresetLines(presetId, rawLines.length, createDefaultLineSettings, { listingId }),
  });
}
