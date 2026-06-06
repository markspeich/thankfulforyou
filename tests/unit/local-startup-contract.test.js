import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("local startup contract", () => {
  it("makes npm start use the per-worktree local Supabase environment", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts.start).toBe(packageJson.scripts["start:local"]);
    expect(packageJson.scripts.start).toContain("--env local");
    expect(packageJson.scripts.start).not.toContain("setup_worktree_env");
  });

  it("keeps the dev server from implicitly loading .env.local", async () => {
    const source = await readFile("tools/dev_server.mjs", "utf8");

    expect(source).not.toContain("loadEnvFile");
    expect(source).not.toContain(".env.local");
  });
});
