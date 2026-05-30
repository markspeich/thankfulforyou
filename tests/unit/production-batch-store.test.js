import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  calls: [],
}));

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => createSupabaseClientMock(),
}));

function createSupabaseClientMock() {
  return {
    from(table) {
      return createTableMock(table);
    },
  };
}

function createTableMock(table) {
  return {
    upsert(payload) {
      supabaseMock.calls.push({ table, operation: "upsert", payload });

      if (table === "designs") {
        return {
          select: async () => ({
            data: [{ id: "design-1", order_item_id: "order-1" }],
            error: null,
          }),
        };
      }

      return Promise.resolve({ error: null });
    },
    insert(payload) {
      supabaseMock.calls.push({ table, operation: "insert", payload });
      return Promise.resolve({ error: null });
    },
    delete() {
      supabaseMock.calls.push({ table, operation: "delete" });
      return createDeleteChain();
    },
    select() {
      return createSelectChain(table);
    },
  };
}

function createDeleteChain() {
  let eqCount = 0;
  return {
    eq() {
      eqCount += 1;
      return eqCount >= 2 ? Promise.resolve({ error: null }) : this;
    },
    in() {
      return Promise.resolve({ error: null });
    },
  };
}

function createSelectChain(table) {
  return {
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      if (table === "batch_items") {
        return Promise.resolve({
          data: [{ order_item_id: "order-1", batch_position: 0, status: "active" }],
          error: null,
        });
      }

      if (table === "design_lines") {
        return Promise.resolve({
          data: [{ design_id: "design-1", line_index: 0, text: "Test", font_id: "candlepin" }],
          error: null,
        });
      }

      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: {
          id: "batch-1",
          workspace_id: "workspace-1",
          name: "Primary Batch",
          status: "active",
          active_order_item_id: "order-1",
          revision: 1,
          updated_at: "2026-05-30T18:00:00.000Z",
          updated_by: null,
        },
        error: null,
      });
    },
    then(resolve) {
      if (table === "order_items") {
        return Promise.resolve({
          data: [{
            id: "order-1",
            workspace_id: "workspace-1",
            source_json: {},
            quantity: 1,
            revision: 1,
          }],
          error: null,
        }).then(resolve);
      }

      if (table === "designs") {
        return Promise.resolve({
          data: [{
            id: "design-1",
            workspace_id: "workspace-1",
            order_item_id: "order-1",
            design_text: "Test",
            production_status: "saved",
          }],
          error: null,
        }).then(resolve);
      }

      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
}

afterEach(() => {
  supabaseMock.calls = [];
  vi.resetModules();
});

describe("production batch store", () => {
  it("creates order items before saving a batch that references the active order item", async () => {
    const { saveProductionBatch } = await import("../../api/_lib/production-batch-store.js");

    await saveProductionBatch({
      userId: null,
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-1",
        orderItems: [{
          id: "order-1",
          revision: 1,
          text: "Test",
          status: "captured",
          source: {},
          settings: {
            text: "Test",
            presetId: null,
            boundingSizePresetId: null,
            lines: [{ fontId: "candlepin" }],
          },
        }],
      },
    });

    const orderItemsUpsertIndex = supabaseMock.calls.findIndex((call) => call.table === "order_items" && call.operation === "upsert");
    const batchUpsertIndex = supabaseMock.calls.findIndex((call) => call.table === "production_batches" && call.operation === "upsert");

    expect(orderItemsUpsertIndex).toBeGreaterThanOrEqual(0);
    expect(batchUpsertIndex).toBeGreaterThanOrEqual(0);
    expect(orderItemsUpsertIndex).toBeLessThan(batchUpsertIndex);
  });
});
