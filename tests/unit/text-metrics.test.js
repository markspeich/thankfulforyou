import { describe, expect, it } from "vitest";

import { computeLineMaskMetrics } from "../../src/text-metrics.js";

describe("text metrics", () => {
  it("uses measured glyph ascent and descent instead of a fixed line-height heuristic", () => {
    const metrics = computeLineMaskMetrics(
      [
        { ascentMm: 18.4, descentMm: 6.8 },
        { ascentMm: 16.2, descentMm: 11.7 },
      ],
      {
        fontSizeMm: 20,
        verticalScale: 1,
        pixelsPerMm: 10,
        paddingPx: 12,
      },
    );

    expect(metrics.ascentMm).toBe(18.4);
    expect(metrics.descentMm).toBe(11.7);
    expect(metrics.heightPx).toBeGreaterThanOrEqual(Math.ceil((18.4 + 11.7) * 10) + 24);
    expect(metrics.baselinePx).toBe(12 + Math.ceil(18.4 * 10));
  });

  it("keeps the current fallback sizing for empty lines", () => {
    const metrics = computeLineMaskMetrics([], {
      fontSizeMm: 20,
      verticalScale: 1.25,
      pixelsPerMm: 10,
      paddingPx: 12,
    });

    expect(metrics.ascentMm).toBe(20 * 1.25);
    expect(metrics.descentMm).toBe(0);
    expect(metrics.heightPx).toBe(Math.ceil(20 * 1.35 * 1.25 * 10) + 24);
    expect(metrics.baselinePx).toBe(12 + Math.ceil(20 * 1.25 * 10));
  });
});
