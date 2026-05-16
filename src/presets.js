export const PRESET_OPTIONS = [
  {
    id: "all-candlepin",
    label: "All Candlepin",
  },
  {
    id: "skywalk-somekind",
    label: "Skywalk, Somekind",
  },
  {
    id: "skywalk-candlepin",
    label: "Skywalk, Candlepin",
  },
];

export const DEFAULT_PRESET_ID = PRESET_OPTIONS[0].id;
export const LISTING_PRESET_MAP = Object.freeze({
  "1884223710": "skywalk-somekind",
  "4465975709": "skywalk-candlepin",
});

export function getPresetIdForListingId(listingId) {
  const mappedPresetId = LISTING_PRESET_MAP[String(listingId ?? "")];
  return PRESET_OPTIONS.some((preset) => preset.id === mappedPresetId)
    ? mappedPresetId
    : DEFAULT_PRESET_ID;
}

export function hasPresetMappingForListingId(listingId) {
  return PRESET_OPTIONS.some((preset) => preset.id === LISTING_PRESET_MAP[String(listingId ?? "")]);
}

export function getPresetFontIdForLine(presetId, lineIndex) {
  switch (presetId) {
    case "skywalk-somekind":
      return lineIndex === 0 ? "skywalk" : "somekind";
    case "skywalk-candlepin":
      return lineIndex === 0 ? "skywalk" : "candlepin";
    case "all-candlepin":
    default:
      return "candlepin";
  }
}

export function buildPresetLines(presetId, lineCount, createLineSettings) {
  return Array.from({ length: lineCount }, (_, lineIndex) => ({
    ...createLineSettings(),
    fontId: getPresetFontIdForLine(presetId, lineIndex),
  }));
}
