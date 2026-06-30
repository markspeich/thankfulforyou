import { describe, expect, it } from "vitest";

import { shouldUsePostStretchBackingOffset, shouldUseRasterTextPreview } from "../../src/preview-rendering.js";

describe("preview rendering", () => {
  it("keeps completed preview rasterized for whole text runs from no-bridging fonts", () => {
    expect(shouldUseRasterTextPreview({
      letters: [{ character: "Haley", fontId: "font-quincy" }],
    })).toBe(true);
  });

  it("uses post-stretch backing offset for stretched raster text", () => {
    expect(shouldUsePostStretchBackingOffset({
      letters: [{ character: "T", verticalScale: 1.35 }],
    })).toBe(true);

    expect(shouldUsePostStretchBackingOffset({
      letters: [{ character: "T", horizontalScale: 1.25 }],
    })).toBe(true);
  });

  it("allows vector completed preview for normal per-glyph layouts", () => {
    expect(shouldUseRasterTextPreview({
      letters: [{ character: "H" }, { character: "a" }, { character: "ley".slice(0, 1) }],
    })).toBe(false);
  });
});
