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
      ["etsy-known", { variations: [{ formatted_name: "Badge Reel Type", formatted_value: "Swivel Alligator Clip" }] }],
      ["etsy-first-unknown", { personalizationResponses: [{ name: "Badge Reel", value: "Swivel Alligator" }], variations: [
        { formatted_name: "Badge Reel", formatted_value: "Unknown" },
        { formatted_name: "Badge Reel", formatted_value: "Swivel Alligator" },
      ] }],
      ["amazon-mixed", { marketplace: "amazon", variations: [{ formatted_name: "Badge Reel", formatted_value: "Swivel Alligator" }] }],
      ["unknown-marketplace", { marketplace: "shopify", variations: [{ formatted_name: "Badge Reel", formatted_value: "Swivel Alligator" }] }],
      ["amazon-blank-marker", { marketplace: "amazon", badgeReelTypeCandidate: { present: true, id: null }, personalizationResponses: [{ name: "Badge Reel Type", value: "Swivel Alligator" }] }],
      ["amazon-unknown-marker", { marketplace: "amazon", badgeReelTypeCandidate: { present: true, id: null }, personalizationResponses: [{ name: "Badge Reel", value: "Unknown" }, { name: "Badge Reel Type", value: "Swivel Alligator" }] }],
      ["amazon-legacy-unknown-first", { marketplace: "amazon", personalizationResponses: [{ name: "Badge Reel", value: "Unknown" }, { name: "Badge Reel Type", value: "Swivel Alligator" }] }],
      ["amazon-known-marker", { marketplace: "amazon", badgeReelTypeCandidate: { present: true, id: "swivel-alligator" }, personalizationResponses: [] }],
      ["amazon-absent-marker", { marketplace: "amazon", badgeReelTypeCandidate: { present: false, id: null }, personalizationResponses: [{ name: "Badge Reel", value: "Swivel Alligator" }] }],
      ["amazon-internal-first", { marketplace: "amazon", personalizationResponses: [{ name: "^Badge Reel", value: "Unknown" }, { name: "Badge Reel Type", value: "Swivel Alligator" }] }],
      ["amazon-internal-only", { marketplace: "amazon", personalizationResponses: [{ name: "^Badge Reel", value: "Swivel Alligator" }] }],
      ["existing-id", { variations: [{ formatted_name: "Badge Reel", formatted_value: "Swivel Alligator" }] }, "existing-canonical"],
      ["etsy-blank-first", { variations: [{ formatted_name: "Badge Reel", formatted_value: " " }, { formatted_name: "Badge Reel Type", formatted_value: "Swivel Alligator" }] }],
      ...[null, {}, "malformed", 42].flatMap((value, index) => [
        [`amazon-malformed-${index}`, { marketplace: "amazon", personalizationResponses: value }],
        [`etsy-malformed-${index}`, { marketplace: "etsy", variations: value }],
      ]),
    ];
    const inserts = rows.map(([id, source, storedId]) => `(${quote(id)}, ${quote(workspaceId)}::uuid, 'open', 1, ${quote(JSON.stringify(source))}::jsonb, ${storedId ? quote(storedId) : "null"})`).join(",\n");
    const sql = `\\pset tuples_only on\n\\pset format unaligned\nbegin;\ninsert into public.order_items (id, workspace_id, status, quantity, source_json, badge_reel_type_id) values ${inserts};\n${migrationSql}\nselect jsonb_object_agg(id, badge_reel_type_id order by id) from public.order_items where id in (${rows.map(([id]) => quote(id)).join(", ")});\nselect jsonb_object_agg(item ->> 'id', item) from public.list_workspace_order_summaries(${quote(workspaceId)}::uuid, p_status_filter => 'all') summary cross join lateral jsonb_array_elements(summary.items) item where item ->> 'id' in (${rows.map(([id]) => quote(id)).join(", ")});\nselect jsonb_object_agg(id, source_json) from public.order_items where id in (${rows.map(([id]) => quote(id)).join(", ")});\nrollback;`;
    const result = spawnCommand("docker", [
      "exec", "-i", databaseId, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-",
    ], { encoding: "utf8", input: sql });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const resultLines = result.stdout.trim().split(/\r?\n/);
    const resultLine = resultLines.at(-3);
    expect(JSON.parse(resultLine)).toEqual({
      "amazon-concatenated": null,
      "amazon-punctuation": "swivel-alligator",
      "amazon-unicode": null,
      "etsy-first-unknown": null,
      "etsy-known": "swivel-alligator",
      "amazon-mixed": null,
      "unknown-marketplace": null,
      "amazon-blank-marker": null,
      "amazon-unknown-marker": null,
      "amazon-legacy-unknown-first": null,
      "amazon-known-marker": "swivel-alligator",
      "amazon-absent-marker": null,
      "amazon-internal-first": "swivel-alligator",
      "amazon-internal-only": null,
      "existing-id": "existing-canonical",
      "etsy-blank-first": null,
      ...Object.fromEntries([0, 1, 2, 3].flatMap((index) => [[`amazon-malformed-${index}`, null], [`etsy-malformed-${index}`, null]])),
    });
    const compact = JSON.parse(resultLines.at(-2));
    for (const id of ["amazon-blank-marker", "amazon-unknown-marker", "etsy-first-unknown", "etsy-blank-first"]) {
      expect(compact[id].badge_reel_type_candidate_present).toBe(true);
      expect(compact[id].source_json).not.toHaveProperty("personalizationResponses");
      expect(compact[id].source_json).not.toHaveProperty("variations");
    }
    for (const id of ["amazon-mixed", "unknown-marketplace", "amazon-absent-marker", "amazon-internal-only", "etsy-malformed-0"]) {
      expect(compact[id].badge_reel_type_candidate_present).toBe(false);
    }
    expect(JSON.parse(resultLines.at(-1))).toEqual(Object.fromEntries(rows));
  });
});
