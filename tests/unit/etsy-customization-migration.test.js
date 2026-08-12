import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260811184614_remove_etsy_customization_inference.sql",
  import.meta.url,
);

describe("remove Etsy customization inference migration", () => {
  it("removes only the inferred non-Amazon customization flag", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/update\s+public\.order_items/i);
    expect(sql).toMatch(/source_json\s*=\s*source_json\s*-\s*'customizationNeeded'/i);
    expect(sql).toMatch(/source_json\s*->\s*'customizationNeeded'\s*=\s*'true'::jsonb/i);
    expect(sql).toMatch(/lower\s*\(\s*coalesce\s*\(\s*source_json\s*->>\s*'marketplace'\s*,\s*''\s*\)\s*\)\s*<>\s*'amazon'/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.order_items/i);
  });
});
