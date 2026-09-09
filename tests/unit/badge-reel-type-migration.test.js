import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260909184445_store_badge_reel_type.sql",
  import.meta.url,
);

describe("badge reel type storage migration", () => {
  it("adds a nullable canonical ID and backfills only null values from exact Amazon and Etsy fields", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+badge_reel_type_id\s+text/i);
    expect(sql).not.toMatch(/badge_reel_type_id\s+text\s+not\s+null/i);
    expect(sql).toMatch(/personalizationResponses/i);
    expect(sql).toMatch(/variations/i);
    expect(sql).toMatch(/badge\s*reel\s*type/i);
    expect(sql).toMatch(/badge\s*reel/i);
    expect(sql).toMatch(/swivel\s*alligator\s*clip/i);
    expect(sql).toMatch(/swivel\s*alligator/i);
    expect(sql).toMatch(/badge_reel_type_id\s+is\s+null/i);
    expect(sql).toMatch(/with\s+ordinality/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.order_items/i);
    expect(sql).not.toMatch(/drop\s+table\s+public\.order_items/i);
  });

  it("replaces the Amazon wrapper by stripping the new strict-legacy key and atomically enriching null IDs", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.import_amazon_order_items/i);
    expect(sql).toMatch(/-\s*'badge_reel_type_id'/i);
    expect(sql).toMatch(/set\s+badge_reel_type_id\s*=\s*incoming\.badge_reel_type_id/i);
    expect(sql).toMatch(/stored\.badge_reel_type_id\s+is\s+null/i);
    expect(sql).toMatch(/return\s+v_result/i);
  });
});
