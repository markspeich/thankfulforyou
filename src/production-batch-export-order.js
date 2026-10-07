const importedColorCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function importedColorName(design) {
  return typeof design?.source?.colorName === "string" ? design.source.colorName.trim() : "";
}

export function buildBatchExportSources(designs) {
  const colorCounts = new Map();
  designs.forEach((design) => {
    const colorName = importedColorName(design);
    if (!colorName) return;
    const key = colorName.toLowerCase();
    const quantity = Number.parseInt(String(design?.source?.quantity ?? "").trim(), 10);
    const itemCount = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    colorCounts.set(key, (colorCounts.get(key) || 0) + itemCount);
  });

  return designs.map((design) => {
    if (!design?.source) return {};
    const source = { ...design.source };
    const colorName = importedColorName(design);
    if (!colorName) {
      source.colorName = "";
      return source;
    }
    const count = colorCounts.get(colorName.toLowerCase()) || 0;
    source.colorName = count > 1 ? `${colorName} x${count}` : colorName;
    return source;
  });
}

function importedColorGroup(colorName) {
  if (!colorName) return 3;
  if (/glitter/i.test(colorName)) return 1;
  if (/mirror/i.test(colorName)) return 2;
  return 0;
}

export function sortDesignsByImportedColor(designs) {
  return designs
    .map((design, index) => ({ design, index, colorName: importedColorName(design) }))
    .sort((left, right) => {
      const groupDifference = importedColorGroup(left.colorName) - importedColorGroup(right.colorName);
      if (groupDifference) return groupDifference;
      return importedColorCollator.compare(left.colorName, right.colorName) || left.index - right.index;
    })
    .map(({ design }) => design);
}
