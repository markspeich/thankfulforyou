import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFontOptions,
  getFontLibraryOptions,
  getFontRenderingIssue,
  getSelectableFontOptions,
  normalizeFontRecord,
  registerBrowserFont,
  registerBrowserFonts,
} from "../../src/fonts.js";

afterEach(() => vi.unstubAllGlobals());

describe("font registry", () => {
  const active = { id: "candlepin", display_name: "Candlepin", family_name: "CandlepinReplacement", public_url: "https://example.test/candlepin/v2.otf", file_format: "otf", version: 2 };
  const archived = { id: "somekind", display_name: "Somekind", family_name: "Somekind", public_url: "https://example.test/somekind/v1.ttf", archived_at: "2026-08-05T00:00:00Z" };

  it("normalizes seeded and uploaded records without origin-specific runtime state", () => {
    expect(normalizeFontRecord({ ...active, is_builtin: true })).toEqual(normalizeFontRecord(active));
  });

  it("rejects blank-only font ids before deriving a browser family", () => {
    expect(normalizeFontRecord({
      id: "   ",
      display_name: "Blank Id Font",
      public_url: "https://example.test/blank-id.otf",
    })).toBeNull();
  });

  it("derives browser font families from immutable font ids", () => {
    expect(buildFontOptions([active])[0]).toMatchObject({ id: "candlepin", family: "WorkspaceFont_63616e646c6570696e", url: "https://example.test/candlepin/v2.otf", version: 2 });
  });

  it("keeps active and archived fonts with a legacy family collision distinct in the browser registry", async () => {
    const records = [
      { id: "active-candlepin", display_name: "Candlepin", family_name: "CrushedLemonade", public_url: "https://example.test/candlepin.otf" },
      { id: "archived-crushed-lemonade", display_name: "Crushed Lemonade", family_name: "CrushedLemonade", public_url: "https://example.test/lemonade.otf", archived_at: "2026-08-05T00:00:00Z" },
    ];
    const fonts = buildFontOptions(records, { includeArchived: true });
    const added = [];
    class Face { constructor(family, source) { this.family = family; this.source = source; } async load() { return this; } }
    vi.stubGlobal("FontFace", Face);
    vi.stubGlobal("document", { fonts: { add: (face) => added.push(face), delete: vi.fn() } });

    await registerBrowserFonts(fonts);

    expect(fonts.map((font) => font.family)).toEqual([
      "WorkspaceFont_6163746976652d63616e646c6570696e",
      "WorkspaceFont_61726368697665642d637275736865642d6c656d6f6e616465",
    ]);
    expect(added.map((face) => face.family)).toEqual(fonts.map((font) => font.family));
  });

  it("excludes archived fonts from new assignments but retains the current archived reference", () => {
    const options = buildFontOptions([active, archived], { includeArchived: true });
    expect(getSelectableFontOptions(options).map((font) => font.id)).toEqual(["candlepin"]);
    expect(getSelectableFontOptions(options, "somekind").at(-1)).toMatchObject({ id: "somekind", label: "Somekind (archived)", isArchived: true });
  });

  it("preserves a missing reference as a non-selectable warning", () => {
    expect(getSelectableFontOptions(buildFontOptions([active]), "missing").at(-1)).toMatchObject({ id: "missing", isMissing: true });
  });

  it("shows archived records in the library only when requested", () => {
    const options = buildFontOptions([active, archived], { includeArchived: true });
    expect(getFontLibraryOptions(options).map((font) => font.id)).toEqual(["candlepin"]);
    expect(getFontLibraryOptions(options, { showArchived: true }).map((font) => font.id)).toEqual(["candlepin", "somekind"]);
  });

  it("registers a replaced seeded font and replaces its prior browser face", async () => {
    const added = []; const deleted = [];
    class Face { constructor(family, source) { this.family = family; this.source = source; } async load() { return this; } }
    vi.stubGlobal("FontFace", Face);
    vi.stubGlobal("document", { fonts: { add: (face) => added.push(face), delete: (face) => deleted.push(face) } });
    await registerBrowserFont({ family: "CandlepinReplacement", url: "https://example.test/candlepin/v1.otf" });
    await registerBrowserFont({ family: "CandlepinReplacement", url: "https://example.test/candlepin/v2.otf" });
    expect(added).toHaveLength(2); expect(deleted).toEqual([added[0]]); expect(added[1].source).toContain("v2.otf");
  });

  it("replaces the browser face by stable font id when a replacement changes family", async () => {
    const added = [];
    const deleted = [];
    class Face {
      constructor(family, source) {
        this.family = family;
        this.source = source;
      }

      async load() {
        return this;
      }
    }
    vi.stubGlobal("FontFace", Face);
    vi.stubGlobal("document", {
      fonts: {
        add: (face) => added.push(face),
        delete: (face) => deleted.push(face),
      },
    });

    await registerBrowserFont({
      id: "candlepin",
      family: "CandlepinLaser",
      url: "https://example.test/candlepin/v1.otf",
    });
    await registerBrowserFont({
      id: "candlepin",
      family: "WorkspaceFont_Candlepin_Shop_Version",
      url: "https://example.test/candlepin/v2.otf",
    });

    expect(deleted).toEqual([added[0]]);
    expect(added[1]).toMatchObject({
      family: "WorkspaceFont_Candlepin_Shop_Version",
      source: 'url("https://example.test/candlepin/v2.otf")',
    });
  });

  it("exposes a font load failure rather than silently registering a fallback", async () => {
    class FailingFace { async load() { throw new Error("asset unavailable"); } }
    vi.stubGlobal("FontFace", FailingFace); vi.stubGlobal("document", { fonts: { add: vi.fn(), delete: vi.fn() } });
    await expect(registerBrowserFont({ family: "Broken", url: "https://example.test/broken.otf" })).rejects.toThrow("asset unavailable");
  });

  it("keeps an unresolvable registry row visible and reports its registration failure", async () => {
    const [font] = buildFontOptions([{
      id: "missing-asset",
      display_name: "Missing Asset",
      family_name: "MissingAsset",
      public_url: null,
      storage_path: null,
    }]);

    expect(font).toMatchObject({ id: "missing-asset", url: "", exportPath: "" });
    const [result] = await registerBrowserFonts([font]);
    expect(result.status).toBe("rejected");
    expect(result.reason).toEqual(expect.objectContaining({
      message: expect.stringContaining("no resolvable asset"),
    }));
  });

  it("blocks rendering when a selected font is missing, unresolvable, or failed to load", () => {
    const settings = {
      text: "Ada",
      lines: [{ kind: "text", fontId: "candlepin" }],
    };

    expect(getFontRenderingIssue(settings, [])).toMatchObject({
      fontId: "candlepin",
      reason: "missing",
    });
    expect(getFontRenderingIssue(settings, [{
      ...buildFontOptions([active])[0],
      loadError: "Candlepin failed to load. asset unavailable",
    }])).toMatchObject({
      fontId: "candlepin",
      reason: "load-failed",
    });
    expect(getFontRenderingIssue(settings, buildFontOptions([{
      ...active,
      public_url: null,
    }]))).toMatchObject({
      fontId: "candlepin",
      reason: "unresolvable",
    });
  });

  it("allows archived fonts with registered browser and export assets", () => {
    expect(getFontRenderingIssue({
      text: "RN",
      lines: [{ kind: "text", fontId: "somekind" }],
    }, buildFontOptions([archived], { includeArchived: true }))).toBeNull();
  });
});
