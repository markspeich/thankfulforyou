const MM_PER_INCH = 25.4;

export const DEFAULT_BOUNDING_SIZE_PRESET_ID = "size-2-2x1-5";

const BUILT_IN_BOUNDING_SIZE_PRESETS = Object.freeze([
  {
    id: DEFAULT_BOUNDING_SIZE_PRESET_ID,
    label: "2.2 x 1.5 in",
    max: { widthIn: 2.2, heightIn: 1.5 },
    min: { widthIn: 1.6, heightIn: 1.1 },
    circleDiameterIn: 1.25,
  },
]);
const BUILT_IN_BOUNDING_SIZE_PRESET_IDS = new Set(BUILT_IN_BOUNDING_SIZE_PRESETS.map((preset) => preset.id));

let boundingSizePresets = normalizeBoundingSizePresetDefinitions();

function toMm(inches) {
  return Number(inches) * MM_PER_INCH;
}

function cloneDefinition(definition) {
  const clone = {
    id: definition.id,
    label: definition.label,
    max: { ...definition.max },
    min: { ...definition.min },
  };

  if (Number.isFinite(definition.circleDiameterIn)) {
    clone.circleDiameterIn = definition.circleDiameterIn;
  }

  return clone;
}

function assertPositiveNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }

  return numeric;
}

function isBlankValue(value) {
  return value === undefined || value === null || value === "";
}

function assertOptionalPositiveNumber(value, fallback, fieldName) {
  if (isBlankValue(value)) {
    return fallback;
  }

  return assertPositiveNumber(value, fieldName);
}

function resolveDefinition(definition) {
  const circleDiameterIn = Number.isFinite(definition.circleDiameterIn) ? definition.circleDiameterIn : null;

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
    circleDiameterIn,
    circleDiameterMm: circleDiameterIn === null ? null : toMm(circleDiameterIn),
  };
}

export function normalizeBoundingSizePresetDefinition(definition = {}) {
  const id = String(definition.id ?? "").trim();
  const label = String(definition.label ?? "").trim();
  const maxWidthIn = assertPositiveNumber(definition.max?.widthIn, "Maximum width");
  const maxHeightIn = assertPositiveNumber(definition.max?.heightIn, "Maximum height");
  const minWidthIn = assertOptionalPositiveNumber(definition.min?.widthIn, maxWidthIn, "Minimum width");
  const minHeightIn = assertOptionalPositiveNumber(definition.min?.heightIn, maxHeightIn, "Minimum height");

  if (!/^size-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Size guide id must start with size- and contain only lowercase letters, numbers, and hyphens.");
  }
  if (!label) {
    throw new Error("Size guide name is required.");
  }
  if (minWidthIn > maxWidthIn) {
    throw new Error("Minimum width cannot be larger than maximum width.");
  }
  if (minHeightIn > maxHeightIn) {
    throw new Error("Minimum height cannot be larger than maximum height.");
  }

  const normalized = {
    id,
    label,
    max: { widthIn: maxWidthIn, heightIn: maxHeightIn },
    min: { widthIn: minWidthIn, heightIn: minHeightIn },
  };

  if (definition.circleDiameterIn !== undefined && definition.circleDiameterIn !== null && definition.circleDiameterIn !== "") {
    normalized.circleDiameterIn = assertPositiveNumber(definition.circleDiameterIn, "Circle diameter");
  }

  return normalized;
}

export function normalizeBoundingSizePresetDefinitions(definitions = []) {
  const normalizedById = new Map(
    BUILT_IN_BOUNDING_SIZE_PRESETS.map((preset) => [preset.id, normalizeBoundingSizePresetDefinition(preset)]),
  );

  definitions.forEach((definition) => {
    const normalized = normalizeBoundingSizePresetDefinition(definition);
    normalizedById.set(normalized.id, normalized);
  });

  return [...normalizedById.values()];
}

export function setBoundingSizePresetDefinitions(definitions = []) {
  boundingSizePresets = normalizeBoundingSizePresetDefinitions(definitions);
}

export function setBoundingSizePresetDefinitionsForTests(definitions = []) {
  setBoundingSizePresetDefinitions(definitions);
}

export function getBoundingSizePresetDefinitions() {
  return boundingSizePresets.map((preset) => cloneDefinition(preset));
}

export function getBoundingSizePresetOptions() {
  return boundingSizePresets.map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
}

export function isValidBoundingSizePresetId(presetId) {
  return boundingSizePresets.some((preset) => preset.id === presetId);
}

export function isBuiltInBoundingSizePresetId(presetId) {
  return BUILT_IN_BOUNDING_SIZE_PRESET_IDS.has(presetId);
}

export function resolveBoundingSizePreset(presetId) {
  const definition = boundingSizePresets.find((preset) => preset.id === presetId)
    || boundingSizePresets.find((preset) => preset.id === DEFAULT_BOUNDING_SIZE_PRESET_ID);

  return resolveDefinition(definition);
}
