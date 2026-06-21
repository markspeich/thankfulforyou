import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  resolveBoundingSizePreset,
} from "./bounding-size-presets.js";

export const PX_PER_MM = 96 / 25.4;
export const TEXT_FIT_SAFETY_MARGIN_MM = 0.2;
export const DEFAULT_PREVIEW_GUIDE = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID);
export const MAX_RENDER_WIDTH_MM = DEFAULT_PREVIEW_GUIDE.maxWidthMm;
export const MAX_RENDER_HEIGHT_MM = DEFAULT_PREVIEW_GUIDE.maxHeightMm;
export const PREVIEW_BOX_WIDTH_MM = DEFAULT_PREVIEW_GUIDE.maxWidthMm;
export const PREVIEW_BOX_HEIGHT_MM = DEFAULT_PREVIEW_GUIDE.maxHeightMm;
export const PREVIEW_MARGIN_MM = 6;
export const PREVIEW_LABEL_RIGHT_MM = 10;
export const DESIGN_BLEED_MM = 1;
export const BACKING_RENDER_SAFETY_MM = 3;
export const DEFAULT_BACKING_MM = 3.1;
export const MAX_FIT_WIDTH_MM = MAX_RENDER_WIDTH_MM - TEXT_FIT_SAFETY_MARGIN_MM;
export const MAX_FIT_HEIGHT_MM = MAX_RENDER_HEIGHT_MM - TEXT_FIT_SAFETY_MARGIN_MM;

function resolveGuide(guide = DEFAULT_PREVIEW_GUIDE) {
  return guide && Number.isFinite(Number(guide.maxWidthMm)) && Number.isFinite(Number(guide.maxHeightMm))
    ? guide
    : DEFAULT_PREVIEW_GUIDE;
}

function getMaxFitWidthMm(guide) {
  return Math.max(1, resolveGuide(guide).maxWidthMm - TEXT_FIT_SAFETY_MARGIN_MM);
}

function getMaxFitHeightMm(guide) {
  return Math.max(1, resolveGuide(guide).maxHeightMm - TEXT_FIT_SAFETY_MARGIN_MM);
}

export function computeTextFitScale(textWidthMm, textHeightMm, guide = DEFAULT_PREVIEW_GUIDE) {
  return Math.min(
    getMaxFitWidthMm(guide) / Math.max(1, textWidthMm),
    getMaxFitHeightMm(guide) / Math.max(1, textHeightMm),
  );
}

export function computeLineScaleFactors(lines, fitScale) {
  return lines.map((line) => {
    const lockTextHeight = line?.settings?.lockTextHeight ?? line?.lockTextHeight ?? false;
    return lockTextHeight ? 1 : fitScale;
  });
}

export function computeMixedFitScale(lines, guide = DEFAULT_PREVIEW_GUIDE) {
  if (!Array.isArray(lines) || !lines.length) {
    return 1;
  }

  const hasUnlockedLines = lines.some((line) => !(line?.settings?.lockTextHeight ?? line?.lockTextHeight ?? false));
  if (!hasUnlockedLines) {
    return 1;
  }

  const lineBounds = measureLineBounds(
    Math.max(
      1,
      ...lines.map((line) => line.mask.widthMm),
      ...lines.map((line) => line?.settings?.fontSizeMm ?? line.fontSizeMm ?? 0),
    ),
    lines,
  );
  const uniformFitScale = computeTextFitScale(
    Math.max(1, lineBounds.maxRightMm - lineBounds.minLeftMm),
    Math.max(1, lineBounds.maxBottomMm - lineBounds.minTopMm),
    guide,
  );

  const minBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, 0), guide);
  if (minBounds.overflowsGuide) {
    return 1;
  }

  let lower = 0;
  let upper = Math.max(1, uniformFitScale);
  let upperBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, upper), guide);

  while (!upperBounds.overflowsGuide && upper < 64) {
    lower = upper;
    upper *= 2;
    upperBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, upper), guide);
  }

  if (!upperBounds.overflowsGuide) {
    return upper;
  }

  for (let index = 0; index < 24; index += 1) {
    const middle = (lower + upper) / 2;
    const middleBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, middle), guide);

    if (middleBounds.overflowsGuide) {
      upper = middle;
    } else {
      lower = middle;
    }
  }

  return lower;
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

export function computeMixedScaleBounds(lines, lineScaleFactors, guide = DEFAULT_PREVIEW_GUIDE) {
  const resolvedGuide = resolveGuide(guide);
  const scaledBaseTextWidthMm = Math.max(
    1,
    ...lines.map((line, index) => line.mask.widthMm * lineScaleFactors[index]),
    ...lines.map((line, index) => {
      const fontSizeMm = line?.settings?.fontSizeMm ?? line.fontSizeMm ?? 0;
      return fontSizeMm * lineScaleFactors[index];
    }),
  );
  let previousScaledY = 0;
  let previousLine = null;
  let previousScaleFactor = lineScaleFactors[0] ?? 1;
  const lineBounds = lines.map((line, index) => {
    const scaleFactor = lineScaleFactors[index];
    const scaledWidthMm = line.mask.widthMm * scaleFactor;
    const scaledOffsetXMm = line.offsetXMm * scaleFactor;
    let scaledY = previousScaledY;

    if (index === 0) {
      scaledY = line.y * scaleFactor;
      previousScaledY = scaledY;
      previousLine = line;
      previousScaleFactor = scaleFactor;
    } else {
      const lineBridgeMm = Number.isFinite(Number(line?.settings?.lineBridgeMm))
        ? Number(line.settings.lineBridgeMm) * scaleFactor
        : null;
      if (lineBridgeMm != null && previousLine) {
        const previousBottomMm = previousScaledY + previousLine.mask.bottomMm * previousScaleFactor;
        const currentTopMm = line.mask.topMm * scaleFactor;
        scaledY = previousBottomMm - currentTopMm - lineBridgeMm;
      } else {
        const rawDeltaY = line.y - (lines[index - 1]?.y ?? 0);
        const deltaScaleFactor = Math.max(previousScaleFactor, scaleFactor);
        scaledY = previousScaledY + rawDeltaY * deltaScaleFactor;
      }
      previousScaledY = scaledY;
      previousLine = line;
      previousScaleFactor = scaleFactor;
    }
    const centeredLeftMm = (scaledBaseTextWidthMm - scaledWidthMm) / 2 + scaledOffsetXMm;

    return {
      line,
      scaleFactor,
      scaledY,
      centeredLeftMm,
      centeredRightMm: centeredLeftMm + scaledWidthMm,
      topMm: scaledY + line.mask.topMm * scaleFactor,
      bottomMm: scaledY + line.mask.bottomMm * scaleFactor,
    };
  });

  const minLeftMm = Math.min(...lineBounds.map((item) => item.centeredLeftMm));
  const maxRightMm = Math.max(...lineBounds.map((item) => item.centeredRightMm));
  const minTopMm = Math.min(...lineBounds.map((item) => item.topMm));
  const maxBottomMm = Math.max(...lineBounds.map((item) => item.bottomMm));
  const textWidthMm = Math.max(1, maxRightMm - minLeftMm);
  const textHeightMm = Math.max(1, maxBottomMm - minTopMm);

  return {
    scaledBaseTextWidthMm,
    lineBounds,
    minLeftMm,
    maxRightMm,
    minTopMm,
    maxBottomMm,
    textWidthMm,
    textHeightMm,
    overflowsGuide: textWidthMm > getMaxFitWidthMm(resolvedGuide) || textHeightMm > getMaxFitHeightMm(resolvedGuide),
  };
}

export function computeGuideOverflow(lines, textWidthMm, textHeightMm, guide = DEFAULT_PREVIEW_GUIDE) {
  const hasLockedLines = Array.isArray(lines)
    && lines.some((line) => line?.settings?.lockTextHeight ?? line?.lockTextHeight ?? false);

  if (!hasLockedLines) {
    return false;
  }

  return computeTextFitScale(textWidthMm, textHeightMm, guide) < 1 - 1e-6;
}

export function buildScaledTextBounds(textWidthMm, textHeightMm, backingMm, scaleFactor) {
  return {
    left: DESIGN_BLEED_MM + backingMm + BACKING_RENDER_SAFETY_MM,
    top: DESIGN_BLEED_MM + backingMm + BACKING_RENDER_SAFETY_MM,
    width: textWidthMm * scaleFactor,
    height: textHeightMm * scaleFactor,
  };
}

export function computePreviewFrame(layout, textBoundsMm = layout.textBoundsMm, guide = layout.guide || DEFAULT_PREVIEW_GUIDE) {
  const resolvedGuide = resolveGuide(guide);
  const previewWidthMm = Math.max(layout.widthMm, resolvedGuide.maxWidthMm) + PREVIEW_MARGIN_MM * 2;
  const previewHeightMm = Math.max(layout.heightMm, resolvedGuide.maxHeightMm) + PREVIEW_MARGIN_MM * 2;
  const previewBoxX = (previewWidthMm - PREVIEW_LABEL_RIGHT_MM - resolvedGuide.maxWidthMm) / 2;
  const previewBoxY = (previewHeightMm - resolvedGuide.maxHeightMm) / 2;
  const designX = previewBoxX + (resolvedGuide.maxWidthMm - textBoundsMm.width) / 2 - textBoundsMm.left;
  const designY = previewBoxY + (resolvedGuide.maxHeightMm - textBoundsMm.height) / 2 - textBoundsMm.top;

  return {
    previewWidthMm,
    previewHeightMm,
    previewBoxX,
    previewBoxY,
    designX,
    designY,
  };
}
