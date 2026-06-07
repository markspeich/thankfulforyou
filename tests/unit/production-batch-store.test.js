import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  calls: [],
  batchItems: null,
  presets: [],
  sizeGuides: [],
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
    update(payload) {
      supabaseMock.calls.push({ table, operation: "update", payload });
      return createUpdateChain();
    },
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
      return eqCount >= 3 ? Promise.resolve({ error: null }) : this;
    },
    in() {
      return Promise.resolve({ error: null });
    },
  };
}

function createUpdateChain() {
  return {
    eq() {
      return this;
    },
    in() {
      return Promise.resolve({ error: null });
    },
    neq() {
      return Promise.resolve({ error: null });
    },
    select() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: { id: "batch-1" },
        error: null,
      });
    },
    then(resolve) {
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
}

function createSelectChain(table) {
  return {
    eq() {
      return this;
    },
    neq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      if (table === "batch_items") {
        return Promise.resolve({
          data: supabaseMock.batchItems || [{ order_item_id: "order-1", batch_position: 0, status: "active" }],
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
      if (table === "size_guides") {
        return Promise.resolve({
          data: supabaseMock.sizeGuides,
          error: null,
        }).then(resolve);
      }

      if (table === "presets") {
        return Promise.resolve({
          data: supabaseMock.presets,
          error: null,
        }).then(resolve);
      }

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
  supabaseMock.batchItems = null;
  supabaseMock.sizeGuides = [];
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

  it("only bumps and upserts changed order rows for scoped saves", async () => {
    const { saveProductionBatch } = await import("../../api/_lib/production-batch-store.js");

    await saveProductionBatch({
      userId: "user-1",
      changedOrderItemIds: ["order-2"],
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-2",
        orderItems: [
          {
            id: "order-1",
            revision: 7,
            text: "Unchanged",
            status: "captured",
            source: {},
            settings: {
              text: "Unchanged",
              presetId: null,
              boundingSizePresetId: null,
              lines: [{ fontId: "candlepin" }],
            },
          },
          {
            id: "order-2",
            revision: 3,
            text: "Changed",
            status: "captured",
            source: {},
            settings: {
              text: "Changed",
              presetId: null,
              boundingSizePresetId: null,
              lines: [{ fontId: "candlepin" }],
            },
          },
        ],
      },
    });

    const orderItemsUpsert = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "upsert");
    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");
    const batchItemsDelete = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "delete");
    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(orderItemsUpsert.payload).toHaveLength(1);
    expect(orderItemsUpsert.payload[0]).toMatchObject({ id: "order-2", revision: 4 });
    expect(designsUpsert.payload).toHaveLength(1);
    expect(designsUpsert.payload[0]).toMatchObject({ order_item_id: "order-2", revision: 4 });
    expect(batchItemsDelete).toBeUndefined();
    expect(batchItemsUpsert.payload).toHaveLength(1);
    expect(batchItemsUpsert.payload[0]).toMatchObject({ order_item_id: "order-2" });
  });

  it("does not upsert stale size guide ids that are missing from the workspace", async () => {
    supabaseMock.sizeGuides = [{ id: "size-existing" }];
    const { saveProductionBatch } = await import("../../api/_lib/production-batch-store.js");

    await saveProductionBatch({
      userId: "user-1",
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-1",
        orderItems: [
          {
            id: "order-1",
            revision: 1,
            text: "Stale Guide",
            status: "captured",
            source: {},
            settings: {
              text: "Stale Guide",
              presetId: null,
              boundingSizePresetId: "size-missing",
              lines: [{ fontId: "candlepin" }],
            },
          },
        ],
      },
    });

    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");

    expect(designsUpsert.payload[0].size_guide_id).toBeNull();
  });

  it("does not upsert preset ids that are missing from the workspace", async () => {
    supabaseMock.presets = [{ id: "preset-existing" }];
    const { saveProductionBatch } = await import("../../api/_lib/production-batch-store.js");

    await saveProductionBatch({
      userId: "user-1",
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-1",
        orderItems: [
          {
            id: "order-1",
            revision: 1,
            text: "Lungs",
            status: "captured",
            source: {},
            settings: {
              text: "Lungs",
              presetId: "preset-missing",
              boundingSizePresetId: null,
              lines: [
                {
                  kind: "fixedSvg",
                  fixedDesignId: "fixed-design-lungs",
                  fixedDesignName: "Lungs",
                  fixedDesignVersion: 1,
                  svgSizeMm: 44.5,
                  offsetXMm: 0,
                  offsetYMm: 0,
                },
              ],
            },
          },
        ],
      },
    });

    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");

    expect(designsUpsert.payload[0].preset_id).toBeNull();
  });

  it("completes order items and removes batch memberships without writing archived status", async () => {
    const { completeProductionBatch } = await import("../../api/_lib/production-batch-store.js");

    await completeProductionBatch({
      batchId: "batch-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    const batchUpdate = supabaseMock.calls.find((call) => call.table === "production_batches" && call.operation === "update");
    const orderItemsUpdate = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "update");
    const batchItemsDelete = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "delete");
    const archivedWrite = supabaseMock.calls.find((call) => JSON.stringify(call.payload || {}).includes("archived"));
    const orderItemsDelete = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "delete");
    const designsDelete = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "delete");

    expect(batchUpdate.payload).toMatchObject({
      active_order_item_id: null,
      updated_by: "user-1",
    });
    expect(orderItemsUpdate.payload).toMatchObject({
      status: "complete",
      updated_by: "user-1",
    });
    expect(batchItemsDelete).toBeDefined();
    expect(archivedWrite).toBeUndefined();
    expect(orderItemsDelete).toBeUndefined();
    expect(designsDelete).toBeUndefined();
  });

  it("removes one batch membership without deleting saved order or design records", async () => {
    const { removeProductionBatchItem } = await import("../../api/_lib/production-batch-store.js");

    await removeProductionBatchItem({
      batchId: "batch-1",
      orderItemId: "order-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    const batchUpdate = supabaseMock.calls.find((call) => call.table === "production_batches" && call.operation === "update");
    const batchItemsDelete = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "delete");
    const archivedWrite = supabaseMock.calls.find((call) => JSON.stringify(call.payload || {}).includes("archived"));
    const orderItemsDelete = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "delete");
    const designsDelete = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "delete");

    expect(batchUpdate.payload).toMatchObject({
      active_order_item_id: null,
      updated_by: "user-1",
    });
    expect(batchItemsDelete).toBeDefined();
    expect(archivedWrite).toBeUndefined();
    expect(orderItemsDelete).toBeUndefined();
    expect(designsDelete).toBeUndefined();
  });
});
