import { describe, expect, it } from "vitest";

import {
  buildFontStoragePath,
  createFontStoreError,
  ensureFontStorageBucket,
  normalizeUploadedFontFile,
  normalizeFontRow,
  rejectBuiltinFontDeletion,
  rejectMissingFontReplacement,
  resolveUploadedFontDisplayName,
} from "../../api/_lib/font-store.js";

describe("font store helpers", () => {
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

  it("allows built-in font replacement when a workspace row exists", () => {
    expect(() => rejectMissingFontReplacement({ id: "candlepin", is_builtin: true }))
      .not.toThrow();
  });

  it("rejects replacing a font that has no workspace row", () => {
    expect(() => rejectMissingFontReplacement(null))
      .toThrow("Font not found.");
  });

  it("keeps original production fonts protected from deletion", () => {
    expect(() => rejectBuiltinFontDeletion({ id: "candlepin", is_builtin: true }))
      .toThrow("Original production fonts cannot be deleted.");
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
