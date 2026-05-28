import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  getBoundingSizePresetOptions,
  isValidBoundingSizePresetId,
  resolveBoundingSizePreset,
} from "../../src/bounding-size-presets.js";

describe("bounding size presets", () => {
  it("resolves the default 2.2 by 1.5 inch guide in millimeters", () => {
    const preset = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID);

    expect(preset.id).toBe("size-2-2x1-5");
    expect(preset.maxWidthMm).toBeCloseTo(55.88, 6);
    expect(preset.maxHeightMm).toBeCloseTo(38.1, 6);
    expect(preset.minWidthMm).toBeCloseTo(40.64, 6);
    expect(preset.minHeightMm).toBeCloseTo(27.94, 6);
  });

  it("falls back to the default when an unknown id is provided", () => {
    expect(resolveBoundingSizePreset("missing").id).toBe(DEFAULT_BOUNDING_SIZE_PRESET_ID);
    expect(isValidBoundingSizePresetId("missing")).toBe(false);
  });

  it("exposes operator-facing options", () => {
    expect(getBoundingSizePresetOptions()).toEqual([
      {
        id: "size-2-2x1-5",
        label: "2.2 x 1.5 in",
      },
    ]);
  });
});
