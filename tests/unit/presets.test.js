import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildPresetLines,
  deletePresetDefinitionLocally,
  deleteBoundingSizePresetDefinitionLocally,
  getDefaultPresetId,
  getBoundingSizePresetDefinitionsForEditor,
  getPresetDefinitionForEditor,
  getPresetGlobalDefaults,
  getPresetOptions,
  getPresetSnapshot,
  getPresetIdForListingId,
  loadPresetRegistry,
  replacePresetDefinitionForTests,
  saveBoundingSizePresetDefinitionLocally,
  savePresetDefinitionLocally,
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes preset options from the active registry", () => {
    expect(getDefaultPresetId()).toBe("preset-a1f4c8e2b601");
    expect(getPresetOptions()).toEqual([
      { id: "preset-a1f4c8e2b601", label: "All Candlepin" },
      { id: "preset-b7d2e9f4c318", label: "Candlepin, Skywalk" },
      { id: "preset-c3e8a1d7f520", label: "Skywalk, Somekind" },
      { id: "preset-d9b4f2a6c731", label: "Skywalk, Candlepin" },
    ]);
  });

  it("keeps the authoring slug helper stable for name-based derivations", () => {
    expect(buildPresetIdFromName("Skywalk, Somekind")).toBe("skywalk-somekind");
  });

  it("maps every line to Candlepin for the preset-a1f4c8e2b601 preset", () => {
    const lines = buildPresetLines("preset-a1f4c8e2b601", 4, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "candlepin",
      "candlepin",
      "candlepin",
      "candlepin",
    ]);
  });

  it("maps the first line to Skywalk and remaining lines to Somekind", () => {
    const lines = buildPresetLines("preset-c3e8a1d7f520", 5, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "skywalk",
      "somekind",
      "somekind",
      "somekind",
      "somekind",
    ]);
  });

  it("maps the first line to Skywalk and remaining lines to Candlepin", () => {
    const lines = buildPresetLines("preset-d9b4f2a6c731", 3, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "skywalk",
      "candlepin",
      "candlepin",
    ]);
  });

  it("maps the first line to Candlepin and remaining lines to Skywalk", () => {
    const lines = buildPresetLines("preset-b7d2e9f4c318", 4, createDefaultLineSettings);

    expect(lines.map((line) => line.fontId)).toEqual([
      "candlepin",
      "skywalk",
      "skywalk",
      "skywalk",
    ]);
  });

  it("resets every generated line to the preset defaults before assigning rule overrides", () => {
    const lines = buildPresetLines("preset-c3e8a1d7f520", 3, createDefaultLineSettings);

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
    const lines = buildPresetLines("preset-a1f4c8e2b601", 2, createDefaultLineSettings);

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
    const lines = buildPresetLines("preset-c3e8a1d7f520", 4, createDefaultLineSettings, {
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
    const lines = buildPresetLines("preset-d9b4f2a6c731", 4, createDefaultLineSettings, {
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
    const lines = buildPresetLines("preset-b7d2e9f4c318", 4, createDefaultLineSettings, {
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

  it("can expose a full preset definition for authoring and replace it in the registry", async () => {
    setPresetRegistryForTests(
      { defaultPresetId: "preset-a1f4c8e2b601" },
      [
        {
          schemaVersion: 1,
          id: "preset-a1f4c8e2b601",
          name: "All Candlepin",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      ],
    );

    expect(getPresetDefinitionForEditor("preset-a1f4c8e2b601")?.name).toBe("All Candlepin");

    replacePresetDefinitionForTests({
      schemaVersion: 1,
      id: "preset-a1f4c8e2b601",
      name: "All Candlepin Updated",
      lineDefaults: { fontId: "candlepin" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
      listingAssignments: [],
    });

    expect(getPresetDefinitionForEditor("preset-a1f4c8e2b601")?.name).toBe("All Candlepin Updated");
  });

  it("returns null for unknown preset ids in the editor accessor", () => {
    expect(getPresetDefinitionForEditor("does-not-exist")).toBeNull();
  });

  it("returns preset-level global defaults", () => {
    expect(getPresetGlobalDefaults("preset-c3e8a1d7f520")).toEqual({
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
    });
  });

  it("returns preset-level size guide defaults", () => {
    expect(getPresetGlobalDefaults("preset-a1f4c8e2b601")).toEqual({
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
    });
  });

  it("migrates old built-in preset backing defaults to the current production default", () => {
    setPresetRegistryForTests(
      { defaultPresetId: "preset-a1f4c8e2b601" },
      [
        {
          schemaVersion: 1,
          id: "preset-a1f4c8e2b601",
          name: "All Candlepin",
          globalDefaults: {
            backingMm: 2.2,
            weldExportedDesign: true,
          },
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      ],
    );

    expect(getPresetGlobalDefaults("preset-a1f4c8e2b601").backingMm).toBe(3.1);
  });

  it("maps listing ids to preset ids from preset data", () => {
    expect(getPresetIdForListingId("1884223710")).toBe("preset-c3e8a1d7f520");
    expect(getPresetIdForListingId("4439916732")).toBe("preset-b7d2e9f4c318");
    expect(getPresetIdForListingId("4465975709")).toBe("preset-d9b4f2a6c731");
    expect(getPresetIdForListingId("unknown")).toBe("preset-a1f4c8e2b601");
  });

  it("loads remote preset snapshots without consulting browser local storage", async () => {
    const remoteSnapshot = {
      version: 1,
      defaultPresetId: "preset-remote",
      sizePresets: [
        {
          id: "size-remote",
          label: "Remote Size",
          max: { widthIn: 2.5, heightIn: 1.5 },
          min: { widthIn: 1.5, heightIn: 1 },
        },
      ],
      presets: [
        {
          schemaVersion: 1,
          id: "preset-remote",
          name: "Remote Preset",
          globalDefaults: {
            boundingSizePresetId: "size-remote",
            backingMm: 2.8,
          },
          lineDefaults: {
            fontId: "skywalk",
          },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
          listingAssignments: [],
        },
      ],
    };
    const localStorageMock = {
      getItem: vi.fn(() => {
        throw new Error("localStorage should not be read");
      }),
      setItem: vi.fn(() => {
        throw new Error("localStorage should not be written");
      }),
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("/api/preset-snapshot")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ snapshot: remoteSnapshot }),
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }));

    await loadPresetRegistry();

    expect(getPresetOptions()).toEqual([{ id: "preset-remote", label: "Remote Preset" }]);
    expect(getBoundingSizePresetDefinitionsForEditor()).toContainEqual(remoteSnapshot.sizePresets[0]);
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("can save a preset definition locally and expose the full snapshot for remote sync", () => {
    const localStorageMock = {
      setItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock);

    const result = savePresetDefinitionLocally({
      previousId: "preset-a1f4c8e2b601",
      preset: {
        schemaVersion: 1,
        id: "preset-a1f4c8e2b601",
        name: "All Candlepin Updated",
        globalDefaults: {
          backingMm: 3.4,
          weldExportedDesign: false,
        },
        lineDefaults: {
          fontId: "candlepin",
        },
        lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
        listingAssignments: [],
      },
    });

    expect(result.snapshot).toEqual(getPresetSnapshot());
    expect(getPresetDefinitionForEditor("preset-a1f4c8e2b601")?.name).toBe("All Candlepin Updated");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("removes a listing id from other presets when saving it onto a new preset", () => {
    const result = savePresetDefinitionLocally({
      previousId: "preset-b7d2e9f4c318",
      preset: {
        schemaVersion: 1,
        id: "preset-b7d2e9f4c318",
        name: "Candlepin, Skywalk",
        globalDefaults: {
          backingMm: 3.1,
          weldExportedDesign: true,
        },
        lineDefaults: {
          fontId: "candlepin",
        },
        lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
        listingAssignments: [
          { listingId: "4439916732", name: "Original Listing", lineOverrides: [] },
          { listingId: "1884223710", name: "Moved Listing", lineOverrides: [] },
        ],
      },
    });

    expect(getPresetDefinitionForEditor("preset-b7d2e9f4c318")?.listingAssignments.map((assignment) => assignment.listingId)).toEqual([
      "4439916732",
      "1884223710",
    ]);
    expect(getPresetDefinitionForEditor("preset-c3e8a1d7f520")?.listingAssignments.map((assignment) => assignment.listingId)).not.toContain("1884223710");
    expect(getPresetIdForListingId("1884223710")).toBe("preset-b7d2e9f4c318");
    expect(result.snapshot).toEqual(getPresetSnapshot());
  });

  it("can save custom size guides into the preset snapshot", () => {
    const localStorageMock = {
      setItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock);

    const result = saveBoundingSizePresetDefinitionLocally({
      preset: {
        id: "size-custom",
        label: "Custom Test",
        max: { widthIn: 3, heightIn: 2 },
        min: { widthIn: 2, heightIn: 1.25 },
      },
    });

    expect(result.preset).toEqual({
      id: "size-custom",
      label: "Custom Test",
      max: { widthIn: 3, heightIn: 2 },
      min: { widthIn: 2, heightIn: 1.25 },
    });
    expect(getBoundingSizePresetDefinitionsForEditor()).toContainEqual(result.preset);
    expect(getPresetSnapshot().sizePresets).toContainEqual(result.preset);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("can delete custom size guides but not the bundled default", () => {
    saveBoundingSizePresetDefinitionLocally({
      preset: {
        id: "size-delete-me",
        label: "Delete Me",
        max: { widthIn: 2.5, heightIn: 1.8 },
        min: { widthIn: 1.5, heightIn: 1 },
      },
    });

    expect(deleteBoundingSizePresetDefinitionLocally("size-delete-me").deletedPresetId).toBe("size-delete-me");
    expect(getBoundingSizePresetDefinitionsForEditor().map((preset) => preset.id)).not.toContain("size-delete-me");
    expect(() => deleteBoundingSizePresetDefinitionLocally("size-2-2x1-5")).toThrow("The default size guide cannot be deleted.");
  });

  it("blocks deleting a custom size guide while a preset still references it", () => {
    saveBoundingSizePresetDefinitionLocally({
      preset: {
        id: "size-in-use",
        label: "In Use",
        max: { widthIn: 2.5, heightIn: 1.8 },
        min: { widthIn: 1.5, heightIn: 1 },
      },
    });
    savePresetDefinitionLocally({
      preset: {
        schemaVersion: 1,
        id: "preset-size-in-use",
        name: "Preset With Size Guide",
        globalDefaults: {
          boundingSizePresetId: "size-in-use",
          backingMm: 3.1,
          weldExportedDesign: true,
        },
        lineDefaults: {
          fontId: "candlepin",
        },
        lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
        listingAssignments: [],
      },
    });

    expect(() => deleteBoundingSizePresetDefinitionLocally("size-in-use"))
      .toThrow("Size guide is used by 1 preset and cannot be deleted.");
  });

  it("can delete a preset definition locally and promote a surviving preset as the default when needed", () => {
    const localStorageMock = {
      setItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock);

    const result = deletePresetDefinitionLocally("preset-a1f4c8e2b601");

    expect(result.deletedPresetId).toBe("preset-a1f4c8e2b601");
    expect(getPresetDefinitionForEditor("preset-a1f4c8e2b601")).toBeNull();
    expect(getDefaultPresetId()).toBe("preset-b7d2e9f4c318");
    expect(getPresetOptions().map((preset) => preset.id)).not.toContain("preset-a1f4c8e2b601");
    expect(result.snapshot).toEqual(getPresetSnapshot());
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("rejects deleting the final remaining preset", () => {
    setPresetRegistryForTests(
      { defaultPresetId: "only-preset" },
      [
        {
          schemaVersion: 1,
          id: "only-preset",
          name: "Only Preset",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      ],
    );

    expect(() => deletePresetDefinitionLocally("only-preset")).toThrow("At least one preset must remain available.");
  });
});
