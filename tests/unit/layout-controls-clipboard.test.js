import { describe, expect, it } from "vitest";

import {
  applyLayoutControlsSnapshot,
  buildLayoutControlsSnapshot,
} from "../../src/layout-controls-clipboard.js";

describe("layout controls clipboard", () => {
  it("captures only layout-control fields in the snapshot", () => {
    const snapshot = buildLayoutControlsSnapshot({
      id: "order-17",
      label: "Order #17",
      customerName: "Jamie",
      text: "Jamie\nRN",
      settings: {
        text: "Jamie\nRN",
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.2,
        weldExportedDesign: true,
        listingId: "listing-123",
        metadata: { createdBy: "user" },
        lines: [
          {
            text: "Jamie",
            fontId: "skywalk",
            bridgeMm: 0.5,
            lineBridgeMm: 0.75,
            offsetXMm: 1.2,
            fontSizeMm: 18,
            horizontalScale: 1.1,
            verticalScale: 0.95,
            lockTextHeight: true,
            previewOnly: "ignore me",
          },
        ],
      },
      source: {
        marketplace: "etsy",
      },
    });

    expect(snapshot).toEqual({
      sourceOrderId: "order-17",
      sourceOrderLabel: "Order #17",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.2,
        weldExportedDesign: true,
        lines: [
          {
            fontId: "skywalk",
            bridgeMm: 0.5,
            lineBridgeMm: 0.75,
            offsetXMm: 1.2,
            fontSizeMm: 18,
            horizontalScale: 1.1,
            verticalScale: 0.95,
            lockTextHeight: true,
          },
        ],
      },
    });
  });

  it("uses null for a missing source order label", () => {
    const snapshot = buildLayoutControlsSnapshot({
      id: "order-18",
      settings: {
        presetId: "preset-a1f4c8e2b601",
        backingMm: 2.2,
        weldExportedDesign: false,
        lines: [],
      },
    });

    expect(snapshot).toEqual({
      sourceOrderId: "order-18",
      sourceOrderLabel: null,
      settings: {
        presetId: "preset-a1f4c8e2b601",
        backingMm: 2.2,
        weldExportedDesign: false,
        lines: [],
      },
    });
  });

  it("ignores malformed non-object line entries when building a snapshot", () => {
    const snapshot = buildLayoutControlsSnapshot({
      id: "order-19",
      label: "Malformed Source",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.2,
        weldExportedDesign: true,
        lines: [
          null,
          "bad-line",
          {
            fontId: "skywalk",
            bridgeMm: 0.5,
            lineBridgeMm: 0.75,
            offsetXMm: 1.2,
            fontSizeMm: 18,
            horizontalScale: 1.1,
            verticalScale: 0.95,
            lockTextHeight: true,
          },
        ],
      },
    });

    expect(snapshot.settings.lines).toEqual([
      {},
      {},
      {
        fontId: "skywalk",
        bridgeMm: 0.5,
        lineBridgeMm: 0.75,
        offsetXMm: 1.2,
        fontSizeMm: 18,
        horizontalScale: 1.1,
        verticalScale: 0.95,
        lockTextHeight: true,
      },
    ]);
  });

  it("applies copied controls line-by-line to matching indexes", () => {
    const targetSettings = {
      presetId: "preset-a1f4c8e2b601",
      backingMm: 2.2,
      weldExportedDesign: false,
      text: "Taylor\nMD",
      lines: [
        {
          text: "Taylor",
          fontId: "candlepin",
          bridgeMm: 0.2,
          lineBridgeMm: 0.3,
          offsetXMm: 0,
          fontSizeMm: 12,
          horizontalScale: 1,
          verticalScale: 1,
          lockTextHeight: false,
        },
        {
          text: "MD",
          fontId: "somekind",
          bridgeMm: 0.4,
          lineBridgeMm: 0.5,
          offsetXMm: 0.8,
          fontSizeMm: 10,
          horizontalScale: 0.9,
          verticalScale: 1.1,
          lockTextHeight: true,
        },
      ],
    };
    const snapshot = {
      sourceOrderId: "order-1",
      sourceOrderLabel: "Source Order",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3,
        weldExportedDesign: true,
        lines: [
          {
            fontId: "skywalk",
            bridgeMm: 0.7,
            lineBridgeMm: 0.8,
            offsetXMm: 1.1,
            fontSizeMm: 20,
            horizontalScale: 1.2,
            verticalScale: 0.8,
            lockTextHeight: true,
          },
          {
            fontId: "somekind",
            bridgeMm: 0.6,
            lineBridgeMm: 0.4,
            offsetXMm: -0.3,
            fontSizeMm: 11,
            horizontalScale: 1.05,
            verticalScale: 1.15,
            lockTextHeight: false,
          },
        ],
      },
    };

    expect(applyLayoutControlsSnapshot(targetSettings, snapshot)).toEqual({
      appliedLineCount: 2,
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3,
        weldExportedDesign: true,
        text: "Taylor\nMD",
        lines: [
          {
            text: "Taylor",
            fontId: "skywalk",
            bridgeMm: 0.7,
            lineBridgeMm: 0.8,
            offsetXMm: 1.1,
            fontSizeMm: 20,
            horizontalScale: 1.2,
            verticalScale: 0.8,
            lockTextHeight: true,
          },
          {
            text: "MD",
            fontId: "somekind",
            bridgeMm: 0.6,
            lineBridgeMm: 0.4,
            offsetXMm: -0.3,
            fontSizeMm: 11,
            horizontalScale: 1.05,
            verticalScale: 1.15,
            lockTextHeight: false,
          },
        ],
      },
    });
  });

  it("preserves unmatched target lines when the snapshot has fewer copied lines", () => {
    const targetSettings = {
      presetId: "preset-a1f4c8e2b601",
      backingMm: 2.2,
      weldExportedDesign: false,
      lines: [
        {
          fontId: "candlepin",
          bridgeMm: 0.2,
          lineBridgeMm: 0.3,
          offsetXMm: 0,
          fontSizeMm: 12,
          horizontalScale: 1,
          verticalScale: 1,
          lockTextHeight: false,
          text: "Taylor",
        },
        {
          fontId: "somekind",
          bridgeMm: 0.4,
          lineBridgeMm: 0.5,
          offsetXMm: 0.8,
          fontSizeMm: 10,
          horizontalScale: 0.9,
          verticalScale: 1.1,
          lockTextHeight: true,
          text: "BSN",
        },
      ],
    };
    const snapshot = {
      sourceOrderId: "order-2",
      sourceOrderLabel: "Single Line",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [
          {
            fontId: "skywalk",
            bridgeMm: 0.9,
            lineBridgeMm: 0.6,
            offsetXMm: 0.4,
            fontSizeMm: 19,
            horizontalScale: 1.15,
            verticalScale: 0.85,
            lockTextHeight: true,
          },
        ],
      },
    };

    expect(applyLayoutControlsSnapshot(targetSettings, snapshot)).toEqual({
      appliedLineCount: 1,
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [
          {
            fontId: "skywalk",
            bridgeMm: 0.9,
            lineBridgeMm: 0.6,
            offsetXMm: 0.4,
            fontSizeMm: 19,
            horizontalScale: 1.15,
            verticalScale: 0.85,
            lockTextHeight: true,
            text: "Taylor",
          },
          {
            fontId: "somekind",
            bridgeMm: 0.4,
            lineBridgeMm: 0.5,
            offsetXMm: 0.8,
            fontSizeMm: 10,
            horizontalScale: 0.9,
            verticalScale: 1.1,
            lockTextHeight: true,
            text: "BSN",
          },
        ],
      },
    });
  });

  it("clones unmatched target lines instead of reusing the original objects", () => {
    const targetSettings = {
      presetId: "preset-a1f4c8e2b601",
      backingMm: 2.2,
      weldExportedDesign: false,
      lines: [
        {
          fontId: "candlepin",
          bridgeMm: 0.2,
          lineBridgeMm: 0.3,
          offsetXMm: 0,
          fontSizeMm: 12,
          horizontalScale: 1,
          verticalScale: 1,
          lockTextHeight: false,
          text: "Taylor",
        },
        {
          fontId: "somekind",
          bridgeMm: 0.4,
          lineBridgeMm: 0.5,
          offsetXMm: 0.8,
          fontSizeMm: 10,
          horizontalScale: 0.9,
          verticalScale: 1.1,
          lockTextHeight: true,
          text: "BSN",
        },
      ],
    };
    const snapshot = {
      sourceOrderId: "order-2",
      sourceOrderLabel: "Single Line",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [
          {
            fontId: "skywalk",
            bridgeMm: 0.9,
            lineBridgeMm: 0.6,
            offsetXMm: 0.4,
            fontSizeMm: 19,
            horizontalScale: 1.15,
            verticalScale: 0.85,
            lockTextHeight: true,
          },
        ],
      },
    };

    const result = applyLayoutControlsSnapshot(targetSettings, snapshot);

    expect(result.settings.lines[0]).not.toBe(targetSettings.lines[0]);
    expect(result.settings.lines[1]).not.toBe(targetSettings.lines[1]);
    expect(result.settings.lines[1]).toEqual(targetSettings.lines[1]);
  });

  it("treats malformed source and target line entries as empty objects when applying a snapshot", () => {
    const result = applyLayoutControlsSnapshot({
      presetId: "preset-a1f4c8e2b601",
      backingMm: 2.2,
      weldExportedDesign: false,
      lines: [null, "bad-target"],
    }, {
      sourceOrderId: "order-3",
      sourceOrderLabel: "Malformed Apply",
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [null, { fontId: "somekind", fontSizeMm: 11 }],
      },
    });

    expect(result).toEqual({
      appliedLineCount: 2,
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [
          {},
          { fontId: "somekind", fontSizeMm: 11 },
        ],
      },
    });
  });

  it("copies and pastes the size guide id as a global layout setting", () => {
    const snapshot = buildLayoutControlsSnapshot({
      id: "order-1",
      label: "Design 1",
      settings: {
        text: "Mark",
        presetId: "preset-a1f4c8e2b601",
        boundingSizePresetId: "size-2-2x1-5",
        backingMm: 3.1,
        weldExportedDesign: true,
        lines: [],
      },
    });

    const result = applyLayoutControlsSnapshot(
      {
        text: "Avery",
        presetId: "preset-c3e8a1d7f520",
        boundingSizePresetId: "size-old",
        backingMm: 4,
        weldExportedDesign: false,
        lines: [],
      },
      snapshot,
    );

    expect(result.settings.boundingSizePresetId).toBe("size-2-2x1-5");
  });

  it("captures fixed SVG line controls without fixed design library metadata", () => {
    const snapshot = buildLayoutControlsSnapshot({
      id: "order-fixed",
      label: "Fixed Source",
      settings: {
        presetId: "preset-a1f4c8e2b601",
        backingMm: 3.1,
        weldExportedDesign: true,
        lines: [
          {
            kind: "fixedSvg",
            fixedDesignId: "fixed-design-1",
            fixedDesignName: "Nurse Cross",
            fixedDesignVersion: 3,
            svgSizeMm: 38,
            offsetXMm: 2,
            offsetYMm: -7,
            backingBorder: true,
            publicUrl: "https://example.invalid/nurse-cross.svg",
            storagePath: "do-not-copy",
          },
        ],
      },
    });

    expect(snapshot.settings.lines).toEqual([
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-1",
        fixedDesignName: "Nurse Cross",
        fixedDesignVersion: 3,
        svgSizeMm: 38,
        offsetXMm: 2,
        offsetYMm: -7,
        backingBorder: true,
      },
    ]);
  });

  it("pastes fixed SVG controls onto matching ordered fixed SVG slots", () => {
    const result = applyLayoutControlsSnapshot(
      {
        presetId: "preset-a1f4c8e2b601",
        backingMm: 2.2,
        weldExportedDesign: false,
        lines: [
          {
            kind: "text",
            fontId: "candlepin",
            fontSizeMm: 22,
          },
          {
            kind: "fixedSvg",
            fixedDesignId: "fixed-design-old",
            fixedDesignName: "Old",
            fixedDesignVersion: 1,
            svgSizeMm: 24,
            offsetXMm: 0,
            offsetYMm: 0,
          },
        ],
      },
      {
        sourceOrderId: "source-fixed",
        sourceOrderLabel: "Source Fixed",
        settings: {
          presetId: "preset-c3e8a1d7f520",
          backingMm: 3.4,
          weldExportedDesign: true,
          lines: [
            {
              kind: "text",
              fontId: "skywalk",
              fontSizeMm: 30,
              bridgeMm: 0.8,
            },
            {
              kind: "fixedSvg",
              fixedDesignId: "fixed-design-new",
              fixedDesignName: "New",
              fixedDesignVersion: 4,
              svgSizeMm: 42,
              offsetXMm: 3,
              offsetYMm: -5,
              backingBorder: true,
            },
          ],
        },
      },
    );

    expect(result).toEqual({
      appliedLineCount: 2,
      settings: {
        presetId: "preset-c3e8a1d7f520",
        backingMm: 3.4,
        weldExportedDesign: true,
        lines: [
          {
            kind: "text",
            fontId: "skywalk",
            fontSizeMm: 30,
            bridgeMm: 0.8,
          },
          {
            kind: "fixedSvg",
            fixedDesignId: "fixed-design-new",
            fixedDesignName: "New",
            fixedDesignVersion: 4,
            svgSizeMm: 42,
            offsetXMm: 3,
            offsetYMm: -5,
            backingBorder: true,
          },
        ],
      },
    });
  });
});
