import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260826213012_store_etsy_import_attempts.sql",
  import.meta.url,
);

describe("Etsy import attempts migration", () => {
  it("creates an append-only service-role audit table with lookup indexes", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/create\s+table\s+public\.etsy_import_attempts/i);
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i);
    expect(sql).toMatch(/workspace_id\s+uuid\s+not\s+null\s+references\s+public\.workspaces\(id\)(?!\s+on\s+delete)/i);
    expect(sql).toMatch(/initiated_by\s+uuid(?:\s*,|\s+\n)/i);
    expect(sql).not.toMatch(/initiated_by[^,\n]*references/i);
    expect(sql).toMatch(/outcome\s+text\s+not\s+null\s+check\s*\(\s*outcome\s+in\s*\('imported',\s*'existing',\s*'failed'\)/i);
    for (const column of ["raw_receipt", "raw_transaction", "raw_listing", "raw_image", "normalized_item", "persistence", "fetch_errors", "error"]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+jsonb`, "i"));
    }
    expect(sql).toMatch(/alter\s+table\s+public\.etsy_import_attempts\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.etsy_import_attempts\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+select,\s*insert\s+on\s+table\s+public\.etsy_import_attempts\s+to\s+service_role/i);
    expect(sql).not.toMatch(/grant\s+[^;]*(update|delete)[^;]*etsy_import_attempts/i);
    expect(sql).toMatch(/create\s+index[^;]*etsy_import_attempts_workspace_order_attempted/i);
    expect(sql).toMatch(/workspace_id,\s*order_number,\s*attempted_at\s+desc/i);
    expect(sql).toMatch(/create\s+index[^;]*etsy_import_attempts_run_id/i);
  });
});
