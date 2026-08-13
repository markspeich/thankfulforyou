function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function key(value) {
  return clean(value).toLowerCase();
}

const CUSTOMER_FONT_NAME_ALIASES = new Map([
  ["super boy", "super boys"],
]);

function aliasesForFontValue(value) {
  const normalized = key(value);
  if (!normalized) return [];
  const withoutLaserSuffix = normalized.replace(/\s*[-–—]?\s*laser$/, "").trim();
  return withoutLaserSuffix && withoutLaserSuffix !== normalized
    ? [normalized, withoutLaserSuffix]
    : [normalized];
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

export function resolveCustomerFontId(name, fontOptions = []) {
  const requested = CUSTOMER_FONT_NAME_ALIASES.get(key(name)) ?? key(name);
  if (!requested) return null;
  for (const font of Array.isArray(fontOptions) ? fontOptions : []) {
    const aliases = [font?.id, font?.label, font?.displayName]
      .flatMap(aliasesForFontValue);
    if (aliases.includes(requested)) return clean(font?.id) || null;
  }
  return null;
}

export function overlayCustomerFontsOnLines(lines, selections, fontOptions) {
  const normalized = normalizeCustomerFontSelections(selections);
  const fontByLine = new Map(normalized.map((selection) => [
    selection.lineIndex,
    resolveCustomerFontId(selection.name, fontOptions),
  ]));
  return (Array.isArray(lines) ? lines : []).map((line, lineIndex) => {
    const current = line && typeof line === "object" ? line : {};
    const fontId = fontByLine.get(lineIndex);
    return fontId && fontId !== current.fontId ? { ...current, fontId } : { ...current };
  });
}

export function summarizeCustomerFontResolution(lines, selections, fontOptions) {
  const normalized = normalizeCustomerFontSelections(selections);
  const recognizedCount = normalized.filter((selection) => (
    resolveCustomerFontId(selection.name, fontOptions) !== null
  )).length;
  const effectiveFontIds = overlayCustomerFontsOnLines(lines, normalized, fontOptions)
    .map((line) => clean(line?.fontId))
    .filter(Boolean);
  return {
    selectionCount: normalized.length,
    recognizedCount,
    unknownCount: normalized.length - recognizedCount,
    effectiveFontIds,
  };
}

export function formatCustomerFontSelection(selection) {
  const [normalized] = normalizeCustomerFontSelections([selection]);
  return normalized ? `Line ${normalized.lineIndex + 1} Font: ${normalized.name}` : "";
}
