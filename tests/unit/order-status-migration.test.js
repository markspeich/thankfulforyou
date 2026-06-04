import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("order status migration", () => {
  it("allows the open and complete order lifecycle statuses in Supabase", () => {
    const migrationPath = join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260604190000_open_complete_order_statuses.sql",
    );
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("drop constraint if exists order_items_status_check");
    expect(migration).toContain("default 'open'");
    expect(migration).toContain("status in ('open', 'complete')");
  });
});
