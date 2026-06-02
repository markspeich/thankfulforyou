import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildLocalSupabaseEnv,
  buildWindowsShellCommand,
  parseSupabaseStatusEnv,
  resolveRemoteSupabaseEnv,
  validateSupabaseEnv,
} from "../../tools/supabase_env.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "tfy-supabase-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Supabase environment mode helpers", () => {
  it("parses quoted Supabase CLI env output", () => {
    expect(parseSupabaseStatusEnv(`
      API_URL="http://127.0.0.1:54321"
      ANON_KEY="local-anon"
      SERVICE_ROLE_KEY="local-service"
      IGNORED_LINE
    `)).toEqual({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "local-anon",
      SERVICE_ROLE_KEY: "local-service",
    });
  });

  it("builds app Supabase env from local status values", () => {
    expect(buildLocalSupabaseEnv({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "local-anon",
      SERVICE_ROLE_KEY: "local-service",
    })).toEqual({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "local-anon",
      SUPABASE_ANON_KEY: "local-anon",
      SUPABASE_SERVICE_ROLE_KEY: "local-service",
    });
  });

  it("reports missing required Supabase env keys", () => {
    expect(validateSupabaseEnv({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "",
    })).toEqual(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("resolves remote env from .env.local and preserves explicit shell overrides", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, ".env.local"), [
      "SUPABASE_URL=https://remote.supabase.co",
      "SUPABASE_PUBLISHABLE_KEY=remote-publishable",
      "SUPABASE_SERVICE_ROLE_KEY=remote-service",
    ].join("\n"));

    const resolved = await resolveRemoteSupabaseEnv({
      cwd: dir,
      seedPath: join(dir, "missing.env"),
      env: {
        SUPABASE_URL: "https://shell.supabase.co",
      },
    });

    expect(resolved).toEqual({
      SUPABASE_URL: "https://shell.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "remote-publishable",
      SUPABASE_SERVICE_ROLE_KEY: "remote-service",
    });
  });

  it("quotes Windows child command args that contain spaces", () => {
    expect(buildWindowsShellCommand("node", [
      "--input-type=module",
      "-e",
      "console.log(process.env.SUPABASE_URL)",
    ])).toBe("node --input-type=module -e \"console.log(process.env.SUPABASE_URL)\"");
  });
});
