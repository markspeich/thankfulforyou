import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { loadEnvFile } from "../../tools/env_file.mjs";
import { spawnCommand } from "../../tools/supabase_env.mjs";
import { generateSupabaseWorktreeConfig } from "../../tools/supabase_worktree_config.mjs";

const migrationSql = readFileSync(
  new URL("../../supabase/migrations/20260909184445_store_badge_reel_type.sql", import.meta.url),
  "utf8",
);
const workspaceId = "11111111-1111-4111-8111-111111111111";

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function localDatabaseId() {
  const config = await generateSupabaseWorktreeConfig();
  const result = spawnCommand("docker", [
    "ps", "--filter", `label=com.supabase.cli.project=${config.projectId}`,
    "--filter", "name=supabase_db_", "--format", "{{.ID}}",
  ], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^[a-f0-9]+$/i);
  return result.stdout.trim();
}

beforeAll(() => {
  loadEnvFile();
  expect(process.env.SUPABASE_URL).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/);
});

describe("badge reel type migration database behavior", () => {
  it("uses marketplace-authoritative first matches and boundary-preserving normalization", async () => {
    // Break caught: separator deletion, cross-marketplace reads, or choosing a later duplicate field changes historical IDs.
    const databaseId = await localDatabaseId();
    const rows = [
      ["amazon-punctuation", { marketplace: "amazon", personalizationResponses: [{ name: "Badge Reel", value: "Swivel—Alligator" }] }],
      ["amazon-concatenated", { marketplace: "amazon", personalizationResponses: [{ name: "Badge Reel", value: "SwivelAlligator" }] }],
      ["amazon-unicode", { marketplace: "amazon", personalizationResponses: [{ name: "Badge Reel", value: "Swível Alligator" }] }],
      ["etsy-known", { marketplace: "etsy", variations: [{ formatted_name: "Badge Reel Type", formatted_value: "Swivel Alligator Clip" }] }],
      ["etsy-first-unknown", { marketplace: "etsy", personalizationResponses: [{ name: "Badge Reel", value: "Swivel Alligator" }], variations: [
        { formatted_name: "Badge Reel", formatted_value: "Unknown" },
        { formatted_name: "Badge Reel", formatted_value: "Swivel Alligator" },
      ] }],
    ];
    const inserts = rows.map(([id, source]) => `(${quote(id)}, ${quote(workspaceId)}::uuid, 'open', 1, ${quote(JSON.stringify(source))}::jsonb)`).join(",\n");
    const sql = `\\pset tuples_only on\n\\pset format unaligned\nbegin;\ninsert into public.order_items (id, workspace_id, status, quantity, source_json) values ${inserts};\n${migrationSql}\nselect jsonb_object_agg(id, badge_reel_type_id order by id) from public.order_items where id in (${rows.map(([id]) => quote(id)).join(", ")});\nrollback;`;
    const result = spawnCommand("docker", [
      "exec", "-i", databaseId, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-",
    ], { encoding: "utf8", input: sql });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const resultLine = result.stdout.trim().split(/\r?\n/).at(-1);
    expect(JSON.parse(resultLine)).toEqual({
      "amazon-concatenated": null,
      "amazon-punctuation": "swivel-alligator",
      "amazon-unicode": null,
      "etsy-first-unknown": null,
      "etsy-known": "swivel-alligator",
    });
  });
});
