const FALLBACK_PRESET_DEFINITIONS = [
  {
    schemaVersion: 1,
    id: "all-candlepin",
    name: "All Candlepin",
    globalDefaults: {
      backingMm: 2.2,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
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
    id: "skywalk-somekind",
    name: "Skywalk, Somekind",
    globalDefaults: {
      backingMm: 2.2,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
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
    id: "skywalk-candlepin",
    name: "Skywalk, Candlepin",
    globalDefaults: {
      backingMm: 2.2,
      weldExportedDesign: true,
    },
    lineDefaults: {
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
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
  defaultPresetId: "all-candlepin",
};

const PRESET_MANIFEST_URL = "public/presets/manifest.json";
const ALLOWED_LINE_SETTINGS = [
  "fontId",
  "bridgeMm",
  "lineBridgeMm",
  "offsetXMm",
  "fontSizeMm",
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
  return {
    schemaVersion: Number.isInteger(definition.schemaVersion) ? definition.schemaVersion : 1,
    id: String(definition.id ?? "").trim(),
    name: typeof definition.name === "string" ? definition.name.trim() : "",
    description: typeof definition.description === "string" ? definition.description.trim() : "",
    globalDefaults: definition.globalDefaults && typeof definition.globalDefaults === "object"
      ? {
          ...(Object.hasOwn(definition.globalDefaults, "backingMm") ? { backingMm: definition.globalDefaults.backingMm } : {}),
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
    : normalizedDefinitions[0]?.id || "all-candlepin";
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

export async function loadPresetRegistry(manifestUrl = PRESET_MANIFEST_URL) {
  try {
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

    const nextRegistry = createPresetRegistry(manifest, presetDefinitions);
    if (!nextRegistry.options.length) {
      throw new Error("No preset definitions were loaded");
    }

    presetRegistry = nextRegistry;
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
