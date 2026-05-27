import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { loadEnvFile, parseEnvFile } from "../../tools/env_file.mjs";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("env file loader", () => {
  it("parses dotenv-style key value pairs", () => {
    expect(parseEnvFile(`
      # comment
      SUPABASE_URL=https://example.supabase.co
      SUPABASE_PUBLISHABLE_KEY="publishable-key"
      EMPTY=
      EXPORT_ME='quoted value'
    `)).toEqual({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      EMPTY: "",
      EXPORT_ME: "quoted value",
    });
  });

  it("loads .env.local without overwriting existing process values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tfy-env-"));
    tempDirs.push(dir);
    await writeFile(join(dir, ".env.local"), [
      "SUPABASE_URL=https://example.supabase.co",
      "SUPABASE_PUBLISHABLE_KEY=publishable-key",
    ].join("\n"));

    const targetEnv = {
      SUPABASE_URL: "https://shell.supabase.co",
    };

    expect(loadEnvFile({ cwd: dir, env: targetEnv })).toEqual({
      loaded: true,
      path: join(dir, ".env.local"),
      keys: ["SUPABASE_PUBLISHABLE_KEY"],
    });
    expect(targetEnv).toEqual({
      SUPABASE_URL: "https://shell.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
  });
});
