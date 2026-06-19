export function buildReloadedPresetSettings({
  settings,
  presetId,
  listingId = null,
  fixedDesignText = null,
  normalizeSettings,
  getPresetBaseSettings,
  buildPresetLines,
  getPresetFixedItems = () => [],
  createDefaultLineSettings,
  getRawTextLines,
}) {
  const normalized = normalizeSettings(settings);
  const nextText = typeof fixedDesignText === "string" && fixedDesignText.trim()
    ? fixedDesignText
    : normalized.text;
  const rawLines = getRawTextLines(nextText);
  const presetBaseSettings = getPresetBaseSettings(presetId);

  return normalizeSettings({
    ...normalized,
    text: nextText,
    presetId,
    boundingSizePresetId: presetBaseSettings.boundingSizePresetId,
    backingMm: presetBaseSettings.backingMm,
    weldExportedDesign: presetBaseSettings.weldExportedDesign,
    lines: [
      ...buildPresetLines(presetId, rawLines.length, createDefaultLineSettings, { listingId }),
      ...getPresetFixedItems(presetId),
    ],
  });
}

