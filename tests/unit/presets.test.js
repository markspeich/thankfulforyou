import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPresetLines,
  getDefaultPresetId,
  getPresetGlobalDefaults,
  getPresetOptions,
  getPresetIdForListingId,
  setPresetRegistryForTests,
} from "../../src/presets.js";
import { buildPresetIdFromName } from "../../src/preset-authoring.js";

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

describe("presets", () => {
  beforeEach(() => {
    setPresetRegistryForTests();
  });

  it("exposes preset options from the active registry", () => {
    expect(getDefaultPresetId()).toBe("all-candlepin");
    expect(getPresetOptions()).toEqual([
      { id: "all-candlepin", label: "All Candlepin" },
      { id: "candlepin-skywalk", label: "Candlepin, Skywalk" },
      { id: "skywalk-somekind", label: "Skywalk, Somekind" },
      { id: "skywalk-candlepin", label: "Skywalk, Candlepin" },
    ]);
  });

  it("keeps preset authoring ids aligned with the operator-facing preset names", () => {
    expect(buildPresetIdFromName("Skywalk, Somekind")).toBe("skywalk-somekind");
  });

  it("maps every line to Candlepin for the all-candlepin preset", () => {
    const lines = buildPresetLines("all-candlepin", 4, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "candlepin",
      "candlepin",
      "candlepin",
      "candlepin",
    ]);
  });

  it("maps the first line to Skywalk and remaining lines to Somekind", () => {
    const lines = buildPresetLines("skywalk-somekind", 5, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "skywalk",
      "somekind",
      "somekind",
      "somekind",
      "somekind",
    ]);
  });

  it("maps the first line to Skywalk and remaining lines to Candlepin", () => {
    const lines = buildPresetLines("skywalk-candlepin", 3, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "skywalk",
      "candlepin",
      "candlepin",
    ]);
  });

  it("maps the first line to Candlepin and remaining lines to Skywalk", () => {
    const lines = buildPresetLines("candlepin-skywalk", 4, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "candlepin",
      "skywalk",
      "skywalk",
      "skywalk",
    ]);
  });

  it("resets every generated line to the preset defaults before assigning rule overrides", () => {
    const lines = buildPresetLines("skywalk-somekind", 3, createDefaultLineSettings);

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
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
    ]);
  });

  it("includes lockTextHeight in generated line defaults", () => {
    const lines = buildPresetLines("all-candlepin", 2, createDefaultLineSettings);

    expect(lines).toEqual([
      {
        fontId: "candlepin",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
      {
        fontId: "candlepin",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
    ]);
  });

  it("applies the listing-specific line 2 height override for listing 1884223710", () => {
    const lines = buildPresetLines("skywalk-somekind", 4, createDefaultLineSettings, {
      listingId: "1884223710",
    });

    expect(lines[0]).toEqual({
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 18,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
    expect(lines[1]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 23,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: true,
    });
    expect(lines[2]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
  });

  it("applies the listing-specific line 2 height override for listing 4465975709", () => {
    const lines = buildPresetLines("skywalk-candlepin", 4, createDefaultLineSettings, {
      listingId: "4465975709",
    });

    expect(lines[0]).toEqual({
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
    expect(lines[1]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 21,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
    expect(lines[2]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
  });

  it("applies the listing-specific line 1 height override for listing 4439916732", () => {
    const lines = buildPresetLines("candlepin-skywalk", 4, createDefaultLineSettings, {
      listingId: "4439916732",
    });

    expect(lines[0]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 44,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
    expect(lines[1]).toEqual({
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    });
  });

  it("preserves lockTextHeight overrides coming from preset data", () => {
    setPresetRegistryForTests(
      { defaultPresetId: "custom-lock" },
      [
        {
          schemaVersion: 1,
          id: "custom-lock",
          name: "Custom Lock",
          lineDefaults: {
            fontId: "candlepin",
            bridgeMm: 0.5,
            lineBridgeMm: 0.5,
            offsetXMm: 0,
            fontSizeMm: 34,
            horizontalScale: 1,
            verticalScale: 1,
            lockTextHeight: false,
          },
          lineRules: [
            {
              match: { kind: "first" },
              settings: { lockTextHeight: true },
            },
          ],
        },
      ],
    );

    const lines = buildPresetLines("custom-lock", 2, createDefaultLineSettings);
    expect(lines.map((line) => line.lockTextHeight)).toEqual([true, false]);
  });

  it("preserves horizontalScale overrides coming from preset data", () => {
    setPresetRegistryForTests(
      { defaultPresetId: "custom-width" },
      [
        {
          schemaVersion: 1,
          id: "custom-width",
          name: "Custom Width",
          lineDefaults: {
            fontId: "candlepin",
            bridgeMm: 0.5,
            lineBridgeMm: 0.5,
            offsetXMm: 0,
            fontSizeMm: 34,
            horizontalScale: 1,
            verticalScale: 1,
            lockTextHeight: false,
          },
          lineRules: [
            {
              match: { kind: "first" },
              settings: { horizontalScale: 1.25 },
            },
          ],
        },
      ],
    );

    const lines = buildPresetLines("custom-width", 2, createDefaultLineSettings);
    expect(lines.map((line) => line.horizontalScale)).toEqual([1.25, 1]);
  });

  it("returns preset-level global defaults", () => {
    expect(getPresetGlobalDefaults("skywalk-somekind")).toEqual({
      backingMm: 2.2,
      weldExportedDesign: true,
    });
  });

  it("maps listing ids to preset ids from preset data", () => {
    expect(getPresetIdForListingId("1884223710")).toBe("skywalk-somekind");
    expect(getPresetIdForListingId("4439916732")).toBe("candlepin-skywalk");
    expect(getPresetIdForListingId("4465975709")).toBe("skywalk-candlepin");
    expect(getPresetIdForListingId("unknown")).toBe("all-candlepin");
  });
});
