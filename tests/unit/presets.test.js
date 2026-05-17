import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPresetLines,
  getDefaultPresetId,
  getPresetGlobalDefaults,
  getPresetOptions,
  getPresetIdForListingId,
  setPresetRegistryForTests,
} from "../../src/presets.js";

const createDefaultLineSettings = () => ({
  fontId: "candlepin",
  bridgeMm: 0.5,
  lineBridgeMm: 0.5,
  offsetXMm: 0,
  fontSizeMm: 34,
  verticalScale: 1,
});

describe("presets", () => {
  beforeEach(() => {
    setPresetRegistryForTests();
  });

  it("exposes preset options from the active registry", () => {
    expect(getDefaultPresetId()).toBe("all-candlepin");
    expect(getPresetOptions()).toEqual([
      { id: "all-candlepin", label: "All Candlepin" },
      { id: "skywalk-somekind", label: "Skywalk, Somekind" },
      { id: "skywalk-candlepin", label: "Skywalk, Candlepin" },
    ]);
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

  it("resets every generated line to the preset defaults before assigning rule overrides", () => {
    const lines = buildPresetLines("skywalk-somekind", 3, createDefaultLineSettings);

    expect(lines).toEqual([
      {
        fontId: "skywalk",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        verticalScale: 1,
      },
      {
        fontId: "somekind",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        verticalScale: 1,
      },
      {
        fontId: "somekind",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        verticalScale: 1,
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
      fontSizeMm: 34,
      verticalScale: 1,
    });
    expect(lines[1]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 21,
      verticalScale: 1,
    });
    expect(lines[2]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      verticalScale: 1,
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
      verticalScale: 1,
    });
    expect(lines[1]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 21,
      verticalScale: 1,
    });
    expect(lines[2]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
      verticalScale: 1,
    });
  });

  it("returns preset-level global defaults", () => {
    expect(getPresetGlobalDefaults("skywalk-somekind")).toEqual({
      backingMm: 3.1,
      weldExportedDesign: true,
    });
  });

  it("maps listing ids to preset ids from preset data", () => {
    expect(getPresetIdForListingId("1884223710")).toBe("skywalk-somekind");
    expect(getPresetIdForListingId("4465975709")).toBe("skywalk-candlepin");
    expect(getPresetIdForListingId("unknown")).toBe("all-candlepin");
  });
});
