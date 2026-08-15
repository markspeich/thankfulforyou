function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomerFontAlias(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

function aliasesForFontValue(value) {
  const normalized = normalizeCustomerFontAlias(value);
  if (!normalized) return [];
  const withoutLaserSuffix = normalized.replace(/\s*[-–—]?\s*laser$/, "").trim();
  return withoutLaserSuffix && withoutLaserSuffix !== normalized
    ? [normalized, withoutLaserSuffix]
    : [normalized];
}

function statusForFont(font) {
  if (font?.deletedAt) return "deleted";
  if (font?.archivedAt) return "archived";
  return "active";
}

function resolutionForFont(font, alias = null) {
  if (!font) return null;
  const status = statusForFont(font);
  return {
    fontId: status === "active" ? clean(font.id) || null : null,
    font,
    alias,
    status,
  };
}

export function normalizeCustomerFontSelections(selections) {
  if (!Array.isArray(selections)) return [];
  const byLine = new Map();
  for (const selection of selections) {
    const lineIndex = Number(selection?.lineIndex);
    const name = clean(selection?.name);
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || !name || byLine.has(lineIndex)) continue;
    byLine.set(lineIndex, { lineIndex, name });
  }
  return [...byLine.values()].sort((left, right) => left.lineIndex - right.lineIndex);
}

export function resolveCustomerFont(name, fontOptions = [], fontAliases = []) {
  const requested = normalizeCustomerFontAlias(name);
  const fonts = Array.isArray(fontOptions) ? fontOptions : [];
  if (!requested) return null;

  for (const alias of Array.isArray(fontAliases) ? fontAliases : []) {
    const aliasName = normalizeCustomerFontAlias(alias?.normalizedAlias) || normalizeCustomerFontAlias(alias?.aliasName);
    if (aliasName !== requested) continue;
    const font = fonts.find((option) => clean(option?.id) === clean(alias?.fontId));
    return resolutionForFont(font, alias);
  }

  for (const font of fonts) {
    const aliases = [font?.id, font?.label, font?.displayName]
      .flatMap(aliasesForFontValue);
    if (aliases.includes(requested)) return resolutionForFont(font);
  }
  return null;
}

export function resolveCustomerFontId(name, fontOptions = [], fontAliases = []) {
  return resolveCustomerFont(name, fontOptions, fontAliases)?.fontId ?? null;
}

export function overlayCustomerFontsOnLines(lines, selections, fontOptions, fontAliases = []) {
  const normalized = normalizeCustomerFontSelections(selections);
  const fontByLine = new Map(normalized.map((selection) => [
    selection.lineIndex,
    resolveCustomerFontId(selection.name, fontOptions, fontAliases),
  ]));
  return (Array.isArray(lines) ? lines : []).map((line, lineIndex) => {
    const current = line && typeof line === "object" ? line : {};
    const fontId = fontByLine.get(lineIndex);
    return fontId && fontId !== current.fontId ? { ...current, fontId } : { ...current };
  });
}

export function summarizeCustomerFontResolution(lines, selections, fontOptions, fontAliases = []) {
  const normalized = normalizeCustomerFontSelections(selections);
  const materializedLineCount = Array.isArray(lines) ? lines.length : 0;
  const materializedSelections = normalized.filter((selection) => selection.lineIndex < materializedLineCount);
  const recognizedCount = materializedSelections.filter((selection) => (
    resolveCustomerFontId(selection.name, fontOptions, fontAliases) !== null
  )).length;
  const effectiveFontIds = overlayCustomerFontsOnLines(lines, normalized, fontOptions, fontAliases)
    .map((line) => clean(line?.fontId))
    .filter(Boolean);
  return {
    selectionCount: normalized.length,
    recognizedCount,
    unknownCount: materializedSelections.length - recognizedCount,
    pendingCount: normalized.length - materializedSelections.length,
    effectiveFontIds,
  };
}

export function formatCustomerFontSelection(selection) {
  const [normalized] = normalizeCustomerFontSelections([selection]);
  return normalized ? `Line ${normalized.lineIndex + 1} Font: ${normalized.name}` : "";
}
