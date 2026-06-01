import { describe, expect, it } from "vitest";

import {
  BUILTIN_FONT_DEFINITIONS,
  buildFontOptions,
  normalizeFontRecord,
  resolveFontOption,
} from "../../src/fonts.js";

describe("font registry", () => {
  it("keeps built-in fonts first and appends uploaded workspace fonts", () => {
    const options = buildFontOptions([
      {
        id: "font-1",
        display_name: "Clinic Sans",
        family_name: "ClinicSans",
        public_url: "https://example.test/font.otf",
        file_format: "otf",
        version: 1,
      },
    ]);

    expect(options.map((font) => font.id).slice(0, 3)).toEqual(["candlepin", "skywalk", "somekind"]);
    expect(options.at(-1)).toMatchObject({
      id: "font-1",
      label: "Clinic Sans",
      family: "ClinicSans",
      url: "https://example.test/font.otf",
      exportPath: "https://example.test/font.otf",
      isUploaded: true,
    });
  });

  it("excludes deleted uploaded fonts from normal choices", () => {
    const options = buildFontOptions([
      {
        id: "font-1",
        display_name: "Deleted",
        family_name: "Deleted",
        public_url: "https://example.test/font.otf",
        file_format: "otf",
        version: 1,
        deleted_at: "2026-06-01T00:00:00.000Z",
      },
    ]);

    expect(options.some((font) => font.id === "font-1")).toBe(false);
  });

  it("can resolve a deleted font for an existing design", () => {
    const record = normalizeFontRecord({
      id: "font-1",
      display_name: "Old Font",
      family_name: "OldFont",
      public_url: "https://example.test/font.otf",
      file_format: "otf",
      version: 2,
      deleted_at: "2026-06-01T00:00:00.000Z",
    }, { includeDeleted: true });

    const option = resolveFontOption("font-1", [...BUILTIN_FONT_DEFINITIONS, record]);
    expect(option.label).toBe("Old Font (deleted)");
    expect(option.isDeleted).toBe(true);
  });
});
