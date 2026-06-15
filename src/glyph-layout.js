export function buildGlyphLayoutRuns(text, fontBridgingEnabled) {
  if (!text) {
    return [];
  }

  return fontBridgingEnabled === false ? [text] : [...text];
}

export function resolveNextGlyphMaskOrigin({
  bridgeMm,
  findPairOffset,
  fontBridgingEnabled,
  leftMask,
  previousAdvanceMm,
  previousMaskOriginMm,
  rightMask,
}) {
  if (fontBridgingEnabled === false) {
    return previousMaskOriginMm + previousAdvanceMm;
  }

  return previousMaskOriginMm + findPairOffset(leftMask, rightMask, bridgeMm);
}

export function resolveNextLineOffsetMm({
  bridgeMm,
  findLineOffset,
  fontBridgingEnabled,
  lowerMask,
  upperMask,
}) {
  if (fontBridgingEnabled === false) {
    return upperMask.heightMm;
  }

  return findLineOffset(upperMask, lowerMask, bridgeMm);
}
