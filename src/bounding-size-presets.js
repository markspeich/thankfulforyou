const MM_PER_INCH = 25.4;

export const DEFAULT_BOUNDING_SIZE_PRESET_ID = "size-2-2x1-5";

const BOUNDING_SIZE_PRESETS = Object.freeze([
  {
    id: DEFAULT_BOUNDING_SIZE_PRESET_ID,
    label: "2.2 x 1.5 in",
    max: { widthIn: 2.2, heightIn: 1.5 },
    min: { widthIn: 1.6, heightIn: 1.1 },
  },
]);

function toMm(inches) {
  return Number(inches) * MM_PER_INCH;
}

function resolveDefinition(definition) {
  return {
    id: definition.id,
    label: definition.label,
    maxWidthMm: toMm(definition.max.widthIn),
    maxHeightMm: toMm(definition.max.heightIn),
    minWidthMm: toMm(definition.min.widthIn),
    minHeightMm: toMm(definition.min.heightIn),
    maxWidthIn: definition.max.widthIn,
    maxHeightIn: definition.max.heightIn,
    minWidthIn: definition.min.widthIn,
    minHeightIn: definition.min.heightIn,
  };
}

export function getBoundingSizePresetOptions() {
  return BOUNDING_SIZE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
}

export function isValidBoundingSizePresetId(presetId) {
  return BOUNDING_SIZE_PRESETS.some((preset) => preset.id === presetId);
}

export function resolveBoundingSizePreset(presetId) {
  const definition = BOUNDING_SIZE_PRESETS.find((preset) => preset.id === presetId)
    || BOUNDING_SIZE_PRESETS.find((preset) => preset.id === DEFAULT_BOUNDING_SIZE_PRESET_ID);

  return resolveDefinition(definition);
}
