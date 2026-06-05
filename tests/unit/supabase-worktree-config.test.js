import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGeneratedSupabaseConfig,
  computeSupabaseWorktreePorts,
  extractWorktreeKey,
  generateSupabaseWorktreeConfig,
  resolveSupabaseWorktreeId,
  resolveSupabaseWorktreePaths,
} from "../../tools/supabase_worktree_config.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "tfy-supabase-worktree-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("per-worktree Supabase config", () => {
  it("extracts and sanitizes a Codex worktree key", () => {
    expect(extractWorktreeKey("C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou")).toBe("42f4");
    expect(extractWorktreeKey("C:\\Users\\Mark\\.codex\\worktrees\\Feature ABC\\app")).toBe("feature-abc");
    expect(extractWorktreeKey("C:/Users/Mark/CodexProjects/thankfulforyou")).toBeNull();
  });

  it("derives stable worktree ids and service ports", () => {
    const id = resolveSupabaseWorktreeId("C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou");
    const first = computeSupabaseWorktreePorts(id);
    const second = computeSupabaseWorktreePorts(id);

    expect(id).toBe("42f4");
    expect(first).toEqual(second);
    expect(new Set(Object.values(first)).size).toBe(Object.values(first).length);
    expect(first.api).toBeGreaterThanOrEqual(55000);
    expect(first.edgeInspector).toBeLessThan(61000);
  });

  it("rewrites the canonical config with per-worktree ports and app redirects", () => {
    const generated = buildGeneratedSupabaseConfig([
      'project_id = "thankfulforyou"',
      "",
      "[api]",
      "port = 54321",
      "",
      "[db]",
      "port = 54322",
      "shadow_port = 54320",
      "",
      "[db.pooler]",
      "port = 54329",
      "",
      "[studio]",
      "port = 54323",
      'api_url = "http://127.0.0.1"',
      "",
      "[inbucket]",
      "port = 54324",
      "",
      "[auth]",
      'site_url = "http://127.0.0.1:3000"',
      'additional_redirect_urls = ["https://127.0.0.1:3000"]',
      "",
      "[edge_runtime]",
      "inspector_port = 8083",
      "",
      "[analytics]",
      "port = 54327",
    ].join("\n"), {
      projectId: "thankfulforyou-42f4",
      appBaseUrl: "http://127.0.0.1:4701",
      ports: {
        api: 55000,
        db: 55001,
        dbShadow: 55002,
        studio: 55003,
        inbucket: 55004,
        dbPooler: 55005,
        analytics: 55006,
        edgeInspector: 55007,
      },
    });

    expect(generated).toContain('project_id = "thankfulforyou-42f4"');
    expect(generated).toContain("port = 55000");
    expect(generated).toContain("shadow_port = 55002");
    expect(generated).toContain('api_url = "http://127.0.0.1:55000"');
    expect(generated).toContain('site_url = "http://127.0.0.1:4701"');
    expect(generated).toContain('additional_redirect_urls = ["http://127.0.0.1:4701"]');
    expect(generated).toContain("inspector_port = 55007");
  });

  it("generates a disposable Supabase workdir from canonical migrations and seed", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "supabase", "migrations"), { recursive: true });
    await writeFile(join(dir, "supabase", "config.toml"), [
      'project_id = "thankfulforyou"',
      "[api]",
      "port = 54321",
      "[db]",
      "port = 54322",
      "shadow_port = 54320",
      "[auth]",
      'site_url = "http://127.0.0.1:3000"',
      'additional_redirect_urls = ["https://127.0.0.1:3000"]',
    ].join("\n"));
    await writeFile(join(dir, "supabase", "seed.sql"), "select 1;");
    await writeFile(join(dir, "supabase", "migrations", "20260601000000_test.sql"), "select 2;");
    const paths = resolveSupabaseWorktreePaths({ cwd: dir });
    await mkdir(paths.migrationsPath, { recursive: true });
    await writeFile(join(paths.migrationsPath, "stale.sql"), "select 'stale';");

    const generated = await generateSupabaseWorktreeConfig({ cwd: dir });

    expect(generated.workdir).toBe(paths.workdir);
    await expect(readFile(paths.seedPath, "utf8")).resolves.toBe("select 1;");
    await expect(readFile(join(paths.migrationsPath, "20260601000000_test.sql"), "utf8")).resolves.toBe("select 2;");
    await expect(readFile(join(paths.migrationsPath, "stale.sql"), "utf8")).rejects.toThrow();
    await expect(readFile(paths.configPath, "utf8")).resolves.toContain('project_id = "thankfulforyou-');
  });
});
