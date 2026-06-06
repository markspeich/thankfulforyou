import { describe, expect, it } from "vitest";

import {
  buildSettingsSignature,
  getSettingsSignatureCandidates,
} from "../../src/order-signatures.js";

describe("order signatures", () => {
  it("includes lockTextHeight and horizontalScale in the current signature format", () => {
    const signature = buildSettingsSignature({
      text: "Mark\nRN",
      presetId: "preset-c3e8a1d7f520",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [
        {
          fontId: "skywalk",
          bridgeMm: 0.5,
          lineBridgeMm: 0.5,
          offsetXMm: 0,
          fontSizeMm: 34,
          horizontalScale: 1.2,
          verticalScale: 1,
          lockTextHeight: true,
        },
      ],
    });

    expect(JSON.parse(signature)).toMatchObject({
      version: 3,
      lines: [
        {
          horizontalScale: 1.2,
          lockTextHeight: true,
        },
      ],
    });
  });

  it("returns both current and legacy signatures for compatibility", () => {
    const candidates = getSettingsSignatureCandidates({
      text: "Mark",
      presetId: "preset-a1f4c8e2b601",
      backingMm: 3.1,
      weldExportedDesign: false,
      lines: [
        {
          fontId: "candlepin",
          bridgeMm: 0.5,
          lineBridgeMm: 0.5,
          offsetXMm: 0,
          fontSizeMm: 34,
          horizontalScale: 1.2,
          verticalScale: 1,
          lockTextHeight: true,
        },
      ],
    });

    expect(candidates).toHaveLength(3);
    expect(JSON.parse(candidates[0])).toMatchObject({
      version: 3,
      lines: [{ horizontalScale: 1.2, lockTextHeight: true }],
    });
    expect(JSON.parse(candidates[1])).toMatchObject({
      version: 2,
      lines: [{ horizontalScale: 1.2, lockTextHeight: true }],
    });
    expect(JSON.parse(candidates[2])).toMatchObject({
      lines: [
        {
          fontId: "candlepin",
          bridgeMm: 0.5,
          lineBridgeMm: 0.5,
          offsetXMm: 0,
          fontSizeMm: 34,
          horizontalScale: 1.2,
          verticalScale: 1,
        },
      ],
    });
    expect(JSON.parse(candidates[2]).lines[0]).not.toHaveProperty("lockTextHeight");
  });

  it("returns the pre-guide-fingerprint v2 signature for saved design compatibility", () => {
    const candidates = getSettingsSignatureCandidates({
      text: "Mark",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      boundingSizePresetFingerprint: "size-2-2x1-5|2.2|1.5|1.6|1.1|1.25",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [
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
      ],
    });

    expect(candidates.map((candidate) => JSON.parse(candidate))).toContainEqual(expect.objectContaining({
      version: 2,
      boundingSizePresetId: "size-2-2x1-5",
      lines: [expect.objectContaining({ lockTextHeight: false })],
    }));
  });

  it("changes the current settings signature when the size guide changes", () => {
    const baseSettings = {
      text: "Mark",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [],
    };

    expect(buildSettingsSignature({
      ...baseSettings,
      boundingSizePresetId: "size-other",
    })).not.toBe(buildSettingsSignature(baseSettings));
  });

  it("changes the current settings signature when a size guide keeps its id but changes dimensions", () => {
    const baseSettings = {
      text: "Mark",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-custom",
      boundingSizePresetFingerprint: "size-custom|3|2|2|1.25|",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [],
    };

    expect(buildSettingsSignature({
      ...baseSettings,
      boundingSizePresetFingerprint: "size-custom|3.25|2|2|1.25|",
    })).not.toBe(buildSettingsSignature(baseSettings));
  });

  it("includes fixed SVG identity and placement controls in the current signature format", () => {
    const baseSettings = {
      text: "Ava",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      boundingSizePresetFingerprint: "size-2-2x1-5|2.2|1.5|2.2|1.5|",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [
        {
          kind: "fixedSvg",
          fixedDesignId: "fixed-design-1",
          fixedDesignName: "Cardiology Heart",
          fixedDesignVersion: 2,
          svgSizeMm: 32,
          offsetXMm: 1.5,
          offsetYMm: -2.5,
        },
      ],
    };

    const parsed = JSON.parse(buildSettingsSignature(baseSettings));
    expect(parsed.lines[0]).toMatchObject({
      kind: "fixedSvg",
      fixedDesignId: "fixed-design-1",
      fixedDesignVersion: 2,
      svgSizeMm: 32,
      offsetXMm: 1.5,
      offsetYMm: -2.5,
    });

    for (const changedLine of [
      { fixedDesignId: "fixed-design-2" },
      { fixedDesignVersion: 3 },
      { svgSizeMm: 36 },
      { offsetXMm: 2 },
      { offsetYMm: -1 },
    ]) {
      expect(buildSettingsSignature({
        ...baseSettings,
        lines: [{ ...baseSettings.lines[0], ...changedLine }],
      })).not.toBe(buildSettingsSignature(baseSettings));
    }
  });
});
