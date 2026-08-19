import { describe, expect, it } from "vitest";

import {
  buildFontStoragePath,
  createFontStoreError,
  ensureFontStorageBucket,
  normalizeUploadedFontFile,
  normalizeFontRow,
  rejectMissingFontReplacement,
  resolveUploadedFontDisplayName,
} from "../../api/_lib/font-store.js";
import { buildWorkspaceFontFamily } from "../../src/font-identity.js";

describe("font store helpers", () => {
  it("derives a stable browser family from the font id instead of its display name", () => {
    expect(buildWorkspaceFontFamily("font-e761a52b-7536-4f5c-83b3-ade08f11f4c8"))
      .toBe("WorkspaceFont_666f6e742d65373631613532622d373533362d346635632d383362332d616465303866313166346338");
  });

  it("keeps case and punctuation-distinct ids in distinct browser families", () => {
    expect(buildWorkspaceFontFamily("Font.A")).toBe("WorkspaceFont_466f6e742e41");
    expect(buildWorkspaceFontFamily("Font_A")).toBe("WorkspaceFont_466f6e745f41");
    expect(buildWorkspaceFontFamily("font.a")).toBe("WorkspaceFont_666f6e742e61");
    expect(buildWorkspaceFontFamily(" font.a ")).toBe("WorkspaceFont_20666f6e742e6120");
  });

  it("builds workspace and version scoped storage paths", () => {
    expect(buildFontStoragePath({
      workspaceId: "workspace-1",
      fontId: "font-1",
      version: 2,
      fileName: "Clinic Sans.otf",
    })).toBe("workspaces/workspace-1/fonts/font-1/v2/Clinic-Sans.otf");
  });

  it("normalizes supported uploaded font files", () => {
    expect(normalizeUploadedFontFile({
      name: "Clinic Sans.otf",
      type: "font/otf",
      size: 123,
    })).toEqual({
      fileName: "Clinic Sans.otf",
      fileFormat: "otf",
      contentType: "font/otf",
      size: 123,
    });
  });

  it("rejects unsupported uploaded font file types", () => {
    expect(() => normalizeUploadedFontFile({
      name: "font.zip",
      type: "application/zip",
      size: 123,
    })).toThrow("Unsupported font file type. Upload an OTF, TTF, WOFF, or WOFF2 file.");
  });

  it("uses the font file name table before a browser-provided display name", async () => {
    const fontBuffer = await import("node:fs/promises")
      .then((fs) => fs.readFile(new URL("../../public/fonts/Candlepin-Laser.otf", import.meta.url)));

    expect(resolveUploadedFontDisplayName({
      file: {
        name: "Actually Different.otf",
        buffer: fontBuffer,
      },
      fallbackDisplayName: "Candlepin Laser",
    })).toBe("Candlepin - Laser");
  });

  it("allows replacement for a seeded font record without origin-based policy", () => {
    expect(() => rejectMissingFontReplacement({ id: "candlepin" }))
      .not.toThrow();
  });

  it("rejects replacing a font that has no workspace row", () => {
    expect(() => rejectMissingFontReplacement(null))
      .toThrow("Font not found.");
  });

  it("creates exposed http errors for api responses", () => {
    const error = createFontStoreError(400, "Nope.");
    expect(error).toMatchObject({
      message: "Nope.",
      statusCode: 400,
      expose: true,
    });
  });

  it("normalizes font rows with bridging enabled by default", () => {
    expect(normalizeFontRow({
      id: "font-1",
      workspace_id: "workspace-1",
      display_name: "Connected Script",
      bridging_enabled: false,
    })).toMatchObject({
      id: "font-1",
      bridging_enabled: false,
    });

    expect(normalizeFontRow({
      id: "font-2",
      workspace_id: "workspace-1",
      display_name: "Legacy Font",
    })).toMatchObject({
      id: "font-2",
      bridging_enabled: true,
    });
  });

  it("normalizes archived state without exposing obsolete origin metadata", () => {
    expect(normalizeFontRow({ id: "candlepin", archived_at: "2026-08-05T00:00:00Z", is_builtin: true }))
      .toMatchObject({ id: "candlepin", archived_at: "2026-08-05T00:00:00Z" });
  });

  it("creates the storage bucket when it is missing", async () => {
    const createBucketCalls = [];
    const supabase = {
      storage: {
        getBucket: async () => ({
          data: null,
          error: { message: "Bucket not found", statusCode: 404 },
        }),
        createBucket: async (bucketId, options) => {
          createBucketCalls.push({ bucketId, options });
          return { data: { id: bucketId }, error: null };
        },
      },
    };

    await ensureFontStorageBucket(supabase);

    expect(createBucketCalls).toEqual([
      {
        bucketId: "workspace-fonts",
        options: {
          public: true,
          fileSizeLimit: 5 * 1024 * 1024,
          allowedMimeTypes: [
            "font/otf",
            "font/ttf",
            "font/woff",
            "font/woff2",
            "application/font-sfnt",
            "application/octet-stream",
          ],
        },
      },
    ]);
  });
});
