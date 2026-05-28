const FALLBACK_PRESET_DEFINITIONS = [
  {
    schemaVersion: 1,
    id: "preset-a1f4c8e2b601",
    name: "All Candlepin",
    globalDefaults: {
      backingMm: 3.1,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    lineRules: [
      {
        match: {
          kind: "all",
        },
        settings: {
          fontId: "candlepin",
        },
      },
    ],
    listingAssignments: [],
  },
  {
    schemaVersion: 1,
    id: "preset-b7d2e9f4c318",
    name: "Candlepin, Skywalk",
    globalDefaults: {
      backingMm: 3.1,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    lineRules: [
      {
        match: {
          kind: "first",
        },
        settings: {
          fontId: "candlepin",
        },
      },
      {
        match: {
          kind: "remaining",
        },
        settings: {
          fontId: "skywalk",
        },
      },
    ],
    listingAssignments: [
      {
        listingId: "4439916732",
        name: "Candlepin + Skywalk listing with taller first line",
        lineOverrides: [
          {
            lineIndex: 0,
            settings: {
              fontSizeMm: 44,
            },
          },
        ],
      },
    ],
  },
  {
    schemaVersion: 1,
    id: "preset-c3e8a1d7f520",
    name: "Skywalk, Somekind",
    globalDefaults: {
      backingMm: 3.1,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    lineRules: [
      {
        match: {
          kind: "first",
        },
        settings: {
          fontId: "skywalk",
          fontSizeMm: 18,
        },
      },
      {
        match: {
          kind: "remaining",
        },
        settings: {
          fontId: "somekind",
        },
      },
      {
        match: {
          kind: "index",
          lineIndex: 1,
        },
        settings: {
          fontSizeMm: 23,
          lockTextHeight: true,
        },
      },
    ],
    listingAssignments: [
      {
        listingId: "1884223710",
        name: "Skywalk + Somekind listing with shorter second line",
        lineOverrides: [
          {
            lineIndex: 1,
            settings: {
              fontSizeMm: 23,
            },
          },
        ],
      },
    ],
  },
  {
    schemaVersion: 1,
    id: "preset-d9b4f2a6c731",
    name: "Skywalk, Candlepin",
    globalDefaults: {
      backingMm: 3.1,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    lineRules: [
      {
        match: {
          kind: "first",
        },
        settings: {
          fontId: "skywalk",
        },
      },
      {
        match: {
          kind: "remaining",
        },
        settings: {
          fontId: "candlepin",
        },
      },
    ],
    listingAssignments: [
      {
        listingId: "4465975709",
        name: "Skywalk + Candlepin listing with shorter second line",
        lineOverrides: [
          {
            lineIndex: 1,
            settings: {
              fontSizeMm: 21,
            },
          },
        ],
      },
    ],
  },
];

const FALLBACK_MANIFEST = {
  defaultPresetId: "preset-a1f4c8e2b601",
};

const PRESET_MANIFEST_URL = "public/presets/manifest.json";
const PRESET_STORAGE_KEY = "thankfulforyou.presetSnapshot";
const PRESET_SNAPSHOT_VERSION = 1;
const CURRENT_DEFAULT_BACKING_MM = 3.1;
const LEGACY_DEFAULT_BACKING_MM = 2.2;
const BUILT_IN_PRESET_IDS = new Set(FALLBACK_PRESET_DEFINITIONS.map((definition) => definition.id));
const ALLOWED_LINE_SETTINGS = [
  "fontId",
  "bridgeMm",
  "lineBridgeMm",
  "offsetXMm",
  "fontSizeMm",
  "horizontalScale",
  "verticalScale",
  "lockTextHeight",
];

let presetRegistry = createPresetRegistry(FALLBACK_MANIFEST, FALLBACK_PRESET_DEFINITIONS);

function sanitizeLineSettings(settings = {}) {
  const next = {};

  ALLOWED_LINE_SETTINGS.forEach((key) => {
    if (Object.hasOwn(settings, key)) {
      next[key] = settings[key];
    }
  });

  return next;
}

function normalizeListingAssignments(listingAssignments = []) {
  return listingAssignments
    .filter((assignment) => assignment && typeof assignment === "object")
    .map((assignment) => ({
      listingId: String(assignment.listingId ?? "").trim(),
      name: typeof assignment.name === "string" ? assignment.name : "",
      lineOverrides: Array.isArray(assignment.lineOverrides)
        ? assignment.lineOverrides
          .filter((override) => override && typeof override === "object")
          .map((override) => ({
            lineIndex: Number.isInteger(override.lineIndex) ? override.lineIndex : Number(override.lineIndex),
            settings: sanitizeLineSettings(override.settings),
          }))
          .filter((override) => Number.isInteger(override.lineIndex) && override.lineIndex >= 0)
        : [],
    }))
    .filter((assignment) => assignment.listingId);
}

function normalizePresetDefinition(definition = {}) {
  const presetId = String(definition.id ?? "").trim();
  const backingMm = definition.globalDefaults?.backingMm;
  const migratedBackingMm = BUILT_IN_PRESET_IDS.has(presetId) && Number(backingMm) === LEGACY_DEFAULT_BACKING_MM
    ? CURRENT_DEFAULT_BACKING_MM
    : backingMm;

  return {
    schemaVersion: Number.isInteger(definition.schemaVersion) ? definition.schemaVersion : 1,
    id: presetId,
    name: typeof definition.name === "string" ? definition.name.trim() : "",
    description: typeof definition.description === "string" ? definition.description.trim() : "",
    globalDefaults: definition.globalDefaults && typeof definition.globalDefaults === "object"
      ? {
          ...(Object.hasOwn(definition.globalDefaults, "backingMm") ? { backingMm: migratedBackingMm } : {}),
          ...(Object.hasOwn(definition.globalDefaults, "weldExportedDesign")
            ? { weldExportedDesign: definition.globalDefaults.weldExportedDesign }
            : {}),
        }
      : {},
    lineDefaults: sanitizeLineSettings(definition.lineDefaults),
    lineRules: Array.isArray(definition.lineRules)
      ? definition.lineRules
        .filter((rule) => rule && typeof rule === "object")
        .map((rule) => ({
          match: rule.match && typeof rule.match === "object"
            ? {
                kind: typeof rule.match.kind === "string" ? rule.match.kind : "all",
                ...(Object.hasOwn(rule.match, "lineIndex") ? { lineIndex: rule.match.lineIndex } : {}),
              }
            : { kind: "all" },
          settings: sanitizeLineSettings(rule.settings),
        }))
      : [],
    listingAssignments: normalizeListingAssignments(definition.listingAssignments),
  };
}

function createPresetRegistry(manifest = {}, presetDefinitions = []) {
  const normalizedDefinitions = presetDefinitions
    .map((definition) => normalizePresetDefinition(definition))
    .filter((definition) => definition.id && definition.name);
  const presetById = new Map(normalizedDefinitions.map((definition) => [definition.id, definition]));
  const options = normalizedDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.name,
  }));
  const defaultPresetId = presetById.has(manifest.defaultPresetId)
    ? manifest.defaultPresetId
    : normalizedDefinitions[0]?.id || "preset-a1f4c8e2b601";
  const listingAssignmentMap = new Map();

  normalizedDefinitions.forEach((definition) => {
    definition.listingAssignments.forEach((assignment) => {
      listingAssignmentMap.set(assignment.listingId, {
        presetId: definition.id,
        ...assignment,
      });
    });
  });

  return {
    defaultPresetId,
    options,
    presetById,
    listingAssignmentMap,
  };
}

function buildPresetSnapshot(manifest = {}, presetDefinitions = []) {
  const normalizedDefinitions = presetDefinitions
    .map((definition) => normalizePresetDefinition(definition))
    .filter((definition) => definition.id && definition.name);
  const defaultPresetId = normalizedDefinitions.some((definition) => definition.id === manifest.defaultPresetId)
    ? manifest.defaultPresetId
    : normalizedDefinitions[0]?.id || "preset-a1f4c8e2b601";

  return {
    version: PRESET_SNAPSHOT_VERSION,
    defaultPresetId,
    presets: normalizedDefinitions,
  };
}

function createPresetRegistryFromSnapshot(snapshot = null) {
  if (!snapshot || snapshot.version !== PRESET_SNAPSHOT_VERSION || !Array.isArray(snapshot.presets)) {
    return null;
  }

  return createPresetRegistry(
    { defaultPresetId: snapshot.defaultPresetId },
    snapshot.presets,
  );
}

function getPresetDefinition(presetId) {
  return presetRegistry.presetById.get(presetId) || presetRegistry.presetById.get(presetRegistry.defaultPresetId) || null;
}

function matchesLineRule(match = {}, lineIndex) {
  switch (match.kind) {
    case "first":
      return lineIndex === 0;
    case "remaining":
      return lineIndex > 0;
    case "index":
      return Number(match.lineIndex) === lineIndex;
    case "all":
    default:
      return true;
  }
}

function getListingAssignment(listingId) {
  return presetRegistry.listingAssignmentMap.get(String(listingId ?? "")) || null;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  return response.json();
}

function readPersistedPresetSnapshot() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && parsed.version === PRESET_SNAPSHOT_VERSION && Array.isArray(parsed.presets)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistPresetSnapshot(snapshot) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore local storage failures and continue with the in-memory registry.
  }
}

async function loadBundledPresetSnapshot(manifestUrl = PRESET_MANIFEST_URL) {
  const manifest = await loadJson(manifestUrl);
  const presetEntries = Array.isArray(manifest?.presets) ? manifest.presets : [];
  const presetDefinitions = await Promise.all(
    presetEntries.map(async (entry) => {
      if (entry && typeof entry === "object" && typeof entry.path === "string") {
        const definition = await loadJson(entry.path);
        if (typeof entry.id === "string" && entry.id.trim() && definition.id !== entry.id) {
          throw new Error(`Preset id mismatch for ${entry.path}`);
        }
        return definition;
      }

      return entry;
    }),
  );

  return buildPresetSnapshot(manifest, presetDefinitions);
}

export async function loadPresetRegistry(manifestUrl = PRESET_MANIFEST_URL) {
  const persistedSnapshot = readPersistedPresetSnapshot();
  const persistedRegistry = createPresetRegistryFromSnapshot(persistedSnapshot);

  if (persistedRegistry?.options.length) {
    presetRegistry = persistedRegistry;
    return presetRegistry;
  }

  try {
    const { fetchRemotePresetSnapshot } = await import("./preset-api.js");
    const remoteSnapshot = await fetchRemotePresetSnapshot();
    const remoteRegistry = createPresetRegistryFromSnapshot(remoteSnapshot);

    if (remoteRegistry?.options.length) {
      presetRegistry = remoteRegistry;
      persistPresetSnapshot(remoteSnapshot);
      return presetRegistry;
    }
  } catch (error) {
    console.warn("Unable to load remote preset snapshot. Falling back to bundled presets.", error);
  }

  try {
    const bundledSnapshot = await loadBundledPresetSnapshot(manifestUrl);
    const bundledRegistry = createPresetRegistryFromSnapshot(bundledSnapshot);

    if (!bundledRegistry?.options.length) {
      throw new Error("No preset definitions were loaded");
    }

    presetRegistry = bundledRegistry;
  } catch (error) {
    console.warn("Falling back to built-in preset registry.", error);
  }

  return presetRegistry;
}

export function getPresetOptions() {
  return [...presetRegistry.options];
}

export function getDefaultPresetId() {
  return presetRegistry.defaultPresetId;
}

export function getPresetDefinitionForEditor(presetId) {
  const definition = presetRegistry.presetById.get(presetId);
  return definition ? structuredClone(definition) : null;
}

export function isValidPresetId(presetId) {
  return presetRegistry.presetById.has(presetId);
}

export function getPresetIdForListingId(listingId) {
  const assignment = getListingAssignment(listingId);
  return assignment && isValidPresetId(assignment.presetId)
    ? assignment.presetId
    : getDefaultPresetId();
}

export function hasPresetMappingForListingId(listingId) {
  return Boolean(getListingAssignment(listingId));
}

export function getPresetGlobalDefaults(presetId) {
  return { ...(getPresetDefinition(presetId)?.globalDefaults || {}) };
}

export function getPresetLineOverrides(presetId, lineIndex, listingId = null) {
  const preset = getPresetDefinition(presetId);
  if (!preset) {
    return {};
  }

  const ruleOverrides = preset.lineRules.reduce((settings, rule) => {
    if (!matchesLineRule(rule.match, lineIndex)) {
      return settings;
    }

    return {
      ...settings,
      ...rule.settings,
    };
  }, {});
  const listingAssignment = getListingAssignment(listingId);

  if (!listingAssignment || listingAssignment.presetId !== preset.id) {
    return {
      ...preset.lineDefaults,
      ...ruleOverrides,
    };
  }

  const listingOverrides = listingAssignment.lineOverrides.reduce((settings, override) => {
    if (override.lineIndex !== lineIndex) {
      return settings;
    }

    return {
      ...settings,
      ...override.settings,
    };
  }, {});

  return {
    ...preset.lineDefaults,
    ...ruleOverrides,
    ...listingOverrides,
  };
}

export function buildPresetLines(presetId, lineCount, createLineSettings, options = {}) {
  const { listingId = null } = options;

  return Array.from({ length: lineCount }, (_, lineIndex) => ({
    ...createLineSettings(),
    ...getPresetLineOverrides(presetId, lineIndex, listingId),
  }));
}

export function setPresetRegistryForTests(manifest = FALLBACK_MANIFEST, presetDefinitions = FALLBACK_PRESET_DEFINITIONS) {
  presetRegistry = createPresetRegistry(manifest, presetDefinitions);
}

export function replacePresetDefinitionForTests(definition) {
  const normalized = normalizePresetDefinition(definition);
  const definitions = [...presetRegistry.presetById.values()]
    .filter((item) => item.id !== normalized.id)
    .concat(normalized);
  presetRegistry = createPresetRegistry({ defaultPresetId: presetRegistry.defaultPresetId }, definitions);
}

export function getPresetSnapshot() {
  return buildPresetSnapshot(
    { defaultPresetId: presetRegistry.defaultPresetId },
    [...presetRegistry.presetById.values()],
  );
}

export function savePresetDefinitionLocally({ preset, previousId = null }) {
  const normalizedPreset = normalizePresetDefinition(preset);
  const lookupId = typeof previousId === "string" && previousId.trim()
    ? previousId.trim()
    : normalizedPreset.id;
  const definitions = [...presetRegistry.presetById.values()];
  const existingIndex = definitions.findIndex((definition) => definition.id === lookupId);

  if (existingIndex >= 0) {
    definitions[existingIndex] = normalizedPreset;
  } else {
    definitions.push(normalizedPreset);
  }

  const nextDefaultPresetId = presetRegistry.defaultPresetId === lookupId
    ? normalizedPreset.id
    : presetRegistry.defaultPresetId;
  const snapshot = buildPresetSnapshot(
    { defaultPresetId: nextDefaultPresetId },
    definitions,
  );
  const nextRegistry = createPresetRegistryFromSnapshot(snapshot);

  if (!nextRegistry?.options.length) {
    throw new Error("No preset definitions were loaded");
  }

  presetRegistry = nextRegistry;
  persistPresetSnapshot(snapshot);

  return {
    preset: normalizedPreset,
    snapshot,
  };
}

export function deletePresetDefinitionLocally(presetId) {
  const normalizedPresetId = typeof presetId === "string" ? presetId.trim() : "";
  if (!normalizedPresetId || !presetRegistry.presetById.has(normalizedPresetId)) {
    throw new Error("Preset not found.");
  }

  const definitions = [...presetRegistry.presetById.values()]
    .filter((definition) => definition.id !== normalizedPresetId);

  if (!definitions.length) {
    throw new Error("At least one preset must remain available.");
  }

  const nextDefaultPresetId = presetRegistry.defaultPresetId === normalizedPresetId
    ? definitions[0].id
    : presetRegistry.defaultPresetId;
  const snapshot = buildPresetSnapshot(
    { defaultPresetId: nextDefaultPresetId },
    definitions,
  );
  const nextRegistry = createPresetRegistryFromSnapshot(snapshot);

  if (!nextRegistry?.options.length) {
    throw new Error("No preset definitions were loaded");
  }

  presetRegistry = nextRegistry;
  persistPresetSnapshot(snapshot);

  return {
    deletedPresetId: normalizedPresetId,
    snapshot,
  };
}

export {
  buildPresetIdFromName,
  inferPresetDefinitionFromSettings,
  removeListingAssignment,
  upsertListingAssignment,
} from "./preset-authoring.js";
