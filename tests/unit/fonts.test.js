import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILTIN_FONT_DEFINITIONS,
  buildFontOptions,
  normalizeFontRecord,
  registerBrowserFont,
  resolveFontOption,
} from "../../src/fonts.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("lets workspace records override built-in font fallback definitions", () => {
    const options = buildFontOptions([
      {
        id: "candlepin",
        display_name: "Candlepin Shop Version",
        family_name: "WorkspaceFont_Candlepin_Shop_Version",
        public_url: "https://example.test/workspace-fonts/candlepin/v2/Candlepin-Shop.otf",
        file_format: "otf",
        version: 2,
        is_builtin: true,
      },
    ]);

    expect(options.map((font) => font.id).slice(0, 3)).toEqual(["candlepin", "skywalk", "somekind"]);
    expect(options[0]).toMatchObject({
      id: "candlepin",
      label: "Candlepin Shop Version",
      family: "WorkspaceFont_Candlepin_Shop_Version",
      url: "https://example.test/workspace-fonts/candlepin/v2/Candlepin-Shop.otf",
      exportPath: "https://example.test/workspace-fonts/candlepin/v2/Candlepin-Shop.otf",
      version: 2,
      isBuiltin: true,
      isUploaded: false,
      bridgingEnabled: true,
    });
  });

  it("normalizes the per-font bridging setting from workspace records", () => {
    const option = normalizeFontRecord({
      id: "font-1",
      display_name: "Connected Script",
      family_name: "ConnectedScript",
      public_url: "https://example.test/connected.otf",
      file_format: "otf",
      version: 1,
      bridging_enabled: false,
    });

    expect(option).toMatchObject({
      id: "font-1",
      bridgingEnabled: false,
    });
  });

  it("keeps bundled built-in fonts active when a workspace built-in row was deleted", () => {
    const options = buildFontOptions([
      {
        id: "candlepin",
        display_name: "Candlepin Shop Version",
        family_name: "WorkspaceFont_Candlepin_Shop_Version",
        public_url: "https://example.test/workspace-fonts/candlepin/v2/Candlepin-Shop.otf",
        file_format: "otf",
        version: 2,
        is_builtin: true,
        deleted_at: "2026-06-14T00:00:00.000Z",
      },
    ], { includeDeleted: true });

    expect(options[0]).toMatchObject({
      id: "candlepin",
      label: "Candlepin Laser",
      family: "CandlepinLaser",
      url: "public/fonts/Candlepin-Laser.otf",
      isBuiltin: true,
    });
    expect(options[0].isDeleted).not.toBe(true);
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

  it("returns only active fonts as selectable choices unless the current font is deleted", async () => {
    const { getSelectableFontOptions } = await import("../../src/fonts.js");
    const options = buildFontOptions([
      {
        id: "font-active",
        display_name: "Active Font",
        family_name: "ActiveFont",
        public_url: "https://example.test/active.otf",
        file_format: "otf",
      },
      {
        id: "font-deleted",
        display_name: "Deleted Font",
        family_name: "DeletedFont",
        public_url: "https://example.test/deleted.otf",
        file_format: "otf",
        deleted_at: "2026-06-14T00:00:00.000Z",
      },
    ], { includeDeleted: true });

    expect(getSelectableFontOptions(options).map((font) => font.id)).not.toContain("font-deleted");
    expect(getSelectableFontOptions(options, "font-deleted").at(-1)).toMatchObject({
      id: "font-deleted",
      label: "Deleted Font (deleted)",
      isDeleted: true,
    });
  });

  it("keeps a missing selected font id available so saved designs do not silently fall back", async () => {
    const { getSelectableFontOptions } = await import("../../src/fonts.js");

    const options = getSelectableFontOptions(BUILTIN_FONT_DEFINITIONS, "quincy");

    expect(options.at(-1)).toMatchObject({
      id: "quincy",
      label: "Missing font (quincy)",
      isMissing: true,
    });
  });

  it("registers uploaded fonts with a stylesheet when the FontFace constructor is unavailable", async () => {
    const appended = [];

    vi.stubGlobal("FontFace", undefined);
    vi.stubGlobal("document", {
      createElement(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          dataset: {},
          remove: vi.fn(),
          textContent: "",
        };
      },
      head: {
        appendChild(element) {
          appended.push(element);
        },
      },
    });

    const style = await registerBrowserFont({
      family: "WorkspaceFont_Quincy_Laser",
      url: "http://127.0.0.1:57320/storage/v1/object/public/workspace-fonts/quincy.otf",
    });

    expect(style).toBe(appended[0]);
    expect(style.textContent).toContain('@font-face');
    expect(style.textContent).toContain('font-family: "WorkspaceFont_Quincy_Laser"');
    expect(style.textContent).toContain('quincy.otf');
  });
  it("falls back to a stylesheet when FontFace loading fails", async () => {
    const appended = [];
    const deletedFaces = [];

    class FailingFontFaceStub {
      constructor(family, source) {
        this.family = family;
        this.source = source;
      }

      async load() {
        throw new Error("Font load failed");
      }
    }

    vi.stubGlobal("FontFace", FailingFontFaceStub);
    vi.stubGlobal("document", {
      createElement(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          dataset: {},
          remove: vi.fn(),
          textContent: "",
        };
      },
      fonts: {
        delete(face) {
          deletedFaces.push(face);
          return true;
        },
      },
      head: {
        appendChild(element) {
          appended.push(element);
        },
      },
    });

    const style = await registerBrowserFont({
      family: "WorkspaceFont_Quincy_Laser",
      url: "http://127.0.0.1:57320/storage/v1/object/public/workspace-fonts/quincy.otf",
    });

    expect(style).toBe(appended[0]);
    expect(style.textContent).toContain('font-family: "WorkspaceFont_Quincy_Laser"');
  });
  it("replaces a previously registered browser font face for the same family", async () => {
    const addedFaces = [];
    const deletedFaces = [];

    class FontFaceStub {
      constructor(family, source) {
        this.family = family;
        this.source = source;
      }

      async load() {
        return this;
      }
    }

    vi.stubGlobal("FontFace", FontFaceStub);
    vi.stubGlobal("document", {
      fonts: {
        add(face) {
          addedFaces.push(face);
        },
        delete(face) {
          deletedFaces.push(face);
          return true;
        },
      },
    });

    await registerBrowserFont({
      family: "WorkspaceFont_Sophia_Font_Regular",
      url: "https://example.test/sophia/v1/SophiaFont-Regular.otf",
    });
    await registerBrowserFont({
      family: "WorkspaceFont_Sophia_Font_Regular",
      url: "https://example.test/sophia/v2/SophiaFont-Regular.otf",
    });

    expect(addedFaces).toHaveLength(2);
    expect(deletedFaces).toEqual([addedFaces[0]]);
    expect(addedFaces[1].source).toBe('url("https://example.test/sophia/v2/SophiaFont-Regular.otf")');
  });
});
