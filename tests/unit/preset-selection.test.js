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

  it("rebuilds size guide from the selected preset", () => {
    const normalizeSettings = vi.fn((settings) => ({
      text: settings.text ?? "Mark",
      presetId: settings.presetId ?? "preset-old",
      boundingSizePresetId: settings.boundingSizePresetId ?? "size-small",
      backingMm: settings.backingMm ?? 8.8,
      weldExportedDesign: settings.weldExportedDesign ?? false,
      lines: settings.lines ?? [],
    }));

    const result = buildReloadedPresetSettings({
      settings: {
        text: "Mark",
        boundingSizePresetId: "size-small",
        backingMm: 8.8,
        weldExportedDesign: false,
        lines: [],
      },
      presetId: "preset-new",
      getPresetBaseSettings: () => ({
        boundingSizePresetId: "size-2-2x1-5",
        backingMm: 3.1,
        weldExportedDesign: true,
      }),
      buildPresetLines: () => [],
      createDefaultLineSettings: () => ({}),
      getRawTextLines: () => [],
      normalizeSettings,
    });

    expect(result.boundingSizePresetId).toBe("size-2-2x1-5");
  });

  it("appends reusable fixed SVG preset items after rebuilt text line settings", () => {
    const normalizeSettings = vi.fn((settings) => ({
      text: settings.text ?? "Avery\nRN",
      presetId: settings.presetId ?? "preset-old",
      backingMm: settings.backingMm ?? 9.9,
      weldExportedDesign: settings.weldExportedDesign ?? false,
      lines: settings.lines ?? [],
    }));
    const fixedItems = [
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-bow",
        fixedDesignName: "Bow",
        fixedDesignVersion: 2,
        svgSizeMm: 34,
        offsetXMm: 1,
        offsetYMm: -2,
      },
    ];

    const result = buildReloadedPresetSettings({
      settings: {
        text: "Avery\nRN",
        lines: [],
      },
      presetId: "preset-with-bow",
      normalizeSettings,
      getPresetBaseSettings: () => ({
        backingMm: 3.1,
        weldExportedDesign: true,
      }),
      buildPresetLines: () => ([
        { fontId: "skywalk", bridgeMm: 0.6 },
        { fontId: "somekind", bridgeMm: 0.7 },
      ]),
      getPresetFixedItems: () => fixedItems,
      createDefaultLineSettings: () => ({}),
      getRawTextLines: () => ["Avery", "RN"],
    });

    expect(result.lines).toEqual([
      { fontId: "skywalk", bridgeMm: 0.6 },
      { fontId: "somekind", bridgeMm: 0.7 },
      fixedItems[0],
    ]);
  });

  it("uses fixed design text when the selected preset supplies it", () => {
    const normalizeSettings = vi.fn((settings) => ({
      text: settings.text ?? "Original custom text",
      presetId: settings.presetId ?? "preset-old",
      backingMm: settings.backingMm ?? 8.8,
      weldExportedDesign: settings.weldExportedDesign ?? false,
      lines: settings.lines ?? [],
    }));
    const getRawTextLines = vi.fn((text) => String(text).split(/\r?\n/).filter(Boolean));
    const buildPresetLines = vi.fn(() => ([
      { fontId: "skywalk" },
      { fontId: "somekind" },
    ]));

    const result = buildReloadedPresetSettings({
      settings: {
        text: "Original custom text",
        presetId: "preset-old",
        backingMm: 8.8,
        weldExportedDesign: false,
      },
      presetId: "preset-radiology",
      fixedDesignText: "Radiology\nTech",
      getPresetBaseSettings: () => ({
        backingMm: 3.1,
        weldExportedDesign: true,
      }),
      buildPresetLines,
      createDefaultLineSettings: () => ({}),
      getRawTextLines,
      normalizeSettings,
    });

    expect(getRawTextLines).toHaveBeenCalledWith("Radiology\nTech");
    expect(buildPresetLines).toHaveBeenCalledWith("preset-radiology", 2, expect.any(Function), {
      listingId: null,
    });
    expect(result.text).toBe("Radiology\nTech");
    expect(result.lines).toEqual([
      { fontId: "skywalk" },
      { fontId: "somekind" },
    ]);
  });
});
