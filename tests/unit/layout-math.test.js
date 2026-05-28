import { describe, expect, it } from "vitest";

import {
  computeGuideOverflow,
  computeLineScaleFactors,
  computeMixedFitScale,
  computeMixedScaleBounds,
  DESIGN_BLEED_MM,
  MAX_FIT_HEIGHT_MM,
  MAX_FIT_WIDTH_MM,
  MAX_RENDER_HEIGHT_MM,
  MAX_RENDER_WIDTH_MM,
  PREVIEW_BOX_HEIGHT_MM,
  PREVIEW_BOX_WIDTH_MM,
  buildScaledTextBounds,
  computePreviewFrame,
  computeTextFitScale,
  measureLineBounds,
} from "../../src/layout-math.js";

describe("layout math", () => {
  it("scales text to stay inside the 2.2 by 1.5 inch guide", () => {
    const scale = computeTextFitScale(70, 20);

    expect(70 * scale).toBeLessThanOrEqual(MAX_RENDER_WIDTH_MM);
    expect(20 * scale).toBeLessThanOrEqual(MAX_RENDER_HEIGHT_MM);
    expect(70 * scale).toBeGreaterThan(55.6);
  });

  it("computes visible line bounds from centered line geometry", () => {
    const { lineBounds, minLeftMm, maxRightMm, minTopMm, maxBottomMm } = measureLineBounds(40, [
      {
        y: 0,
        offsetXMm: 0,
        mask: { widthMm: 40, topMm: 2, bottomMm: 20 },
      },
      {
        y: 22,
        offsetXMm: -3,
        mask: { widthMm: 20, topMm: 1, bottomMm: 12 },
      },
    ]);

    expect(lineBounds).toHaveLength(2);
    expect(minLeftMm).toBe(0);
    expect(maxRightMm).toBe(40);
    expect(minTopMm).toBe(2);
    expect(maxBottomMm).toBe(34);
  });

  it("keeps locked lines at scale 1 while unlocked lines use the fit scale", () => {
    const lineScales = computeLineScaleFactors(
      [
        { settings: { lockTextHeight: true } },
        { settings: { lockTextHeight: false } },
        { settings: { lockTextHeight: false } },
      ],
      0.72,
    );

    expect(lineScales).toEqual([1, 0.72, 0.72]);
  });

  it("reports guide overflow when locked geometry prevents full fit", () => {
    const bounds = computeMixedScaleBounds(
      [
        {
          y: 0,
          offsetXMm: 0,
          settings: { fontSizeMm: 55, lockTextHeight: true },
          mask: { widthMm: 70, topMm: 0, bottomMm: 18 },
        },
      ],
      [1],
    );

    expect(bounds.textWidthMm).toBeGreaterThan(MAX_RENDER_WIDTH_MM);
    expect(bounds.overflowsGuide).toBe(true);
    expect(computeGuideOverflow([
      {
        settings: { lockTextHeight: true },
      },
    ], bounds.textWidthMm, bounds.textHeightMm)).toBe(true);
  });

  it("uses the same safety-margin envelope as the fit-scale calculation", () => {
    const bounds = computeMixedScaleBounds(
      [
        {
          y: 0,
          offsetXMm: 0,
          settings: { fontSizeMm: MAX_FIT_WIDTH_MM + 0.05, lockTextHeight: true },
          mask: { widthMm: MAX_FIT_WIDTH_MM + 0.05, topMm: 0, bottomMm: 10 },
        },
      ],
      [1],
    );

    expect(bounds.textWidthMm).toBeGreaterThan(MAX_FIT_WIDTH_MM);
    expect(bounds.textWidthMm).toBeLessThanOrEqual(MAX_RENDER_WIDTH_MM);
    expect(bounds.overflowsGuide).toBe(true);
  });

  it("does not report locked-line guide overflow when every line is unlocked", () => {
    expect(computeGuideOverflow([
      {
        settings: { lockTextHeight: false },
      },
    ], MAX_FIT_WIDTH_MM + 0.05, 10)).toBe(false);
  });

  it("allows unlocked lines to grow beyond the old global fit when locked lines stay fixed", () => {
    const lines = [
      {
        y: 0,
        offsetXMm: 0,
        settings: { fontSizeMm: 18, lockTextHeight: false, lineBridgeMm: 0 },
        mask: { widthMm: 20, topMm: 0, bottomMm: 10 },
      },
      {
        y: 9.5,
        offsetXMm: 0,
        settings: { fontSizeMm: 21, lockTextHeight: true, lineBridgeMm: 0.5 },
        mask: { widthMm: 10, topMm: 0, bottomMm: 10 },
      },
    ];
    const uniformFitScale = computeTextFitScale(20, 19.5);

    const mixedFitScale = computeMixedFitScale(lines);
    const mixedBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, mixedFitScale));

    expect(mixedFitScale).toBeGreaterThan(uniformFitScale);
    expect(mixedBounds.textWidthMm).toBeLessThanOrEqual(MAX_FIT_WIDTH_MM);
    expect(mixedBounds.textHeightMm).toBeLessThanOrEqual(MAX_FIT_HEIGHT_MM);
  });

  it("matches the existing global-fit positioning when every line is unlocked", () => {
    const lines = [
      {
        y: 6,
        offsetXMm: 4,
        settings: { fontSizeMm: 40, lockTextHeight: false },
        mask: { widthMm: 40, topMm: 2, bottomMm: 20 },
      },
      {
        y: 22,
        offsetXMm: -3,
        settings: { fontSizeMm: 24, lockTextHeight: false },
        mask: { widthMm: 20, topMm: 1, bottomMm: 12 },
      },
    ];
    const fitScale = 0.5;
    const scaledLines = lines.map((line) => ({
      ...line,
      y: line.y * fitScale,
      offsetXMm: line.offsetXMm * fitScale,
      mask: {
        widthMm: line.mask.widthMm * fitScale,
        topMm: line.mask.topMm * fitScale,
        bottomMm: line.mask.bottomMm * fitScale,
      },
    }));
    const scaledBaseTextWidthMm = Math.max(
      1,
      ...scaledLines.map((line) => line.mask.widthMm),
      ...scaledLines.map((line) => line.settings.fontSizeMm * fitScale),
    );

    const uniformBounds = measureLineBounds(scaledBaseTextWidthMm, scaledLines);
    const mixedBounds = computeMixedScaleBounds(lines, computeLineScaleFactors(lines, fitScale));

    expect(mixedBounds.minLeftMm).toBeCloseTo(uniformBounds.minLeftMm, 6);
    expect(mixedBounds.maxRightMm).toBeCloseTo(uniformBounds.maxRightMm, 6);
    expect(mixedBounds.minTopMm).toBeCloseTo(uniformBounds.minTopMm, 6);
    expect(mixedBounds.maxBottomMm).toBeCloseTo(uniformBounds.maxBottomMm, 6);
  });

  it("preserves stacked line ordering for mixed locked and unlocked lines", () => {
    const mixedBounds = computeMixedScaleBounds(
      [
        {
          y: 0,
          offsetXMm: 0,
          settings: { fontSizeMm: 40, lockTextHeight: true },
          mask: { widthMm: 40, topMm: 2, bottomMm: 20 },
        },
        {
          y: 22,
          offsetXMm: 0,
          settings: { fontSizeMm: 24, lockTextHeight: false },
          mask: { widthMm: 20, topMm: 1, bottomMm: 12 },
        },
      ],
      [1, 0.5],
    );

    expect(mixedBounds.lineBounds[0].bottomMm).toBeLessThan(mixedBounds.lineBounds[1].bottomMm);
    expect(mixedBounds.lineBounds[1].topMm).toBeGreaterThan(mixedBounds.lineBounds[0].topMm);
  });

  it("preserves line bridge overlap when an upper line shrinks and the lower line stays locked", () => {
    const mixedBounds = computeMixedScaleBounds(
      [
        {
          y: 0,
          offsetXMm: 0,
          settings: { fontSizeMm: 40, lockTextHeight: false, lineBridgeMm: 0 },
          mask: { widthMm: 40, topMm: 0, bottomMm: 10 },
        },
        {
          y: 9.5,
          offsetXMm: 0,
          settings: { fontSizeMm: 24, lockTextHeight: true, lineBridgeMm: 0.5 },
          mask: { widthMm: 20, topMm: 0, bottomMm: 10 },
        },
      ],
      [0.5, 1],
    );

    const upper = mixedBounds.lineBounds[0];
    const lower = mixedBounds.lineBounds[1];

    expect(upper.bottomMm - lower.topMm).toBeCloseTo(0.5, 6);
  });

  it("centers visible text bounds inside the guide even when backing is larger", () => {
    const textBoundsMm = buildScaledTextBounds(36, 30, 3.1, 1);
    const frame = computePreviewFrame(
      {
        widthMm: textBoundsMm.width + 2 * (DESIGN_BLEED_MM + 3.1),
        heightMm: textBoundsMm.height + 2 * (DESIGN_BLEED_MM + 3.1),
        textBoundsMm,
      },
      textBoundsMm,
    );

    const textCenterX = frame.designX + textBoundsMm.left + textBoundsMm.width / 2;
    const textCenterY = frame.designY + textBoundsMm.top + textBoundsMm.height / 2;
    const guideCenterX = frame.previewBoxX + PREVIEW_BOX_WIDTH_MM / 2;
    const guideCenterY = frame.previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2;

    expect(textCenterX).toBeCloseTo(guideCenterX, 6);
    expect(textCenterY).toBeCloseTo(guideCenterY, 6);
  });

  it("keeps the backing border at its authored physical size after text fit scaling", () => {
    const textBoundsMm = buildScaledTextBounds(70, 20, 3.1, 0.5);

    expect(textBoundsMm.left).toBeCloseTo(DESIGN_BLEED_MM + 3.1, 6);
    expect(textBoundsMm.top).toBeCloseTo(DESIGN_BLEED_MM + 3.1, 6);
    expect(textBoundsMm.width).toBeCloseTo(35, 6);
    expect(textBoundsMm.height).toBeCloseTo(10, 6);
  });
});
