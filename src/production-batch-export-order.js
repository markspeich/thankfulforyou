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
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
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

export function sortDesignsByImportedColor(designs) {
  return designs
    .map((design, index) => ({ design, index, colorName: importedColorName(design) }))
    .sort((left, right) => {
      if (!left.colorName && !right.colorName) return left.index - right.index;
      if (!left.colorName) return 1;
      if (!right.colorName) return -1;
      return importedColorCollator.compare(left.colorName, right.colorName) || left.index - right.index;
    })
    .map(({ design }) => design);
}
