import { describe, expect, it } from "vitest";

import { buildPresetLines, getPresetFontIdForLine } from "../../src/presets.js";

describe("presets", () => {
  it("maps every line to Candlepin for the all-candlepin preset", () => {
    expect(getPresetFontIdForLine("all-candlepin", 0)).toBe("candlepin");
    expect(getPresetFontIdForLine("all-candlepin", 3)).toBe("candlepin");
  });

  it("maps the first line to Skywalk and remaining lines to Somekind", () => {
    expect(getPresetFontIdForLine("skywalk-somekind", 0)).toBe("skywalk");
    expect(getPresetFontIdForLine("skywalk-somekind", 1)).toBe("somekind");
    expect(getPresetFontIdForLine("skywalk-somekind", 4)).toBe("somekind");
  });

  it("maps the first line to Skywalk and remaining lines to Candlepin", () => {
    expect(getPresetFontIdForLine("skywalk-candlepin", 0)).toBe("skywalk");
    expect(getPresetFontIdForLine("skywalk-candlepin", 1)).toBe("candlepin");
    expect(getPresetFontIdForLine("skywalk-candlepin", 2)).toBe("candlepin");
  });

  it("resets every generated line to the preset defaults before assigning fonts", () => {
    const lines = buildPresetLines("skywalk-somekind", 3, () => ({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    }));

    expect(lines).toEqual([
      {
        fontId: "skywalk",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
      },
      {
        fontId: "somekind",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
      },
      {
        fontId: "somekind",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
      },
    ]);
  });

  it("applies the listing-specific line 2 height override for listing 1884223710", () => {
    const lines = buildPresetLines("skywalk-somekind", 4, () => ({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    }), {
      listingId: "1884223710",
    });

    expect(lines[0]).toEqual({
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    });
    expect(lines[1]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 21,
    });
    expect(lines[2]).toEqual({
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    });
  });

  it("applies the listing-specific line 2 height override for listing 4465975709", () => {
    const lines = buildPresetLines("skywalk-candlepin", 4, () => ({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    }), {
      listingId: "4465975709",
    });

    expect(lines[0]).toEqual({
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    });
    expect(lines[1]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 21,
    });
    expect(lines[2]).toEqual({
      fontId: "candlepin",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 34,
    });
  });
});
