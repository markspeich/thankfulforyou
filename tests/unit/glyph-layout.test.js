import { describe, expect, it, vi } from "vitest";

import {
  buildGlyphLayoutRuns,
  resolveNextGlyphMaskOrigin,
  resolveNextLineOffsetMm,
} from "../../src/glyph-layout.js";

describe("glyph layout", () => {
  it("keeps bridge-disabled cursive text as one shaped text run", () => {
    expect(buildGlyphLayoutRuns("Cyndi", false)).toEqual(["Cyndi"]);
  });

  it("splits text into individual glyphs when font bridging is enabled", () => {
    expect(buildGlyphLayoutRuns("Cyndi", true)).toEqual(["C", "y", "n", "d", "i"]);
  });

  it("uses natural font advance instead of pair-overlap search when font bridging is disabled", () => {
    const findPairOffset = vi.fn(() => 4.5);

    expect(resolveNextGlyphMaskOrigin({
      bridgeMm: 0,
      findPairOffset,
      fontBridgingEnabled: false,
      leftMask: { character: "d" },
      previousAdvanceMm: 8.25,
      previousMaskOriginMm: 12,
      rightMask: { character: "i" },
    })).toBe(20.25);
    expect(findPairOffset).not.toHaveBeenCalled();
  });

  it("uses pair-overlap search when font bridging is enabled", () => {
    const findPairOffset = vi.fn(() => 4.5);

    expect(resolveNextGlyphMaskOrigin({
      bridgeMm: 0.5,
      findPairOffset,
      fontBridgingEnabled: true,
      leftMask: { character: "d" },
      previousAdvanceMm: 8.25,
      previousMaskOriginMm: 12,
      rightMask: { character: "i" },
    })).toBe(16.5);
    expect(findPairOffset).toHaveBeenCalledWith({ character: "d" }, { character: "i" }, 0.5);
  });

  it("keeps natural line spacing instead of line-overlap search when font bridging is disabled", () => {
    const findLineOffset = vi.fn(() => 18);

    expect(resolveNextLineOffsetMm({
      bridgeMm: 0,
      findLineOffset,
      fontBridgingEnabled: false,
      lowerMask: { heightMm: 9 },
      upperMask: { heightMm: 24 },
    })).toBe(24);
    expect(findLineOffset).not.toHaveBeenCalled();
  });
});
