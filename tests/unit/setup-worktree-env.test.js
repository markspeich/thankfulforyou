import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { setupWorktreeEnv } from "../../tools/setup_worktree_env.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "tfy-worktree-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("worktree env setup", () => {
  it("creates .env.local from the machine-local seed file", async () => {
    const dir = await makeTempDir();
    const seedPath = join(dir, ".env.local.shared");
    await writeFile(seedPath, [
      "SUPABASE_URL=https://example.supabase.co",
      "SUPABASE_PUBLISHABLE_KEY=publishable-key",
      "SUPABASE_SERVICE_ROLE_KEY=service-role-key",
    ].join("\n"));

    const result = await setupWorktreeEnv({ cwd: dir, seedPath });

    expect(result).toMatchObject({
      copiedKeys: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      missingKeys: [],
      valid: true,
    });
    await expect(readFile(join(dir, ".env.local"), "utf8")).resolves.toContain("SUPABASE_SERVICE_ROLE_KEY=service-role-key");
  });

  it("fills empty required values from the seed without overwriting populated local values", async () => {
    const dir = await makeTempDir();
    const seedPath = join(dir, ".env.local.shared");
    await writeFile(join(dir, ".env.local"), [
      "SUPABASE_URL=https://local.supabase.co",
      "SUPABASE_PUBLISHABLE_KEY=\"\"",
      "SUPABASE_SERVICE_ROLE_KEY=\"\"",
    ].join("\n"));
    await writeFile(seedPath, [
      "SUPABASE_URL=https://seed.supabase.co",
      "SUPABASE_PUBLISHABLE_KEY=seed-publishable-key",
      "SUPABASE_SERVICE_ROLE_KEY=seed-service-role-key",
    ].join("\n"));

    const result = await setupWorktreeEnv({ cwd: dir, seedPath });
    const envFile = await readFile(join(dir, ".env.local"), "utf8");

    expect(result.copiedKeys).toEqual(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(result.missingKeys).toEqual([]);
    expect(envFile).toContain("SUPABASE_URL=https://local.supabase.co");
    expect(envFile).toContain("SUPABASE_PUBLISHABLE_KEY=seed-publishable-key");
    expect(envFile).toContain("SUPABASE_SERVICE_ROLE_KEY=seed-service-role-key");
  });

  it("reports missing required values when local env and seed are incomplete", async () => {
    const dir = await makeTempDir();

    const result = await setupWorktreeEnv({ cwd: dir, seedPath: join(dir, "missing.env") });

    expect(result).toMatchObject({
      copiedKeys: [],
      missingKeys: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      valid: false,
    });
  });
});
