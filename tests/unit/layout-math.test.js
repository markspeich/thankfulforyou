import { describe, expect, it } from "vitest";

import {
  DESIGN_BLEED_MM,
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
});
