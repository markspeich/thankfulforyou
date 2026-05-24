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

function diffLineSettings(base, line) {
  return LINE_SETTING_KEYS.reduce((result, key) => {
    if (line[key] !== base[key]) {
      result[key] = line[key];
    }
    return result;
  }, {});
}

function getReusableLaterDiff(lineDiffs, lineCount) {
  const countsBySignature = new Map();
  let bestEntry = null;

  lineDiffs.slice(1).forEach((diff, index) => {
    if (Object.keys(diff).length === 0) {
      return;
    }

    const signature = JSON.stringify(diff);
    const entry = countsBySignature.get(signature) || {
      diff,
      count: 0,
      firstIndex: index + 1,
    };

    entry.count += 1;
    countsBySignature.set(signature, entry);

    if (
      !bestEntry ||
      entry.count > bestEntry.count ||
      (entry.count === bestEntry.count && entry.firstIndex < bestEntry.firstIndex)
    ) {
      bestEntry = entry;
    }
  });

  if (lineCount === 2) {
    return bestEntry?.diff || {};
  }

  if (!bestEntry || bestEntry.count < 2) {
    return {};
  }

  return bestEntry?.diff || {};
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
  const lineDiffs = lines.map((line) => diffLineSettings(shared, line || {}));
  const reusableLaterDiff = lines.length > 1 ? getReusableLaterDiff(lineDiffs, lines.length) : {};

  const lineRules = [];
  const firstDiff = diffLineSettings(shared, lines[0] || {});
  if (Object.keys(firstDiff).length > 0) {
    lineRules.push({ match: { kind: "first" }, settings: firstDiff });
  }

  if (Object.keys(reusableLaterDiff).length > 0) {
    lineRules.push({ match: { kind: "remaining" }, settings: reusableLaterDiff });
  }

  lines.slice(1).forEach((line, index) => {
    const nextDiff = lineDiffs[index + 1] || {};
    if (
      Object.keys(nextDiff).length > 0 &&
      JSON.stringify(nextDiff) !== JSON.stringify(reusableLaterDiff)
    ) {
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
  const existingAssignments = Array.isArray(preset.listingAssignments)
    ? preset.listingAssignments
    : [];
  const existingAssignment = existingAssignments.find(
    (item) => item.listingId === assignment.listingId,
  );
  const existingIndex = existingAssignments.findIndex(
    (item) => item.listingId === assignment.listingId,
  );
  const listingOverrides = Array.isArray(assignment.lineOverrides)
    ? assignment.lineOverrides
    : existingAssignment?.lineOverrides || [];
  const nextAssignment = {
    ...existingAssignment,
    ...assignment,
    listingId: assignment.listingId,
    name: assignment.name || existingAssignment?.name || "",
    lineOverrides: listingOverrides,
  };

  return {
    ...preset,
    listingAssignments:
      existingIndex === -1
        ? [...existingAssignments, nextAssignment]
        : existingAssignments.map((item, index) => (index === existingIndex ? nextAssignment : item)),
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
