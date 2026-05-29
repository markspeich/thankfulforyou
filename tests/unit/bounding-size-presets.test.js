import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  getBoundingSizePresetDefinitions,
  getBoundingSizePresetOptions,
  isBuiltInBoundingSizePresetId,
  isValidBoundingSizePresetId,
  normalizeBoundingSizePresetDefinition,
  resolveBoundingSizePreset,
  setBoundingSizePresetDefinitionsForTests,
} from "../../src/bounding-size-presets.js";

describe("size guides", () => {
  beforeEach(() => {
    setBoundingSizePresetDefinitionsForTests();
  });

  it("resolves the default 2.2 by 1.5 inch guide in millimeters", () => {
    const preset = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID);

    expect(preset.id).toBe("size-2-2x1-5");
    expect(preset.maxWidthMm).toBeCloseTo(55.88, 6);
    expect(preset.maxHeightMm).toBeCloseTo(38.1, 6);
    expect(preset.minWidthMm).toBeCloseTo(40.64, 6);
    expect(preset.minHeightMm).toBeCloseTo(27.94, 6);
    expect(preset.circleDiameterIn).toBe(1.25);
    expect(preset.circleDiameterMm).toBeCloseTo(31.75, 6);
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

  it("normalizes custom inch definitions for snapshot persistence", () => {
    expect(normalizeBoundingSizePresetDefinition({
      id: "size-test",
      label: "Test Size",
      max: { widthIn: "3", heightIn: "2" },
      min: { widthIn: "1.25", heightIn: "1" },
      circleDiameterIn: "1.5",
    })).toEqual({
      id: "size-test",
      label: "Test Size",
      max: { widthIn: 3, heightIn: 2 },
      min: { widthIn: 1.25, heightIn: 1 },
      circleDiameterIn: 1.5,
    });
  });

  it("allows custom presets to omit the center circle", () => {
    const definition = normalizeBoundingSizePresetDefinition({
      id: "size-no-circle",
      label: "No Circle",
      max: { widthIn: 3, heightIn: 2 },
      min: { widthIn: 2, heightIn: 1.25 },
      circleDiameterIn: "",
    });

    expect(definition).not.toHaveProperty("circleDiameterIn");

    setBoundingSizePresetDefinitionsForTests([definition]);
    expect(resolveBoundingSizePreset("size-no-circle")).toMatchObject({
      id: "size-no-circle",
      circleDiameterIn: null,
      circleDiameterMm: null,
    });
  });

  it("rejects invalid custom size dimensions", () => {
    expect(() => normalizeBoundingSizePresetDefinition({
      id: "size-bad",
      label: "Bad",
      max: { widthIn: 1, heightIn: 1 },
      min: { widthIn: 1.2, heightIn: 1 },
    })).toThrow("Minimum width cannot be larger than maximum width.");

    expect(() => normalizeBoundingSizePresetDefinition({
      id: "size-bad",
      label: "Bad",
      max: { widthIn: 1, heightIn: 1 },
      min: { widthIn: 0, heightIn: 0.8 },
    })).toThrow("Minimum width must be greater than 0.");

    expect(() => normalizeBoundingSizePresetDefinition({
      id: "size-bad-circle",
      label: "Bad Circle",
      max: { widthIn: 1, heightIn: 1 },
      min: { widthIn: 0.8, heightIn: 0.8 },
      circleDiameterIn: "-1",
    })).toThrow("Circle diameter must be greater than 0.");
  });

  it("uses active custom size guides for options and resolution", () => {
    setBoundingSizePresetDefinitionsForTests([
      {
        id: "size-custom",
        label: "Custom Test",
        max: { widthIn: 3, heightIn: 2 },
        min: { widthIn: 2, heightIn: 1.25 },
      },
    ]);

    expect(getBoundingSizePresetOptions()).toEqual([
      { id: "size-2-2x1-5", label: "2.2 x 1.5 in" },
      { id: "size-custom", label: "Custom Test" },
    ]);
    expect(resolveBoundingSizePreset("size-custom")).toMatchObject({
      id: "size-custom",
      maxWidthIn: 3,
      maxHeightIn: 2,
      minWidthIn: 2,
      minHeightIn: 1.25,
    });
    expect(getBoundingSizePresetDefinitions()).toEqual([
      {
        id: "size-2-2x1-5",
        label: "2.2 x 1.5 in",
        max: { widthIn: 2.2, heightIn: 1.5 },
        min: { widthIn: 1.6, heightIn: 1.1 },
        circleDiameterIn: 1.25,
      },
      {
        id: "size-custom",
        label: "Custom Test",
        max: { widthIn: 3, heightIn: 2 },
        min: { widthIn: 2, heightIn: 1.25 },
      },
    ]);
  });

  it("tracks the bundled default as built-in", () => {
    expect(isBuiltInBoundingSizePresetId(DEFAULT_BOUNDING_SIZE_PRESET_ID)).toBe(true);
    expect(isBuiltInBoundingSizePresetId("size-custom")).toBe(false);
  });
});
