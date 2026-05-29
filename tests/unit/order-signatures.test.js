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
      version: 2,
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

    expect(candidates).toHaveLength(2);
    expect(JSON.parse(candidates[0])).toMatchObject({
      version: 2,
      lines: [{ horizontalScale: 1.2, lockTextHeight: true }],
    });
    expect(JSON.parse(candidates[1])).toMatchObject({
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
    expect(JSON.parse(candidates[1]).lines[0]).not.toHaveProperty("lockTextHeight");
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
});
