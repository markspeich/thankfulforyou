import { describe, expect, it } from "vitest";
import {
  formatCustomerFontSelection,
  normalizeCustomerFontSelections,
  overlayCustomerFontsOnLines,
  resolveCustomerFontId,
  summarizeCustomerFontResolution,
} from "../../src/amazon-customer-fonts.js";

const fonts = [
  { id: "candlepin", label: "Candlepin Laser" },
  { id: "skywalk", label: "Skywalk Laser" },
  { id: "somekind", label: "Somekind" },
  { id: "font-custom", displayName: "My Custom Font", label: "My Custom Font" },
];

describe("Amazon customer fonts", () => {
  it("normalizes, orders, and formats safe selections", () => {
    const selections = normalizeCustomerFontSelections([
      { lineIndex: 1, name: " Somekind " }, { lineIndex: -1, name: "Bad" },
      { lineIndex: 0, name: "Skywalk" }, { lineIndex: 2, name: "" },
    ]);
    expect(selections).toEqual([{ lineIndex: 0, name: "Skywalk" }, { lineIndex: 1, name: "Somekind" }]);
    expect(selections.map(formatCustomerFontSelection)).toEqual(["Line 1 Font: Skywalk", "Line 2 Font: Somekind"]);
  });

  it("resolves seeded aliases and workspace display names case-insensitively", () => {
    expect(resolveCustomerFontId(" skyWALK ", fonts)).toBe("skywalk");
    expect(resolveCustomerFontId("Candlepin", fonts)).toBe("candlepin");
    expect(resolveCustomerFontId("my custom font", fonts)).toBe("font-custom");
    expect(resolveCustomerFontId("Unknown", fonts)).toBeNull();
  });

  it("overlays only recognized differing font ids and preserves preset settings", () => {
    const lines = [
      { fontId: "candlepin", bridgeMm: 0.7, fontSizeMm: 31, lockTextHeight: true },
      { fontId: "somekind", offsetXMm: 2, horizontalScale: 1.2 },
    ];
    expect(overlayCustomerFontsOnLines(lines, [
      { lineIndex: 0, name: "Skywalk" },
      { lineIndex: 1, name: "Somekind" },
      { lineIndex: 2, name: "Unknown" },
    ], fonts)).toEqual([
      { fontId: "skywalk", bridgeMm: 0.7, fontSizeMm: 31, lockTextHeight: true },
      { fontId: "somekind", offsetXMm: 2, horizontalScale: 1.2 },
    ]);
    expect(lines[0].fontId).toBe("candlepin");
  });

  it("summarizes resolved fonts without retaining customer-facing font values", () => {
    // Break caught: diagnostics reveal customer values or disagree with the effective line fonts.
    const summary = summarizeCustomerFontResolution(
      [{ fontId: "candlepin" }, { fontId: "somekind" }],
      [
        { lineIndex: 0, name: "Skywalk" },
        { lineIndex: 1, name: "TOP SECRET FONT VALUE" },
      ],
      fonts,
    );

    expect(summary).toEqual({
      selectionCount: 2,
      recognizedCount: 1,
      unknownCount: 1,
      effectiveFontIds: ["skywalk", "somekind"],
    });
    expect(JSON.stringify(summary)).not.toContain("Skywalk");
    expect(JSON.stringify(summary)).not.toContain("TOP SECRET FONT VALUE");
  });
});
