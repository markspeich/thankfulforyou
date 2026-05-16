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
