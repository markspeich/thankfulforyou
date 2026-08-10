import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  findMissingMigrationVersions,
  isMainModule,
  parseMigrationListOutput,
  parseRemoteMigrationVersions,
  readLocalMigrationVersions,
  summarizeMigrationListDrift,
} from "../../tools/check_migration_drift.mjs";

describe("migration drift check", () => {
  it("reads checked-in migration versions from migration file names", async () => {
    const root = await mkdtemp(join(tmpdir(), "tfy-migrations-"));
    const migrationsDir = join(root, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(migrationsDir, "20260601120000_workspace_fonts.sql"), "select 1;");
    await writeFile(join(migrationsDir, "20260615202827_font_bridging_enabled.sql"), "select 2;");
    await writeFile(join(migrationsDir, "README.md"), "ignored");

    await expect(readLocalMigrationVersions(root)).resolves.toEqual([
      "20260601120000",
      "20260615202827",
    ]);
  });

  it("parses Supabase db query JSON migration rows", () => {
    const stdout = JSON.stringify({
      rows: [
        { version: "20260601120000" },
        { version: "20260619165154", name: "font_bridging_enabled" },
      ],
    });

    expect(parseRemoteMigrationVersions(stdout)).toEqual([
      "20260601120000",
      "20260619165154",
    ]);
  });

  it("parses Supabase migration list drift rows", () => {
    const stdout = `
      Local          | Remote         | Time (UTC)
    ----------------|----------------|---------------------
      20260601120000 | 20260601120000 | 2026-06-01 12:00:00
      20260615202827 |                | 2026-06-15 20:28:27
                     | 20260619165154 | 2026-06-19 16:51:54
    `;

    const rows = parseMigrationListOutput(stdout);

    expect(rows).toEqual([
      { local: "20260601120000", remote: "20260601120000" },
      { local: "20260615202827", remote: null },
      { local: null, remote: "20260619165154" },
    ]);
    expect(summarizeMigrationListDrift(rows)).toEqual({
      localOnlyVersions: ["20260615202827"],
      remoteOnlyVersions: ["20260619165154"],
    });
  });

  it("parses Supabase migration list JSON output", () => {
    const stdout = JSON.stringify({
      migrations: [
        { local: "20260601120000", remote: "20260601120000" },
        { local: "20260615202827", remote: "" },
        { local: "", remote: "20260619165154" },
      ],
    });

    expect(parseMigrationListOutput(stdout)).toEqual([
      { local: "20260601120000", remote: "20260601120000" },
      { local: "20260615202827", remote: null },
      { local: null, remote: "20260619165154" },
    ]);
  });

  it("reports local migration versions missing from production", () => {
    expect(findMissingMigrationVersions({
      localVersions: ["20260601120000", "20260615202827"],
      remoteVersions: ["20260601120000"],
    })).toEqual(["20260615202827"]);
  });

  it("detects when the drift checker is run as the main script on Windows paths", () => {
    expect(isMainModule("file:///C:/repo/tools/check_migration_drift.mjs", "C:\\repo\\tools\\check_migration_drift.mjs"))
      .toBe(true);
  });
});
