import { describe, expect, it } from "vitest";

import {
  inferPresetDefinitionFromSettings,
  buildPresetIdFromName,
  upsertListingAssignment,
  removeListingAssignment,
} from "../../src/preset-authoring.js";

const makeSettings = () => ({
  text: "Morgan\nRN",
  presetId: "skywalk-somekind",
  backingMm: 2.2,
  weldExportedDesign: true,
  lines: [
    {
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 18,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    {
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 23,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: true,
    },
  ],
});

describe("preset authoring", () => {
  it("infers shared line defaults plus first and index rules from editor settings", () => {
    const preset = inferPresetDefinitionFromSettings({
      name: "Skywalk RN",
      settings: makeSettings(),
    });

    expect(preset.id).toBe("skywalk-rn");
    expect(preset.globalDefaults).toEqual({
      backingMm: 2.2,
      weldExportedDesign: true,
    });
    expect(preset.lineDefaults).toEqual({
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      horizontalScale: 1,
      verticalScale: 1,
    });
    expect(preset.lineRules).toEqual([
      {
        match: { kind: "first" },
        settings: { fontId: "skywalk", fontSizeMm: 18, lockTextHeight: false },
      },
      {
        match: { kind: "index", lineIndex: 1 },
        settings: { fontId: "somekind", fontSizeMm: 23, lockTextHeight: true },
      },
    ]);
  });

  it("builds stable kebab-case ids from operator-facing names", () => {
    expect(buildPresetIdFromName("Skywalk RN")).toBe("skywalk-rn");
  });

  it("adds or replaces a listing assignment for one listing id", () => {
    const preset = upsertListingAssignment({
      preset: {
        id: "skywalk-rn",
        name: "Skywalk RN",
        lineDefaults: {},
        lineRules: [{ match: { kind: "all" }, settings: {} }],
        listingAssignments: [],
      },
      assignment: {
        listingId: "1884223710",
        name: "PICU Badge Reel",
      },
    });

    expect(preset.listingAssignments).toEqual([
      {
        listingId: "1884223710",
        name: "PICU Badge Reel",
        lineOverrides: [],
      },
    ]);
  });

  it("removes one listing assignment without touching the rest", () => {
    const preset = removeListingAssignment({
      preset: {
        id: "skywalk-rn",
        name: "Skywalk RN",
        lineDefaults: {},
        lineRules: [{ match: { kind: "all" }, settings: {} }],
        listingAssignments: [
          { listingId: "1884223710", name: "PICU Badge Reel", lineOverrides: [] },
          { listingId: "4465975709", name: "Tech Reel", lineOverrides: [] },
        ],
      },
      listingId: "1884223710",
    });

    expect(preset.listingAssignments).toEqual([
      { listingId: "4465975709", name: "Tech Reel", lineOverrides: [] },
    ]);
  });
});
