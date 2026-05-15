export const PX_PER_MM = 96 / 25.4;
export const MAX_RENDER_WIDTH_MM = 55.88;
export const MAX_RENDER_HEIGHT_MM = 38.1;
export const TEXT_FIT_SAFETY_MARGIN_MM = 0.2;
export const PREVIEW_BOX_WIDTH_MM = 55.88;
export const PREVIEW_BOX_HEIGHT_MM = 38.1;
export const PREVIEW_MARGIN_MM = 6;
export const PREVIEW_LABEL_RIGHT_MM = 10;
export const DESIGN_BLEED_MM = 1;
export const DEFAULT_BACKING_MM = 3.1;

export function computeTextFitScale(textWidthMm, textHeightMm) {
  return Math.min(
    Math.max(1, MAX_RENDER_WIDTH_MM - TEXT_FIT_SAFETY_MARGIN_MM) / Math.max(1, textWidthMm),
    Math.max(1, MAX_RENDER_HEIGHT_MM - TEXT_FIT_SAFETY_MARGIN_MM) / Math.max(1, textHeightMm),
  );
}

export function measureLineBounds(baseTextWidthMm, lines) {
  const lineBounds = lines.map((line) => {
    const centeredLeftMm = (baseTextWidthMm - line.mask.widthMm) / 2 + line.offsetXMm;
    return {
      line,
      centeredLeftMm,
      centeredRightMm: centeredLeftMm + line.mask.widthMm,
      topMm: line.y + line.mask.topMm,
      bottomMm: line.y + line.mask.bottomMm,
    };
  });

  return {
    lineBounds,
    minLeftMm: Math.min(...lineBounds.map((item) => item.centeredLeftMm)),
    maxRightMm: Math.max(...lineBounds.map((item) => item.centeredRightMm)),
    minTopMm: Math.min(...lineBounds.map((item) => item.topMm)),
    maxBottomMm: Math.max(...lineBounds.map((item) => item.bottomMm)),
  };
}

export function buildScaledTextBounds(textWidthMm, textHeightMm, backingMm, scaleFactor) {
  return {
    left: (DESIGN_BLEED_MM + backingMm) * scaleFactor,
    top: (DESIGN_BLEED_MM + backingMm) * scaleFactor,
    width: textWidthMm * scaleFactor,
    height: textHeightMm * scaleFactor,
  };
}

export function computePreviewFrame(layout, textBoundsMm = layout.textBoundsMm) {
  const previewWidthMm = Math.max(layout.widthMm, PREVIEW_BOX_WIDTH_MM) + PREVIEW_MARGIN_MM * 2;
  const previewHeightMm = Math.max(layout.heightMm, PREVIEW_BOX_HEIGHT_MM) + PREVIEW_MARGIN_MM * 2;
  const previewBoxX = (previewWidthMm - PREVIEW_LABEL_RIGHT_MM - PREVIEW_BOX_WIDTH_MM) / 2;
  const previewBoxY = (previewHeightMm - PREVIEW_BOX_HEIGHT_MM) / 2;
  const designX = previewBoxX + (PREVIEW_BOX_WIDTH_MM - textBoundsMm.width) / 2 - textBoundsMm.left;
  const designY = previewBoxY + (PREVIEW_BOX_HEIGHT_MM - textBoundsMm.height) / 2 - textBoundsMm.top;

  return {
    previewWidthMm,
    previewHeightMm,
    previewBoxX,
    previewBoxY,
    designX,
    designY,
  };
}
