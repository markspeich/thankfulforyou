import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260815124720_ignore_etsy_diagnostics_in_amazon_import.sql",
  import.meta.url,
);

describe("Amazon import compatibility migration", () => {
  it("removes non-Amazon diagnostic fields before strict transactional validation", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.import_amazon_order_items/i);
    expect(sql).toMatch(/-\s*'amazon_customization_json'\s*-\s*'etsy_import_diagnostics'/i);
    expect(sql).toMatch(/set\s+amazon_customization_json\s*=\s*incoming\.document/i);
    expect(sql).not.toMatch(/set\s+etsy_import_diagnostics/i);
  });
});
