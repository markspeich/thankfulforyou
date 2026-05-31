import { describe, expect, it } from "vitest";

import {
  inferPresetDefinitionFromSettings,
  buildPresetIdFromName,
  upsertListingAssignment,
  removeListingAssignment,
} from "../../src/preset-authoring.js";
import {
  buildPresetLines,
  setPresetRegistryForTests,
} from "../../src/presets.js";

const makeSettings = () => ({
  text: "Morgan\nRN",
  presetId: "preset-c3e8a1d7f520",
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

const createDefaultLineSettings = () => ({
  fontId: "candlepin",
  bridgeMm: 0.5,
  lineBridgeMm: 0.5,
  offsetXMm: 0,
  fontSizeMm: 34,
  horizontalScale: 1,
  verticalScale: 1,
  lockTextHeight: false,
});

describe("preset authoring", () => {
  it("infers shared line defaults plus first and remaining rules from editor settings", () => {
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
        match: { kind: "remaining" },
        settings: { fontId: "somekind", fontSizeMm: 23, lockTextHeight: true },
      },
    ]);
  });

  it("infers size guide as a reusable global default", () => {
    const preset = inferPresetDefinitionFromSettings({
      name: "Default Size",
      settings: {
        text: "Mark",
        boundingSizePresetId: "size-2-2x1-5",
        backingMm: 3.1,
        weldExportedDesign: true,
        lines: [createDefaultLineSettings()],
      },
    });

    expect(preset.globalDefaults).toMatchObject({
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
    });
  });

  it("round-trips inferred reusable rules through the preset builder for a third line", () => {
    const preset = inferPresetDefinitionFromSettings({
      name: "Skywalk RN",
      settings: makeSettings(),
    });

    setPresetRegistryForTests({ defaultPresetId: preset.id }, [preset]);

    try {
      const lines = buildPresetLines(preset.id, 3, createDefaultLineSettings);

      expect(lines).toEqual([
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
      ]);
    } finally {
      setPresetRegistryForTests();
    }
  });

  it("does not infer a remaining rule when all later line diffs are unique", () => {
    const preset = inferPresetDefinitionFromSettings({
      name: "Skywalk Tech",
      settings: {
        ...makeSettings(),
        lines: [
          makeSettings().lines[0],
          makeSettings().lines[1],
          {
            fontId: "candlepin",
            bridgeMm: 0.5,
            lineBridgeMm: 0.5,
            offsetXMm: 0,
            fontSizeMm: 21,
            horizontalScale: 1,
            verticalScale: 1,
            lockTextHeight: false,
          },
        ],
      },
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
      {
        match: { kind: "index", lineIndex: 2 },
        settings: { fontId: "candlepin", fontSizeMm: 21, lockTextHeight: false },
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

  it("preserves existing listing overrides when replacement passes undefined or null lineOverrides", () => {
    const preset = {
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: {},
      lineRules: [{ match: { kind: "all" }, settings: {} }],
      listingAssignments: [
        {
          listingId: "1884223710",
          name: "PICU Badge Reel",
          lineOverrides: [{ lineIndex: 1, settings: { fontSizeMm: 23 } }],
        },
      ],
    };

    expect(
      upsertListingAssignment({
        preset,
        assignment: {
          listingId: "1884223710",
          name: "PICU Badge Reel Updated",
          lineOverrides: undefined,
        },
      }).listingAssignments,
    ).toEqual([
      {
        listingId: "1884223710",
        name: "PICU Badge Reel Updated",
        lineOverrides: [{ lineIndex: 1, settings: { fontSizeMm: 23 } }],
      },
    ]);

    expect(
      upsertListingAssignment({
        preset,
        assignment: {
          listingId: "1884223710",
          name: "PICU Badge Reel Updated",
          lineOverrides: null,
        },
      }).listingAssignments,
    ).toEqual([
      {
        listingId: "1884223710",
        name: "PICU Badge Reel Updated",
        lineOverrides: [{ lineIndex: 1, settings: { fontSizeMm: 23 } }],
      },
    ]);
  });

  it("keeps existing listing overrides when replacing an assignment without new overrides", () => {
    const preset = upsertListingAssignment({
      preset: {
        id: "skywalk-rn",
        name: "Skywalk RN",
        lineDefaults: {},
        lineRules: [{ match: { kind: "all" }, settings: {} }],
        listingAssignments: [
          {
            listingId: "1884223710",
            name: "PICU Badge Reel",
            lineOverrides: [
              { lineIndex: 1, settings: { fontSizeMm: 23 } },
            ],
          },
        ],
      },
      assignment: {
        listingId: "1884223710",
        name: "PICU Badge Reel Updated",
      },
    });

    expect(preset.listingAssignments).toEqual([
      {
        listingId: "1884223710",
        name: "PICU Badge Reel Updated",
        lineOverrides: [
          { lineIndex: 1, settings: { fontSizeMm: 23 } },
        ],
      },
    ]);
  });

  it("keeps existing preset listings when assigning a different listing to the same preset", () => {
    const preset = upsertListingAssignment({
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
      assignment: {
        listingId: "new-listing-17",
        name: "Updated Listing",
      },
    });

    expect(preset.listingAssignments).toEqual([
      { listingId: "1884223710", name: "PICU Badge Reel", lineOverrides: [] },
      { listingId: "4465975709", name: "Tech Reel", lineOverrides: [] },
      {
        listingId: "new-listing-17",
        name: "Updated Listing",
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
