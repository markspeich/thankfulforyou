export function getRenderableTextLines(text = "") {
  if (typeof text !== "string" || !text.length) {
    return [];
  }

  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
