import { describe, expect, it } from "vitest";
import {
  formatCustomerFontSelection,
  normalizeCustomerFontAlias,
  normalizeCustomerFontSelections,
  overlayCustomerFontsOnLines,
  resolveCustomerFont,
  resolveCustomerFontId,
  resolveNewTextLineFontSettings,
  summarizeCustomerFontResolution,
} from "../../src/amazon-customer-fonts.js";

const fonts = [
  { id: "candlepin", label: "Candlepin Laser" },
  { id: "skywalk", label: "Skywalk Laser" },
  { id: "somekind", label: "Somekind" },
  { id: "font-custom", displayName: "My Custom Font", label: "My Custom Font" },
];

const workspaceFonts = [
  { id: "font-primary", displayName: "Primary Display", label: "Primary Display" },
  { id: "font-archived", displayName: "Archived Display", archivedAt: "2026-01-01T00:00:00.000Z" },
  { id: "font-deleted", displayName: "Deleted Display", deletedAt: "2026-01-01T00:00:00.000Z" },
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

  it("resolves a display name when Etsy omits the laser suffix", () => {
    expect(resolveCustomerFontId("Quincy", [
      { id: "workspace-font-quincy", displayName: "Quincy - Laser" },
    ])).toBe("workspace-font-quincy");
  });

  it("normalizes aliases with NFKC, collapsed whitespace, and lowercase", () => {
    expect(normalizeCustomerFontAlias("  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy  ")).toBe("super boy");
    expect(normalizeCustomerFontAlias(null)).toBe("");
  });

  it("resolves workspace aliases before exact display-name fallback", () => {
    const aliases = [{
      id: "alias-primary",
      aliasName: "Primary Display",
      normalizedAlias: "primary display",
      fontId: "font-archived",
    }];

    expect(resolveCustomerFont(" primary   display ", workspaceFonts, aliases)).toMatchObject({
      fontId: null,
      font: workspaceFonts[1],
      alias: aliases[0],
      status: "archived",
    });
    expect(resolveCustomerFontId("primary display", workspaceFonts, aliases)).toBeNull();
    expect(resolveCustomerFontId("Primary Display", workspaceFonts)).toBe("font-primary");
  });

  it("does not apply trailing Laser compatibility to alias identities", () => {
    const aliases = [{
      id: "alias-primary", aliasName: "Primary Display", normalizedAlias: "primary display", fontId: "font-primary",
    }];

    expect(resolveCustomerFontId("Primary Display Laser", workspaceFonts, aliases)).toBeNull();
  });

  it("resolves exact display names and trailing Laser compatibility without static aliases", () => {
    const superBoys = [{ id: "super-boys", displayName: "Super Boys Laser" }];

    expect(resolveCustomerFontId("Super Boys", superBoys)).toBe("super-boys");
    expect(resolveCustomerFontId("Super Boy", superBoys)).toBeNull();
  });

  it("keeps alias snapshots isolated to their supplied workspace input", () => {
    const workspaceOneAliases = [{
      id: "alias-one", aliasName: "Signature", normalizedAlias: "signature", fontId: "font-primary",
    }];
    const workspaceTwoAliases = [{
      id: "alias-two", aliasName: "Signature", normalizedAlias: "signature", fontId: "font-archived",
    }];

    expect(resolveCustomerFontId("Signature", workspaceFonts, workspaceOneAliases)).toBe("font-primary");
    expect(resolveCustomerFont("Signature", workspaceFonts, workspaceTwoAliases)).toMatchObject({
      fontId: null, alias: workspaceTwoAliases[0], status: "archived",
    });
  });

  it("returns deleted alias target metadata without an applicable font id", () => {
    const aliases = [{
      id: "alias-deleted", aliasName: "Legacy", normalizedAlias: "legacy", fontId: "font-deleted",
    }];

    expect(resolveCustomerFont("Legacy", workspaceFonts, aliases)).toMatchObject({
      fontId: null,
      font: workspaceFonts[2],
      alias: aliases[0],
      status: "deleted",
    });
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

  it("threads aliases through overlay and summary without changing selections", () => {
    const aliases = [{
      id: "alias-primary", aliasName: "Customer Choice", normalizedAlias: "customer choice", fontId: "font-primary",
    }];
    const selections = [{ lineIndex: 0, name: "  Customer   Choice  " }];
    const originalSelections = JSON.stringify(selections);

    expect(overlayCustomerFontsOnLines(
      [{ fontId: "candlepin" }], selections, workspaceFonts, aliases,
    )).toEqual([{ fontId: "font-primary" }]);
    expect(summarizeCustomerFontResolution(
      [{ fontId: "candlepin" }], selections, workspaceFonts, aliases,
    )).toMatchObject({ recognizedCount: 1, unknownCount: 0, effectiveFontIds: ["font-primary"] });
    expect(JSON.stringify(selections)).toBe(originalSelections);
    expect(selections[0].name).toBe("  Customer   Choice  ");
  });

  it("applies a later-line customer font only when that line exists", () => {
    // Break caught: a second-line selection is silently ignored after its alias resolves.
    const fonts = [{ id: "super-boys", displayName: "Super Boys" }];
    const selection = [{ lineIndex: 1, name: "Super Boys" }];

    expect(overlayCustomerFontsOnLines([{ fontId: "candlepin" }], selection, fonts))
      .toEqual([{ fontId: "candlepin" }]);
    expect(overlayCustomerFontsOnLines([
      { fontId: "candlepin" },
      { fontId: "somekind", bridgeMm: 0.7 },
    ], selection, fonts)).toEqual([
      { fontId: "candlepin" },
      { fontId: "super-boys", bridgeMm: 0.7 },
    ]);
  });

  it("inherits line 1 font when a new line has no customer or targeted preset font", () => {
    expect(resolveNewTextLineFontSettings({
      lineSettings: { fontId: "candlepin", bridgeMm: 0.7 },
      textLineIndex: 1,
      firstLineFontId: "skywalk",
      hasTargetedPresetFont: false,
      selections: [{ lineIndex: 0, name: "Skywalk" }],
      fontOptions: fonts,
    })).toEqual({ fontId: "skywalk", bridgeMm: 0.7 });
  });

  it("preserves exact customer and targeted preset fonts ahead of line 1 inheritance", () => {
    expect(resolveNewTextLineFontSettings({
      lineSettings: { fontId: "somekind" },
      textLineIndex: 1,
      firstLineFontId: "skywalk",
      hasTargetedPresetFont: true,
      selections: [{ lineIndex: 0, name: "Skywalk" }],
      fontOptions: fonts,
    })).toEqual({ fontId: "somekind" });

    expect(resolveNewTextLineFontSettings({
      lineSettings: { fontId: "somekind" },
      textLineIndex: 1,
      firstLineFontId: "skywalk",
      hasTargetedPresetFont: true,
      selections: [{ lineIndex: 1, name: "Candlepin" }],
      fontOptions: fonts,
    })).toEqual({ fontId: "candlepin" });

    expect(resolveNewTextLineFontSettings({
      lineSettings: { fontId: "somekind" },
      textLineIndex: 1,
      firstLineFontId: "skywalk",
      hasTargetedPresetFont: false,
      selections: [{ lineIndex: 1, name: "Unknown" }],
      fontOptions: fonts,
    })).toEqual({ fontId: "somekind" });
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
      pendingCount: 0,
      effectiveFontIds: ["skywalk", "somekind"],
    });
    expect(JSON.stringify(summary)).not.toContain("Skywalk");
    expect(JSON.stringify(summary)).not.toContain("TOP SECRET FONT VALUE");
  });

  it("keeps future-line selections pending rather than resolving them against missing text", () => {
    // Break caught: diagnostics count a stored line-two selection as resolved before line two exists.
    const summary = summarizeCustomerFontResolution(
      [{ fontId: "candlepin" }],
      [
        { lineIndex: 0, name: "Skywalk" },
        { lineIndex: 1, name: "Super Boy" },
        { lineIndex: 2, name: "Unknown Font" },
      ],
      [...fonts, { id: "super-boys", displayName: "Super Boys" }],
    );

    expect(summary).toEqual({
      selectionCount: 3,
      recognizedCount: 1,
      unknownCount: 0,
      pendingCount: 2,
      effectiveFontIds: ["skywalk"],
    });
  });
});
