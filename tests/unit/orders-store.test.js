import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  calls: [],
  db: {
    order_items: [],
    designs: [],
    design_lines: [],
    batch_items: [],
  },
}));

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => createSupabaseClientMock(),
}));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetDb(nextDb = {}) {
  supabaseMock.calls = [];
  supabaseMock.db = {
    order_items: [],
    designs: [],
    design_lines: [],
    batch_items: [],
    ...clone(nextDb),
  };
}

function createSupabaseClientMock() {
  return {
    from(table) {
      return createTableMock(table);
    },
  };
}

function createTableMock(table) {
  return {
    select(columns) {
      return createSelectChain(table, columns);
    },
    upsert(payload, options = {}) {
      supabaseMock.calls.push({ table, operation: "upsert", payload: clone(payload), options });
      upsertRows(table, Array.isArray(payload) ? payload : [payload], options.onConflict);
      return createMutationResult(table, Array.isArray(payload) ? payload : [payload]);
    },
    insert(payload) {
      supabaseMock.calls.push({ table, operation: "insert", payload: clone(payload) });
      supabaseMock.db[table].push(...clone(Array.isArray(payload) ? payload : [payload]));
      return Promise.resolve({ data: null, error: null });
    },
    delete() {
      return createDeleteChain(table);
    },
  };
}

function createMutationResult(table, payload) {
  const result = {
    data: null,
    error: null,
  };

  return {
    select() {
      if (table === "designs") {
        result.data = payload.map((row) => {
          const saved = supabaseMock.db.designs.find((design) => design.order_item_id === row.order_item_id);
          return { id: saved.id, order_item_id: saved.order_item_id };
        });
      }

      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function createSelectChain(table) {
  const filters = [];
  const state = { orderColumn: null, ascending: true };
  const chain = {
    eq(column, value) {
      filters.push((row) => row[column] === value);
      return chain;
    },
    neq(column, value) {
      filters.push((row) => row[column] !== value);
      return chain;
    },
    in(column, values) {
      filters.push((row) => values.includes(row[column]));
      return chain;
    },
    order(column, options = {}) {
      state.orderColumn = column;
      state.ascending = options.ascending !== false;
      return chain;
    },
    then(resolve, reject) {
      return resolveRows(table, filters, state).then(resolve, reject);
    },
  };
  return chain;
}

function createDeleteChain(table) {
  const call = { table, operation: "delete", filters: [] };
  supabaseMock.calls.push(call);

  return {
    in(column, values) {
      call.filters.push({ type: "in", column, values: clone(values) });
      supabaseMock.db[table] = supabaseMock.db[table].filter((row) => !values.includes(row[column]));
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function resolveRows(table, filters, state) {
  let rows = [...supabaseMock.db[table]];
  for (const filter of filters) {
    rows = rows.filter(filter);
  }

  if (state.orderColumn) {
    rows.sort((first, second) => {
      const left = first[state.orderColumn];
      const right = second[state.orderColumn];
      if (left === right) {
        return 0;
      }
      const direction = state.ascending ? 1 : -1;
      return left > right ? direction : -direction;
    });
  }

  return Promise.resolve({ data: clone(rows), error: null });
}

function upsertRows(table, rows, onConflict) {
  for (const row of rows) {
    if (table === "designs" && !row.id) {
      row.id = `design-${row.order_item_id}`;
    }

    const conflictColumns = String(onConflict || "id").split(",").map((column) => column.trim());
    const existingIndex = supabaseMock.db[table].findIndex((existing) => (
      conflictColumns.every((column) => existing[column] === row[column])
    ));

    if (existingIndex >= 0) {
      supabaseMock.db[table][existingIndex] = {
        ...supabaseMock.db[table][existingIndex],
        ...clone(row),
      };
    } else {
      supabaseMock.db[table].push(clone(row));
    }
  }
}

afterEach(() => {
  resetDb();
  vi.resetModules();
});

describe("orders store", () => {
  it("lists non-archived workspace order items grouped by order number with designs and active batch membership", async () => {
    resetDb({
      order_items: [
        {
          id: "item-1",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "1001",
          buyer_name: "Ada Lovelace",
          listing_id: "listing-1",
          transaction_id: "txn-1",
          imported_color: "Pink",
          quantity: 1,
          source_json: { listingTitle: "Badge Reel" },
          revision: 1,
          updated_at: "2026-06-01T10:00:00.000Z",
          updated_by: "user-1",
        },
        {
          id: "item-2",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "1001",
          buyer_name: "Ada Lovelace",
          listing_id: "listing-2",
          transaction_id: "txn-2",
          imported_color: "Blue",
          quantity: 2,
          source_json: {},
          revision: 1,
          updated_at: "2026-06-01T10:05:00.000Z",
          updated_by: "user-1",
        },
        {
          id: "archived-item",
          workspace_id: "workspace-1",
          status: "archived",
          order_number: "1002",
          buyer_name: "Grace Hopper",
          source_json: {},
          quantity: 1,
        },
      ],
      designs: [
        {
          id: "design-1",
          workspace_id: "workspace-1",
          order_item_id: "item-1",
          design_text: "Ada",
          preset_id: "skywalk",
          size_guide_id: "circle-2",
          backing_border_mm: 3.1,
          weld_exported_design: true,
          global_horizontal_scale: 1,
          global_vertical_scale: 1,
          production_status: "draft",
        },
        {
          id: "design-2",
          workspace_id: "workspace-1",
          order_item_id: "item-2",
          design_text: "RN",
          preset_id: "somekind",
          backing_border_mm: 2.8,
          weld_exported_design: false,
          global_horizontal_scale: 0.95,
          global_vertical_scale: 1.05,
          production_status: "saved",
        },
      ],
      design_lines: [
        { design_id: "design-2", line_index: 0, text: "RN", font_id: "somekind", letter_bridge_mm: 0.7 },
        { design_id: "design-1", line_index: 0, text: "Ada", font_id: "skywalk", letter_bridge_mm: 0.5 },
      ],
      batch_items: [
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-2",
          batch_position: 0,
          status: "active",
        },
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-1",
          batch_position: 1,
          status: "archived",
        },
      ],
    });

    const { listWorkspaceOrders } = await import("../../api/_lib/orders-store.js");

    const result = await listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      id: "order:1001",
      orderNumber: "1001",
      buyerName: "Ada Lovelace",
      isInActiveBatch: true,
    });
    expect(result.orders[0].items).toHaveLength(2);
    expect(result.orders[0].items[0]).toMatchObject({
      id: "item-1",
      orderNumber: "1001",
      isInActiveBatch: false,
      design: {
        id: "design-1",
        text: "Ada",
        lines: [{ lineIndex: 0, text: "Ada", fontId: "skywalk" }],
      },
    });
    expect(result.orders[0].items[1]).toMatchObject({
      id: "item-2",
      isInActiveBatch: true,
      design: {
        id: "design-2",
        text: "RN",
        lines: [{ lineIndex: 0, text: "RN", fontId: "somekind" }],
      },
    });
  });

  it("imports order items into a production batch and inserts only missing active memberships", async () => {
    resetDb({
      batch_items: [
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "transaction:txn-existing",
          batch_position: 0,
          status: "active",
          added_by: "user-1",
        },
      ],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "productionBatch",
      batchId: "batch-1",
      items: [
        {
          text: "Existing",
          presetId: "skywalk",
          source: { orderNumber: "2001", transactionId: "txn-existing", buyerName: "Ada" },
        },
        {
          text: "New\nRN",
          presetId: "somekind",
          source: { orderNumber: "2001", transactionId: "txn-new", buyerName: "Ada", quantity: "2" },
          settings: {
            lines: [{ fontId: "somekind" }, { fontId: "candlepin", bridgeMm: 0.8 }],
          },
        },
      ],
    });

    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");
    const lineUpsert = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "upsert");

    expect(batchItemsUpsert.options).toEqual({ onConflict: "batch_id,order_item_id" });
    expect(batchItemsUpsert.payload).toHaveLength(1);
    expect(batchItemsUpsert.payload[0]).toMatchObject({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "transaction:txn-new",
      batch_position: 1,
      status: "active",
      added_by: "user-1",
    });
    expect(lineUpsert.options).toEqual({ onConflict: "design_id,line_index" });
    expect(lineUpsert.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        design_id: "design-transaction:txn-new",
        line_index: 0,
        text: "New",
        font_id: "somekind",
      }),
      expect.objectContaining({
        design_id: "design-transaction:txn-new",
        line_index: 1,
        text: "RN",
        font_id: "candlepin",
        letter_bridge_mm: 0.8,
      }),
    ]));
    expect(result).toMatchObject({
      importedCount: 2,
      addedToBatchCount: 1,
    });
  });

  it("imports order items to the orders workspace without inserting batch memberships", async () => {
    resetDb();
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
      batchId: "batch-1",
      items: [{
        text: "Ada",
        source: { orderNumber: "3001", transactionId: "txn-orders-target", buyerName: "Ada" },
      }],
    });

    const orderItemsUpsert = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "upsert");
    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");
    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(orderItemsUpsert.payload[0]).toMatchObject({
      id: "transaction:txn-orders-target",
      workspace_id: "workspace-1",
      order_number: "3001",
      buyer_name: "Ada",
      status: "active",
      updated_by: "user-1",
    });
    expect(designsUpsert.payload[0]).toMatchObject({
      workspace_id: "workspace-1",
      order_item_id: "transaction:txn-orders-target",
      design_text: "Ada",
      production_status: "draft",
    });
    expect(batchItemsUpsert).toBeUndefined();
    expect(result).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 0,
    });
  });

  it("replaces old imported design lines when re-imported text has fewer lines", async () => {
    resetDb({
      order_items: [{
        id: "transaction:txn-reimport",
        workspace_id: "workspace-1",
        status: "active",
        order_number: "3501",
        buyer_name: "Ada",
        transaction_id: "txn-reimport",
        source_json: { orderNumber: "3501", transactionId: "txn-reimport", buyerName: "Ada" },
        quantity: 1,
      }],
      designs: [{
        id: "design-transaction:txn-reimport",
        workspace_id: "workspace-1",
        order_item_id: "transaction:txn-reimport",
        design_text: "Name\nRN",
      }],
      design_lines: [
        { design_id: "design-transaction:txn-reimport", line_index: 0, text: "Name", font_id: "skywalk" },
        { design_id: "design-transaction:txn-reimport", line_index: 1, text: "RN", font_id: "somekind" },
      ],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      items: [{
        text: "Name",
        source: { orderNumber: "3501", transactionId: "txn-reimport", buyerName: "Ada" },
        settings: { lines: [{ fontId: "skywalk" }] },
      }],
    });

    const designLinesDelete = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "delete");
    const designLinesUpsert = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "upsert");
    const importedItem = result.orders[0].items[0];

    expect(designLinesDelete).toMatchObject({
      table: "design_lines",
      operation: "delete",
      filters: [{ type: "in", column: "design_id", values: ["design-transaction:txn-reimport"] }],
    });
    expect(supabaseMock.calls.indexOf(designLinesDelete)).toBeLessThan(supabaseMock.calls.indexOf(designLinesUpsert));
    expect(importedItem.design.lines).toEqual([
      expect.objectContaining({ lineIndex: 0, text: "Name", fontId: "skywalk" }),
    ]);
  });

  it("adds every item in a grouped order to a production batch", async () => {
    resetDb({
      order_items: [
        {
          id: "item-1",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "4001",
          buyer_name: "Ada",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-2",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "4001",
          buyer_name: "Ada",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-3",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "4002",
          buyer_name: "Grace",
          source_json: {},
          quantity: 1,
        },
      ],
      designs: [
        { id: "design-1", workspace_id: "workspace-1", order_item_id: "item-1", design_text: "Ada" },
        { id: "design-2", workspace_id: "workspace-1", order_item_id: "item-2", design_text: "RN" },
        { id: "design-3", workspace_id: "workspace-1", order_item_id: "item-3", design_text: "Grace" },
      ],
      batch_items: [
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-1",
          batch_position: 0,
          status: "active",
          added_by: "user-1",
        },
      ],
    });
    const { addOrderGroupsToProductionBatch } = await import("../../api/_lib/orders-store.js");

    await addOrderGroupsToProductionBatch({
      workspaceId: "workspace-1",
      userId: "user-2",
      batchId: "batch-1",
      orderIds: ["order:4001"],
    });

    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(batchItemsUpsert.payload).toEqual([expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "item-2",
      batch_position: 1,
      status: "active",
      added_by: "user-2",
    })]);
  });

  it("filters direct batch item additions to active order items in the workspace", async () => {
    resetDb({
      order_items: [
        {
          id: "item-valid",
          workspace_id: "workspace-1",
          status: "active",
          order_number: "5001",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-other-workspace",
          workspace_id: "workspace-2",
          status: "active",
          order_number: "5002",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-archived",
          workspace_id: "workspace-1",
          status: "archived",
          order_number: "5003",
          source_json: {},
          quantity: 1,
        },
      ],
    });
    const { addOrderItemsToProductionBatch } = await import("../../api/_lib/orders-store.js");

    const result = await addOrderItemsToProductionBatch({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderItemIds: ["item-valid", "item-other-workspace", "item-archived", "item-missing"],
    });

    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(result).toEqual({ addedOrderItemIds: ["item-valid"] });
    expect(batchItemsUpsert.payload).toEqual([expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "item-valid",
      batch_position: 0,
      status: "active",
      added_by: "user-1",
    })]);
  });
});
