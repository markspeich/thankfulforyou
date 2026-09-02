function normalizeUnsupportedCharacters(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item.character === "string" && item.character)
    : [];
}

export function formatUnsupportedCharacters(value) {
  const items = normalizeUnsupportedCharacters(value);
  if (!items.length) return "";

  const details = items.map((item) => {
    const fontName = item.fontName || item.fontId || "Selected font";
    const line = Number.isFinite(Number(item.lineNumber)) ? ` on Line ${Number(item.lineNumber)}` : "";
    return `${fontName} is missing “${item.character}”${line}`;
  });

  return `${details.join("; ")}. Export remains available; correct ${items.length === 1 ? "this character" : "these characters"} in LightBurn.`;
}

export function buildFontCoverageSummary(value, analysis = {}) {
  const detail = formatUnsupportedCharacters(value);
  if (!detail) return null;

  const pieceCount = Number.isFinite(Number(analysis.connectedComponentCount))
    ? Math.max(0, Number(analysis.connectedComponentCount))
    : 0;
  const connectedness = analysis.isConnected
    ? "Connectedness: 1 face piece."
    : `Connectedness: ${pieceCount || "multiple"} face pieces.`;

  return {
    state: "warning",
    shortLabel: "!",
    fullLabel: `Manual font review: ${detail} ${connectedness}`,
  };
}
