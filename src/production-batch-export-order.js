const importedColorCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function importedColorName(design) {
  return typeof design?.source?.colorName === "string" ? design.source.colorName.trim() : "";
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
