export function computeLineMaskMetrics(letters, options) {
  const {
    fontSizeMm,
    verticalScale,
    pixelsPerMm,
    paddingPx,
  } = options;

  if (!Array.isArray(letters) || letters.length === 0) {
    const ascentMm = fontSizeMm * verticalScale;
    return {
      ascentMm,
      descentMm: 0,
      baselinePx: paddingPx + Math.ceil(ascentMm * pixelsPerMm),
      heightPx: Math.ceil(fontSizeMm * 1.35 * verticalScale * pixelsPerMm) + paddingPx * 2,
    };
  }

  const ascentMm = Math.max(...letters.map((letter) => Number(letter.ascentMm) || 0));
  const descentMm = Math.max(...letters.map((letter) => Number(letter.descentMm) || 0));

  return {
    ascentMm,
    descentMm,
    baselinePx: paddingPx + Math.ceil(ascentMm * pixelsPerMm),
    heightPx: Math.ceil((ascentMm + descentMm) * pixelsPerMm) + paddingPx * 2,
  };
}
