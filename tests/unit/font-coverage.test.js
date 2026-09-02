import { describe, expect, test } from "vitest";

import {
  buildFontCoverageSummary,
  formatUnsupportedCharacters,
} from "../../src/font-coverage.js";

describe("font coverage warnings", () => {
  const unsupportedCharacters = [{
    character: "ñ",
    fontId: "candlepin",
    fontName: "Candlepin",
    lineNumber: 1,
    reason: "uses-base-glyph",
  }];

  test("formats a concise selected-design warning", () => {
    expect(formatUnsupportedCharacters(unsupportedCharacters)).toBe(
      "Candlepin is missing “ñ” on Line 1. Export remains available; correct this character in LightBurn.",
    );
  });

  test("prioritizes manual font review in the batch-row analysis indicator", () => {
    expect(buildFontCoverageSummary(unsupportedCharacters, {
      isConnected: true,
      connectedComponentCount: 1,
    })).toEqual({
      state: "warning",
      shortLabel: "!",
      fullLabel: "Manual font review: Candlepin is missing “ñ” on Line 1. Export remains available; correct this character in LightBurn. Connectedness: 1 face piece.",
    });
  });
});
