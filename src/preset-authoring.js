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

function pickLineSettings(line, keys) {
  return keys.reduce((result, key) => {
    if (Object.hasOwn(line, key)) {
      result[key] = line[key];
    }
    return result;
  }, {});
}

function diffLineSettings(base, line) {
  return LINE_SETTING_KEYS.reduce((result, key) => {
    if (line[key] !== base[key]) {
      result[key] = line[key];
    }
    return result;
  }, {});
}

export function buildPresetIdFromName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferPresetDefinitionFromSettings({ name, settings }) {
  const lines = Array.isArray(settings?.lines) ? settings.lines : [];
  const shared = LINE_SETTING_KEYS.reduce((result, key) => {
    const firstValue = lines[0]?.[key];
    if (lines.length > 0 && lines.every((line) => line?.[key] === firstValue)) {
      result[key] = firstValue;
    }
    return result;
  }, {});

  const lineRules = [];
  const firstDiff = diffLineSettings(shared, lines[0] || {});
  if (Object.keys(firstDiff).length > 0) {
    lineRules.push({ match: { kind: "first" }, settings: firstDiff });
  }

  lines.slice(1).forEach((line, index) => {
    const nextDiff = diffLineSettings(shared, line);
    if (Object.keys(nextDiff).length > 0) {
      lineRules.push({
        match: { kind: "index", lineIndex: index + 1 },
        settings: nextDiff,
      });
    }
  });

  return {
    schemaVersion: 1,
    id: buildPresetIdFromName(name),
    name: String(name ?? "").trim(),
    description: "",
    globalDefaults: {
      backingMm: settings?.backingMm,
      weldExportedDesign: settings?.weldExportedDesign,
    },
    lineDefaults: shared,
    lineRules:
      lineRules.length > 0 ? lineRules : [{ match: { kind: "all" }, settings: {} }],
    listingAssignments: [],
  };
}

export function upsertListingAssignment({ preset, assignment }) {
  const listingAssignments = Array.isArray(preset.listingAssignments)
    ? preset.listingAssignments.filter((item) => item.listingId !== assignment.listingId)
    : [];

  return {
    ...preset,
    listingAssignments: [
      ...listingAssignments,
      {
        listingId: assignment.listingId,
        name: assignment.name || "",
        lineOverrides: [],
      },
    ],
  };
}

export function removeListingAssignment({ preset, listingId }) {
  return {
    ...preset,
    listingAssignments: (preset.listingAssignments || []).filter(
      (item) => item.listingId !== listingId,
    ),
  };
}
