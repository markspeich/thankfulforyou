import { afterEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ calls: [], rows: [] }));

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => ({
    from(table) {
      expect(table).toBe("etsy_import_attempts");
      return {
        insert(payload) {
          supabase.calls.push({ operation: "insert", payload });
          return Promise.resolve({ error: null });
        },
        select(columns) {
          supabase.calls.push({ operation: "select", columns });
          const filters = [];
          const chain = {
            eq(column, value) { filters.push([column, value]); return chain; },
            order(column, options) {
              supabase.calls.push({ operation: "order", column, options, filters });
              return Promise.resolve({ data: supabase.rows, error: null });
            },
          };
          return chain;
        },
      };
    },
  }),
}));

afterEach(() => { supabase.calls = []; supabase.rows = []; vi.resetModules(); });

describe("Etsy import attempt store", () => {
  it("inserts only valid, server-side append records", async () => {
    const { appendEtsyImportAttempt } = await import("../../api/_lib/etsy-import-attempt-store.js");

    await appendEtsyImportAttempt({
      runId: "run-1", workspaceId: "workspace-1", initiatedBy: "user-1", orderNumber: "1001",
      transactionId: "txn-1", listingId: "listing-1", outcome: "imported", stage: "persisted",
      rawReceipt: { receipt_id: 1 }, rawTransaction: { transaction_id: 2 }, rawListing: { listing_id: 3 },
      rawImage: [{ url: "image" }, { url: "second-image" }], normalizedItem: { id: "transaction:txn-1" }, persistence: { imported: true },
      fetchErrors: { fetching_listing: { name: "Error", message: "unavailable" } },
    });

    expect(supabase.calls).toEqual([{ operation: "insert", payload: expect.objectContaining({
      run_id: "run-1", workspace_id: "workspace-1", initiated_by: "user-1", order_number: "1001",
      transaction_id: "txn-1", listing_id: "listing-1", outcome: "imported", stage: "persisted",
      raw_receipt: { receipt_id: 1 }, raw_image: [{ url: "image" }, { url: "second-image" }], normalized_item: { id: "transaction:txn-1" }, persistence: { imported: true },
      fetch_errors: { fetching_listing: { name: "Error", message: "unavailable" } },
    }) }]);
    await expect(appendEtsyImportAttempt({ workspaceId: "workspace-1", outcome: "imported", stage: "persisted" })).rejects.toThrow("runId");
    expect(supabase.calls).toHaveLength(1);
  });

  it("lists records by workspace and exact order without exposing a browser API", async () => {
    supabase.rows = [{ id: "attempt-1", order_number: "1001" }];
    const { listEtsyImportAttemptsByOrder } = await import("../../api/_lib/etsy-import-attempt-store.js");

    await expect(listEtsyImportAttemptsByOrder({ workspaceId: "workspace-1", orderNumber: "1001" }))
      .resolves.toEqual([{ id: "attempt-1", order_number: "1001" }]);

    expect(supabase.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "select" }),
      expect.objectContaining({ operation: "order", column: "attempted_at", options: { ascending: false } }),
    ]));
    await expect(listEtsyImportAttemptsByOrder({ workspaceId: "", orderNumber: "1001" })).rejects.toThrow("workspaceId");
  });
});
