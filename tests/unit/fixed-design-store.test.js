import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildFixedDesignStoragePath,
  normalizeFixedDesignStoreError,
  normalizeSvgUploadFile,
  validateSvgContent,
} from "../../api/_lib/fixed-design-store.js";

describe("fixed design store helpers", () => {
  it("builds versioned workspace storage paths", () => {
    expect(buildFixedDesignStoragePath({
      workspaceId: "workspace-1",
      fixedDesignId: "nurse-cross",
      version: 4,
      fileName: "Nurse Cross.svg",
    })).toBe("workspaces/workspace-1/fixed-designs/nurse-cross/v4/Nurse-Cross.svg");
  });

  it("accepts svg uploads", () => {
    expect(normalizeSvgUploadFile({
      name: "Nurse Cross.svg",
      type: "image/svg+xml",
      text: "<svg viewBox=\"0 0 40 20\"></svg>",
    })).toMatchObject({
      fileName: "Nurse Cross.svg",
      contentType: "image/svg+xml",
      metadata: {
        viewBox: "0 0 40 20",
        aspectRatio: 2,
      },
    });
  });

  it("rejects files without an svg root", () => {
    expect(() => validateSvgContent("<html></html>")).toThrow("Upload a valid SVG file.");
  });

  it("turns an active-name uniqueness violation into an actionable conflict", () => {
    const error = normalizeFixedDesignStoreError({
      code: "23505",
      message: "duplicate key value violates unique constraint \"fixed_designs_workspace_active_name_uidx\"",
    }, { displayName: "Rbt" });

    expect(error).toMatchObject({
      statusCode: 409,
      expose: true,
      message: 'A fixed design named "Rbt" already exists. Select it and use Load New Version to replace its SVG.',
    });
  });
});

describe("fixed design migration", () => {
  it("protects workspace-scoped fixed design references and active-name reuse", async () => {
    const migrationSql = await readFile(
      new URL("../../supabase/migrations/20260606153417_workspace_fixed_designs.sql", import.meta.url),
      "utf8",
    );

    expect(migrationSql).not.toMatch(/unique\s*\(\s*workspace_id\s*,\s*display_name\s*\)/i);
    expect(migrationSql).toMatch(
      /alter table public\.fixed_designs\s+drop constraint if exists fixed_designs_workspace_id_display_name_key/i,
    );
    expect(migrationSql).toMatch(/create unique index if not exists fixed_designs_workspace_active_name_uidx/i);
    expect(migrationSql).toMatch(/where deleted_at is null/i);
    expect(migrationSql).toMatch(/add column if not exists workspace_id uuid/i);
    expect(migrationSql).toMatch(/new\.workspace_id := parent_workspace_id/i);
    expect(migrationSql).toMatch(/create trigger design_lines_set_workspace_id/i);
    expect(migrationSql).toMatch(/foreign key \(fixed_design_id, workspace_id\)/i);
    expect(migrationSql).toMatch(/references public\.fixed_designs \(id, workspace_id\)/i);
    expect(migrationSql).not.toMatch(/security definer/i);
  });
});
