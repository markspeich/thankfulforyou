import { describe, expect, it, vi } from "vitest";

import { buildReloadedPresetSettings } from "../../src/preset-selection.js";

describe("preset selection", () => {
  it("rebuilds all layout settings from the selected preset while preserving the current text", () => {
    const normalizeSettings = vi.fn((settings) => ({
      text: settings.text ?? "Avery\nRN",
      presetId: settings.presetId ?? "preset-old",
      backingMm: settings.backingMm ?? 9.9,
      weldExportedDesign: settings.weldExportedDesign ?? false,
      lines: settings.lines ?? [],
    }));
    const getPresetBaseSettings = vi.fn(() => ({
      backingMm: 2.2,
      weldExportedDesign: true,
    }));
    const createDefaultLineSettings = vi.fn(() => ({
      fontId: "candlepin",
      bridgeMm: 0.5,
    }));
    const buildPresetLines = vi.fn(() => ([
      { fontId: "skywalk", bridgeMm: 0.6 },
      { fontId: "somekind", bridgeMm: 0.7 },
    ]));
    const getRawTextLines = vi.fn(() => ["Avery", "RN"]);

    const result = buildReloadedPresetSettings({
      settings: {
        text: "Avery\nRN",
        presetId: "preset-old",
        backingMm: 8.8,
        weldExportedDesign: false,
        lines: [
          { fontId: "custom-1", bridgeMm: 1.2 },
          { fontId: "custom-2", bridgeMm: 1.3 },
        ],
      },
      presetId: "preset-new",
      listingId: "listing-17",
      normalizeSettings,
      getPresetBaseSettings,
      buildPresetLines,
      createDefaultLineSettings,
      getRawTextLines,
    });

    expect(getPresetBaseSettings).toHaveBeenCalledWith("preset-new");
    expect(buildPresetLines).toHaveBeenCalledWith("preset-new", 2, createDefaultLineSettings, {
      listingId: "listing-17",
    });
    expect(result).toEqual({
      text: "Avery\nRN",
      presetId: "preset-new",
      backingMm: 2.2,
      weldExportedDesign: true,
      lines: [
        { fontId: "skywalk", bridgeMm: 0.6 },
        { fontId: "somekind", bridgeMm: 0.7 },
      ],
    });
  });
});
