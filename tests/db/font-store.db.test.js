import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  archiveWorkspaceFont,
  listWorkspaceFonts,
  replaceWorkspaceFont,
  restoreWorkspaceFont,
  updateWorkspaceFontSettings,
} from "../../api/_lib/font-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { loadEnvFile } from "../../tools/env_file.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  loadEnvFile();

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const allowRemote = process.env.TFY_ALLOW_REMOTE_DB_TESTS === "1";
  if (!allowRemote && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(supabaseUrl)) {
    throw new Error(`Refusing to run DB tests against non-local SUPABASE_URL: ${supabaseUrl || "<missing>"}.`);
  }
});

describe("font lifecycle database integration", () => {
  it("keeps a font family stable when its display name changes", async () => {
    const supabase = createSupabaseAdminClient();
    const { data: original, error: originalError } = await supabase
      .from("fonts")
      .select("display_name, family_name")
      .eq("id", "somekind")
      .single();
    expect(originalError).toBeNull();

    try {
      const renamed = await updateWorkspaceFontSettings({
        workspaceId: PRIMARY_WORKSPACE_ID,
        fontId: "somekind",
        displayName: "Somekind Renamed",
        bridgingEnabled: true,
      });
      expect(renamed.family_name).toBe(original.family_name);
    } finally {
      await updateWorkspaceFontSettings({
        workspaceId: PRIMARY_WORKSPACE_ID,
        fontId: "somekind",
        displayName: original?.display_name || "Somekind",
        bridgingEnabled: true,
      });
    }
  });

  it("enforces a distinct browser family for every workspace font", async () => {
    const suffix = randomUUID().slice(0, 8);
    const commonFamily = `WorkspaceFont_collision_${suffix}`;
    const supabase = createSupabaseAdminClient();
    const baseRow = {
      workspace_id: PRIMARY_WORKSPACE_ID,
      family_name: commonFamily,
      storage_bucket: "workspace-fonts",
      storage_path: `public/fonts/collision-${suffix}.otf`,
      public_url: `public/fonts/collision-${suffix}.otf`,
      file_name: `collision-${suffix}.otf`,
      file_format: "otf",
      version: 1,
      is_builtin: false,
    };
    const firstId = `font-collision-${suffix}-one`;
    const secondId = `font-collision-${suffix}-two`;

    const { error: firstError } = await supabase.from("fonts").insert({
      ...baseRow,
      id: firstId,
      display_name: `Collision One ${suffix}`,
    });
    expect(firstError).toBeNull();

    try {
      const { error: secondError } = await supabase.from("fonts").insert({
        ...baseRow,
        id: secondId,
        display_name: `Collision Two ${suffix}`,
      });
      expect(secondError).toMatchObject({ code: "23505" });
    } finally {
      await supabase.from("fonts").delete().eq("id", firstId);
    }
  });

  it("seeds ordinary stable font rows and dual-writes archive and restore state", async () => {
    const supabase = createSupabaseAdminClient();
    const { data: seededRows, error: seedError } = await supabase
      .from("fonts")
      .select("id, family_name, is_builtin, archived_at, deleted_at")
      .in("id", ["candlepin", "skywalk", "somekind"])
      .order("id");

    expect(seedError).toBeNull();
    expect(seededRows).toEqual([
      { id: "candlepin", family_name: "WorkspaceFont_63616e646c6570696e", is_builtin: false, archived_at: null, deleted_at: null },
      { id: "skywalk", family_name: "WorkspaceFont_736b7977616c6b", is_builtin: false, archived_at: null, deleted_at: null },
      { id: "somekind", family_name: "WorkspaceFont_736f6d656b696e64", is_builtin: false, archived_at: null, deleted_at: null },
    ]);

    await archiveWorkspaceFont({ workspaceId: PRIMARY_WORKSPACE_ID, fontId: "candlepin" });
    const { data: archivedRow, error: archivedError } = await supabase
      .from("fonts")
      .select("archived_at, deleted_at")
      .eq("id", "candlepin")
      .single();
    expect(archivedError).toBeNull();
    expect(archivedRow.archived_at).toBeTruthy();
    expect(archivedRow.deleted_at).toBe(archivedRow.archived_at);
    expect((await listWorkspaceFonts({ workspaceId: PRIMARY_WORKSPACE_ID })).map((font) => font.id))
      .not.toContain("candlepin");
    expect((await listWorkspaceFonts({ workspaceId: PRIMARY_WORKSPACE_ID, includeArchived: true })).map((font) => font.id))
      .toContain("candlepin");

    await restoreWorkspaceFont({ workspaceId: PRIMARY_WORKSPACE_ID, fontId: "candlepin" });
    const { data: restoredRow, error: restoredError } = await supabase
      .from("fonts")
      .select("archived_at, deleted_at")
      .eq("id", "candlepin")
      .single();
    expect(restoredError).toBeNull();
    expect(restoredRow).toEqual({ archived_at: null, deleted_at: null });
  });

  it("keeps an archived font archived when loading a new version", async () => {
    const suffix = randomUUID().slice(0, 8);
    const fontId = `font-lifecycle-${suffix}`;
    const archivedAt = "2026-08-05T20:00:00.000Z";
    const supabase = createSupabaseAdminClient();
    const { error: insertError } = await supabase.from("fonts").insert({
      id: fontId,
      workspace_id: PRIMARY_WORKSPACE_ID,
      display_name: `Lifecycle ${suffix}`,
      family_name: `Lifecycle_${suffix}`,
      storage_bucket: "workspace-fonts",
      storage_path: `public/fonts/lifecycle-${suffix}.otf`,
      public_url: `public/fonts/lifecycle-${suffix}.otf`,
      file_name: `lifecycle-${suffix}.otf`,
      file_format: "otf",
      version: 1,
      is_builtin: false,
      archived_at: archivedAt,
      deleted_at: archivedAt,
    });
    expect(insertError).toBeNull();

    try {
      const buffer = await readFile(new URL("../../public/fonts/Candlepin-Laser.otf", import.meta.url));
      const replaced = await replaceWorkspaceFont({
        workspaceId: PRIMARY_WORKSPACE_ID,
        fontId,
        file: {
          name: "Lifecycle Replacement.otf",
          type: "font/otf",
          size: buffer.length,
          buffer,
        },
      });

      expect(replaced).toMatchObject({
        id: fontId,
        version: 2,
      });
      expect(new Date(replaced.archived_at).getTime()).toBe(new Date(archivedAt).getTime());
      const { data: replacedRow, error: replacedError } = await supabase
        .from("fonts")
        .select("version, storage_path, archived_at, deleted_at")
        .eq("id", fontId)
        .single();
      expect(replacedError).toBeNull();
      expect(replacedRow.version).toBe(2);
      expect(new Date(replacedRow.archived_at).getTime()).toBe(new Date(archivedAt).getTime());
      expect(new Date(replacedRow.deleted_at).getTime()).toBe(new Date(archivedAt).getTime());
      expect(replacedRow.storage_path).toContain(`/fonts/${fontId}/v2/`);
    } finally {
      await supabase.from("fonts").delete().eq("id", fontId);
    }
  });
});
