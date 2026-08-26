import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  calls: [],
  db: {
    production_batches: [],
    order_items: [],
    designs: [],
    design_lines: [],
    batch_items: [],
    order_summary_rows: [],
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
    production_batches: [],
    order_items: [],
    designs: [],
    design_lines: [],
    batch_items: [],
    order_summary_rows: [],
    ...clone(nextDb),
  };
}

function createSupabaseClientMock() {
  return {
    from(table) {
      return createTableMock(table);
    },
    async rpc(name, args) {
      supabaseMock.calls.push({ operation: "rpc", name, args: clone(args) });
      if (name === "list_workspace_order_summaries") {
        return { data: clone(supabaseMock.db.order_summary_rows), error: null };
      }
      if (name !== "add_order_items_to_production_batch") return { data: null, error: new Error("Unexpected RPC") };
      const activeIds = new Set(supabaseMock.db.batch_items.filter((row) => row.batch_id === args.p_batch_id && row.status === "active").map((row) => row.order_item_id));
      const eligible = [...new Set(args.p_order_item_ids || [])].filter((id) => supabaseMock.db.order_items.some((row) => row.id === id && row.workspace_id === args.p_workspace_id && ["open", "complete", "skipped"].includes(row.status)) && !activeIds.has(id));
      const nextPosition = supabaseMock.db.batch_items.reduce((max, row) => row.batch_id === args.p_batch_id ? Math.max(max, row.batch_position || 0) : max, -1) + 1;
      const payload = eligible.map((id, index) => ({ workspace_id: args.p_workspace_id, batch_id: args.p_batch_id, order_item_id: id, batch_position: nextPosition + index, status: "active", added_by: args.p_user_id }));
      supabaseMock.calls.push({ table: "batch_items", operation: "upsert", payload: clone(payload), options: { onConflict: "batch_id,order_item_id" } });
      upsertRows("batch_items", payload, "batch_id,order_item_id");
      supabaseMock.db.order_items
        .filter((row) => eligible.includes(row.id) && row.status === "skipped")
        .forEach((row) => Object.assign(row, { status: "open", updated_by: args.p_user_id }));
      return { data: eligible.map((id) => ({ order_item_id: id })), error: null };
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
    update(payload) {
      return createUpdateChain(table, payload);
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

function createSelectChain(table, columns) {
  supabaseMock.calls.push({ table, operation: "select", columns });
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
  const chain = {
    eq(column, value) {
      call.filters.push({ type: "eq", column, value });
      return chain;
    },
    in(column, values) {
      call.filters.push({ type: "in", column, values: clone(values) });
      applyDeleteFilters(table, call.filters);
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve, reject) {
      applyDeleteFilters(table, call.filters);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  return chain;
}

function createUpdateChain(table, payload) {
  const filters = [];
  const call = { table, operation: "update", payload: clone(payload), filters };
  supabaseMock.calls.push(call);
  const chain = {
    eq(column, value) {
      filters.push({ type: "eq", column, value });
      return chain;
    },
    in(column, values) {
      filters.push({ type: "in", column, values: clone(values) });
      return chain;
    },
    then(resolve, reject) {
      const matchingRows = supabaseMock.db[table].filter((row) => matchesFilters(row, filters));
      matchingRows.forEach((row) => {
        Object.assign(row, clone(payload));
      });
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
    select() {
      return {
        maybeSingle() {
          const matchingRows = supabaseMock.db[table].filter((row) => matchesFilters(row, filters));
          if (!matchingRows.length) {
            return Promise.resolve({ data: null, error: null });
          }
          const row = matchingRows[0];
          Object.assign(row, clone(payload));
          return Promise.resolve({ data: clone(row), error: null });
        },
        then(resolve, reject) {
          const matchingRows = supabaseMock.db[table].filter((row) => matchesFilters(row, filters));
          matchingRows.forEach((row) => {
            Object.assign(row, clone(payload));
          });
          return Promise.resolve({ data: clone(matchingRows), error: null }).then(resolve, reject);
        },
      };
    },
  };
  return chain;
}

function matchesFilters(row, filters) {
  return filters.every((filter) => {
    if (filter.type === "eq") {
      return row[filter.column] === filter.value;
    }
    if (filter.type === "in") {
      return filter.values.includes(row[filter.column]);
    }
    return true;
  });
}

function applyDeleteFilters(table, filters) {
  supabaseMock.db[table] = supabaseMock.db[table].filter((row) => !matchesFilters(row, filters));
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
  it("lists a compact paginated RPC result without hydrating design details", async () => {
    // Break caught: the compact list falls back to unbounded table reads or leaks large design fields.
    resetDb({
      order_summary_rows: [{
        group_id: "order:1001",
        sort_key: "3:0000000000000000000000000000000000001001",
        order_number: "1001",
        buyer_name: "Ada",
        group_status: "open",
        is_in_active_batch: true,
        ship_by_date: "2026-08-12",
        items: [{
          id: "item-1", status: "open", order_number: "1001", buyer_name: "Ada",
          listing_id: "listing-1", transaction_id: "txn-1", imported_color: "Pink",
          ship_by_date: "2026-08-12", quantity: 1,
          source_json: { marketplace: "etsy", listingTitle: "Badge Reel" },
          revision: 3, updated_at: "2026-08-05T12:00:00.000Z", updated_by: null,
          is_in_active_batch: true, design_id: "design-1", design_text: "Ada\nRN",
          design_production_status: "export_ready",
        }],
      }, {
        group_id: "order:1000",
        sort_key: "3:0000000000000000000000000000000000001000",
        order_number: "1000",
        buyer_name: "Extra",
        group_status: "open",
        is_in_active_batch: false,
        ship_by_date: null,
        items: [],
      }],
    });
    const { listWorkspaceOrderSummaries } = await import("../../api/_lib/orders-store.js");

    const result = await listWorkspaceOrderSummaries({
      workspaceId: "workspace-1",
      activeBatchId: " batch-1 ",
      statusFilter: "complete",
      batchFilter: "inBatch",
      searchTerm: "  ADA  ",
      limit: 1,
      cursor: { version: 1, sortKey: "cursor-key", groupId: "order:cursor" },
    });

    expect(result.orders[0].items[0]).toMatchObject({
      id: "item-1",
      designText: "Ada\nRN",
      designProductionStatus: "export_ready",
      source: { marketplace: "etsy", listingTitle: "Badge Reel" },
    });
    expect(result.orders[0].items[0]).not.toHaveProperty("design");
    expect(JSON.stringify(result)).not.toContain("geometry");
    expect(result).toMatchObject({
      hasMore: true,
      nextCursorValues: {
        sortKey: "3:0000000000000000000000000000000000001001",
        groupId: "order:1001",
      },
    });
    expect(result.orders).toHaveLength(1);
    expect(supabaseMock.calls[0]).toEqual({
      operation: "rpc",
      name: "list_workspace_order_summaries",
      args: {
        p_workspace_id: "workspace-1",
        p_active_batch_id: "batch-1",
        p_status_filter: "complete",
        p_batch_filter: "inBatch",
        p_search_term: "ADA",
        p_requested_limit: 1,
        p_cursor_sort_key: "cursor-key",
        p_cursor_group_id: "order:cursor",
      },
    });
    expect(supabaseMock.calls.filter((call) => call.operation === "select")).toEqual([]);
    expect(supabaseMock.calls.some((call) => call.table === "design_lines" && call.operation === "select")).toBe(false);
  });

  it("normalizes unsupported compact-list options to safe defaults", async () => {
    // Break caught: callers can accidentally request an unbounded or unsupported compact query.
    resetDb({ order_summary_rows: [] });
    const { listWorkspaceOrderSummaries } = await import("../../api/_lib/orders-store.js");

    await expect(listWorkspaceOrderSummaries({
      workspaceId: "workspace-1",
      activeBatchId: " ",
      statusFilter: "unknown",
      batchFilter: "unknown",
      searchTerm: null,
      limit: 500,
      cursor: null,
    })).resolves.toEqual({ orders: [], nextCursorValues: null, hasMore: false });

    expect(supabaseMock.calls[0].args).toEqual({
      p_workspace_id: "workspace-1",
      p_active_batch_id: null,
      p_status_filter: "open",
      p_batch_filter: "all",
      p_search_term: "",
      p_requested_limit: 50,
      p_cursor_sort_key: null,
      p_cursor_group_id: null,
    });
  });

  it("loads one complete order detail including editor lines and saved build data", async () => {
    resetDb({
      order_items: [{ id: "item-1", workspace_id: "workspace-1", status: "open", order_number: "1001", quantity: 1, source_json: {} }],
      designs: [{
        id: "design-1", workspace_id: "workspace-1", order_item_id: "item-1", design_text: "Ada",
        cached_build_json: { geometry: "saved" }, previous_completed_build_json: { geometry: "previous" },
      }],
      design_lines: [{ design_id: "design-1", line_index: 0, text: "Ada", font_id: "skywalk" }],
    });
    const { getWorkspaceOrderDetail } = await import("../../api/_lib/orders-store.js");

    const result = await getWorkspaceOrderDetail({ workspaceId: "workspace-1", orderId: "order:1001" });

    expect(result.order.items[0].design).toMatchObject({
      text: "Ada",
      cachedBuild: { geometry: "saved" },
      previousCompletedBuild: { geometry: "previous" },
      lines: [{ text: "Ada", fontId: "skywalk" }],
    });
  });

  it("returns a safe empty detail result for missing and malformed order ids", async () => {
    resetDb({ order_items: [{ id: "item-1", workspace_id: "workspace-1", status: "open", order_number: "1001", quantity: 1, source_json: {} }] });
    const { getWorkspaceOrderDetail } = await import("../../api/_lib/orders-store.js");

    await expect(getWorkspaceOrderDetail({ workspaceId: "workspace-1", orderId: "order:missing" })).resolves.toEqual({ order: null });
    await expect(getWorkspaceOrderDetail({ workspaceId: "workspace-1", orderId: "invalid" })).resolves.toEqual({ order: null });
  });

  it("exposes generic import payload builders without persistence-only IDs", async () => {
    const {
      buildImportedDesignLineRows,
      buildImportedDesignRow,
      buildImportedOrderItemRow,
    } = await import("../../api/_lib/orders-store.js");
    const item = {
      id: "amazon-order-item:1",
      text: "Ada\nRN",
      source: { orderNumber: "1001", quantity: "2" },
      settings: {
        lines: [
          { fontId: "skywalk" },
          { fontId: "somekind" },
        ],
      },
    };
    const context = { workspaceId: "workspace-1", userId: "user-1" };

    expect(buildImportedOrderItemRow(item, context)).toMatchObject({
      id: "amazon-order-item:1",
      workspace_id: "workspace-1",
      order_number: "1001",
      quantity: 2,
      updated_by: "user-1",
    });
    expect(buildImportedDesignRow(item, context)).toMatchObject({
      workspace_id: "workspace-1",
      order_item_id: "amazon-order-item:1",
      design_text: "Ada\nRN",
      updated_by: "user-1",
    });
    expect(buildImportedDesignLineRows(item)).toEqual([
      expect.objectContaining({ line_index: 0, text: "Ada", font_id: "skywalk" }),
      expect.objectContaining({ line_index: 1, text: "RN", font_id: "somekind" }),
    ]);
    expect(buildImportedDesignLineRows(item)[0]).not.toHaveProperty("design_id");
  });

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
          amazon_customization_json: { private: "raw Amazon document" },
          source_json: { listingTitle: "Badge Reel" },
          revision: 1,
          updated_at: "2026-06-01T10:00:00.000Z",
          updated_by: "user-1",
        },
        {
          ship_by_date: "2026-07-06",
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
          status: "completed",
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
      shipByDate: "2026-07-06",
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
    expect(result.orders[0].items[0]).not.toHaveProperty("amazonCustomizationJson");
    expect(result.orders[0].items[0]).not.toHaveProperty("amazon_customization_json");
    const orderItemsSelect = supabaseMock.calls.find(
      (call) => call.table === "order_items" && call.operation === "select",
    );
    expect(orderItemsSelect.columns).not.toContain("amazon_customization_json");
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

  it("defaults to open workspace orders and can include complete orders on request", async () => {
    resetDb({
      order_items: [
        {
          id: "item-open",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "2001",
          buyer_name: "Ada",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-complete",
          workspace_id: "workspace-1",
          status: "complete",
          order_number: "2002",
          buyer_name: "Grace",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-skipped",
          workspace_id: "workspace-1",
          status: "skipped",
          order_number: "2003",
          buyer_name: "Katherine",
          source_json: {},
          quantity: 1,
        },
      ],
    });
    const { listWorkspaceOrders } = await import("../../api/_lib/orders-store.js");

    await expect(listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
    })).resolves.toMatchObject({
      orders: [{ id: "order:2001" }],
    });

    await expect(listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "complete",
    })).resolves.toMatchObject({
      orders: [{ id: "order:2002" }],
    });

    await expect(listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "skipped",
    })).resolves.toMatchObject({
      orders: [{ id: "order:2003", status: "skipped" }],
    });

    const allResult = await listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "all",
    });

    expect(allResult.orders.map((order) => order.id)).toEqual(["order:2001", "order:2002", "order:2003"]);
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
  it("returns private per-item persistence audit only when explicitly requested", async () => {
    resetDb({
      order_items: [{
        id: "transaction:existing", workspace_id: "workspace-1", status: "complete", order_number: "2001",
        buyer_name: "Ada", listing_id: "listing-old", transaction_id: "existing", imported_color: "Pink",
        ship_by_date: null, quantity: 1, source_json: { persisted: "before" }, revision: 4, updated_by: "user-old",
      }],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");
    const items = [
      { text: "Existing", source: { orderNumber: "2001", transactionId: "existing", buyerName: "Ada" } },
      { text: "New", source: { orderNumber: "2002", transactionId: "new", buyerName: "Bea" } },
    ];

    const privateResult = await importWorkspaceOrderItems({ workspaceId: "workspace-1", userId: "user-1", items, includePersistenceAudit: true });

    expect(privateResult.persistenceAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderItemId: "transaction:existing", importDecision: "existing", storedBefore: expect.objectContaining({ status: "complete", source_json: { persisted: "before" } }), storedAfter: expect.objectContaining({ status: "complete" }) }),
      expect.objectContaining({ orderItemId: "transaction:new", importDecision: "new", storedBefore: null, storedAfter: expect.objectContaining({ order_number: "2002", transaction_id: "new" }) }),
    ]));

    resetDb();
    const normalResult = await importWorkspaceOrderItems({ workspaceId: "workspace-1", userId: "user-1", items: [{ text: "Normal", source: { transactionId: "normal" } }] });
    expect(normalResult).not.toHaveProperty("persistenceAudit");
  });
  it("preserves Etsy customization metadata through persistence and response mapping", async () => {
    resetDb();
    const { importWorkspaceOrderItems, listWorkspaceOrders } = await import("../../api/_lib/orders-store.js");
    const source = {
      orderNumber: "2050",
      transactionId: "txn-customization",
      buyerName: "Ada",
      customizationNeeded: true,
      personalizationResponses: [
        { kind: "text", label: "Name", value: "Ada" },
        { kind: "selection", label: "Color", value: "Teal" },
      ],
    };

    await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
      batchId: null,
      items: [{ text: "Ada", source }],
    });

    const orderItemsUpsert = supabaseMock.calls.find(
      (call) => call.table === "order_items" && call.operation === "upsert",
    );
    expect(orderItemsUpsert.payload[0].source_json).toEqual(source);

    const result = await listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: null,
      statusFilter: "all",
    });
    const mappedSource = result.orders[0].items[0].source;
    expect(mappedSource).toEqual(source);
    expect(mappedSource.customizationNeeded).toBe(true);
    expect(mappedSource.personalizationResponses).toEqual(source.personalizationResponses);
  });


  it("persists fixed SVG line items from imported order settings", async () => {
    resetDb();
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
      items: [
        {
          text: "Morgan\nRN",
          source: { orderNumber: "2101", transactionId: "txn-mixed", buyerName: "Ada" },
          settings: {
            lines: [
              { kind: "text", fontId: "skywalk", fontSizeMm: 30 },
              {
                kind: "fixedSvg",
                fixedDesignId: "nurse-cross",
                fixedDesignVersion: 3,
                svgSizeMm: 38,
                offsetXMm: 2,
                offsetYMm: -7,
              },
              { kind: "text", fontId: "somekind", fontSizeMm: 23 },
            ],
          },
        },
      ],
    });

    const lineUpsert = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "upsert");
    expect(lineUpsert.payload).toEqual([
      expect.objectContaining({
        design_id: "design-transaction:txn-mixed",
        line_index: 0,
        item_kind: "text",
        text: "Morgan",
        font_id: "skywalk",
        fixed_design_id: null,
        fixed_design_version: null,
      }),
      expect.objectContaining({
        design_id: "design-transaction:txn-mixed",
        line_index: 1,
        item_kind: "fixed_svg",
        text: "",
        fixed_design_id: "nurse-cross",
        fixed_design_version: 3,
        svg_size_mm: 38,
        offset_x_mm: 2,
        offset_y_mm: -7,
      }),
      expect.objectContaining({
        design_id: "design-transaction:txn-mixed",
        line_index: 2,
        item_kind: "text",
        text: "RN",
        font_id: "somekind",
        text_height_mm: 23,
        fixed_design_id: null,
        fixed_design_version: null,
      }),
    ]);
  });

  it("adds existing database order items to a production batch without counting them as imports", async () => {
    resetDb({
      order_items: [{
        id: "transaction:txn-existing-order",
        workspace_id: "workspace-1",
        status: "open",
        order_number: "2501",
        buyer_name: "Ada",
        transaction_id: "txn-existing-order",
        source_json: { orderNumber: "2501", transactionId: "txn-existing-order", buyerName: "Ada" },
        quantity: 1,
      }],
      designs: [{
        id: "design-existing-order",
        workspace_id: "workspace-1",
        order_item_id: "transaction:txn-existing-order",
        design_text: "Existing",
        production_status: "draft",
      }],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "productionBatch",
      batchId: "batch-1",
      items: [{
        text: "Existing overwrite",
        source: { orderNumber: "2501", transactionId: "txn-existing-order", buyerName: "Ada" },
      }],
    });

    const orderItemsUpsert = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "upsert");
    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(orderItemsUpsert).toBeUndefined();
    expect(batchItemsUpsert.payload).toEqual([expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "transaction:txn-existing-order",
      batch_position: 0,
      status: "active",
    })]);
    expect(result).toMatchObject({
      importedCount: 0,
      importedOrderItemIds: [],
      addedToBatchCount: 1,
      addedOrderItemIds: ["transaction:txn-existing-order"],
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
      status: "open",
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

  it("skips existing database order items on paste without reopening complete duplicates", async () => {
    resetDb({
      order_items: [
        {
          id: "transaction:txn-complete-duplicate",
          workspace_id: "workspace-1",
          status: "complete",
          order_number: "3201",
          buyer_name: "Ada",
          transaction_id: "txn-complete-duplicate",
          source_json: { orderNumber: "3201", transactionId: "txn-complete-duplicate", buyerName: "Ada" },
          quantity: 1,
        },
        {
          id: "transaction:txn-open-duplicate",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "3202",
          buyer_name: "Grace",
          transaction_id: "txn-open-duplicate",
          source_json: { orderNumber: "3202", transactionId: "txn-open-duplicate", buyerName: "Grace" },
          quantity: 1,
        },
      ],
      designs: [
        {
          id: "design-complete-duplicate",
          workspace_id: "workspace-1",
          order_item_id: "transaction:txn-complete-duplicate",
          design_text: "Complete",
          production_status: "saved",
        },
        {
          id: "design-open-duplicate",
          workspace_id: "workspace-1",
          order_item_id: "transaction:txn-open-duplicate",
          design_text: "Open",
          production_status: "draft",
        },
      ],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
      items: [
        {
          text: "Complete overwrite",
          source: { orderNumber: "3201", transactionId: "txn-complete-duplicate", buyerName: "Ada", shipByDate: "2026-07-08" },
        },
        {
          text: "Open overwrite",
          source: { orderNumber: "3202", transactionId: "txn-open-duplicate", buyerName: "Grace", shipByDate: "2026-07-09" },
        },
        {
          text: "New",
          source: { orderNumber: "3203", transactionId: "txn-new-import", buyerName: "Katherine" },
        },
      ],
    });

    const orderItemsUpsert = supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "upsert");
    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");

    expect(orderItemsUpsert.payload).toEqual([
      expect.objectContaining({ id: "transaction:txn-new-import", status: "open" }),
    ]);
    expect(designsUpsert.payload).toEqual([
      expect.objectContaining({ order_item_id: "transaction:txn-new-import", design_text: "New" }),
    ]);
    expect(supabaseMock.db.order_items.find((item) => item.id === "transaction:txn-complete-duplicate").status).toBe("complete");
    expect(supabaseMock.db.order_items.find((item) => item.id === "transaction:txn-complete-duplicate").ship_by_date).toBe("2026-07-08");
    expect(supabaseMock.db.order_items.find((item) => item.id === "transaction:txn-open-duplicate").ship_by_date).toBe("2026-07-09");
    expect(supabaseMock.db.designs.find((design) => design.order_item_id === "transaction:txn-open-duplicate").design_text).toBe("Open");
    expect(result).toMatchObject({
      importedCount: 1,
      importedOrderItemIds: ["transaction:txn-new-import"],
    });
    expect(result.orders.map((order) => order.id)).toEqual(["order:3202", "order:3203"]);
  });

  it("merges an Etsy expected ship date into a duplicate item's source metadata", async () => {
    const cachedBuild = { signature: "saved-signature", layout: { text: "Saved" } };
    resetDb({
      order_items: [{
        id: "transaction:txn-ship-date",
        workspace_id: "workspace-1",
        status: "complete",
        order_number: "3401",
        buyer_name: "Ada",
        transaction_id: "txn-ship-date",
        ship_by_date: "2026-07-06",
        source_json: {
          orderNumber: "3401",
          transactionId: "txn-ship-date",
          listingTitle: "Existing badge reel",
          expected_ship_date: 1783400340,
        },
        quantity: 1,
      }],
      designs: [{
        id: "design-transaction:txn-ship-date",
        workspace_id: "workspace-1",
        order_item_id: "transaction:txn-ship-date",
        design_text: "Saved",
        production_status: "saved",
        cached_build_json: cachedBuild,
      }],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      items: [{
        text: "Do not overwrite",
        source: {
          orderNumber: "3401",
          transactionId: "txn-ship-date",
          buyerName: "Ada",
          expected_ship_date: null,
          shipByDate: "2026-07-08",
        },
      }],
    });

    const existingItem = supabaseMock.db.order_items.find((item) => item.id === "transaction:txn-ship-date");
    const existingDesign = supabaseMock.db.designs.find((design) => design.order_item_id === "transaction:txn-ship-date");

    expect(existingItem).toMatchObject({
      status: "complete",
      ship_by_date: "2026-07-08",
      source_json: {
        orderNumber: "3401",
        transactionId: "txn-ship-date",
        listingTitle: "Existing badge reel",
        expected_ship_date: null,
      },
    });
    expect(existingDesign).toMatchObject({ design_text: "Saved", cached_build_json: cachedBuild });
  });

  it("does not replace existing draft design lines when a duplicate item is pasted", async () => {
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

    const designUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");
    const designLinesDelete = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "delete");
    const designLinesUpsert = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "upsert");
    const importedItem = result.orders[0].items[0];

    expect(designUpsert).toBeUndefined();
    expect(designLinesDelete).toBeUndefined();
    expect(designLinesUpsert).toBeUndefined();
    expect(result.importedCount).toBe(0);
    expect(importedItem.design.lines).toEqual([
      expect.objectContaining({ lineIndex: 0, text: "Name", fontId: "skywalk" }),
      expect.objectContaining({ lineIndex: 1, text: "RN", fontId: "somekind" }),
    ]);
  });

  it("does not overwrite saved design geometry when duplicate imported items are re-imported", async () => {
    const cachedBuild = {
      signature: "saved-signature",
      layout: { text: "Saved", lines: [{ text: "Saved" }] },
      analysis: { connectedComponents: 1 },
    };
    resetDb({
      order_items: [{
        id: "transaction:txn-saved",
        workspace_id: "workspace-1",
        status: "active",
        order_number: "3601",
        buyer_name: "Ada",
        transaction_id: "txn-saved",
        source_json: { orderNumber: "3601", transactionId: "txn-saved", buyerName: "Ada" },
        quantity: 1,
      }],
      designs: [{
        id: "design-transaction:txn-saved",
        workspace_id: "workspace-1",
        order_item_id: "transaction:txn-saved",
        design_text: "Saved",
        preset_id: "skywalk",
        production_status: "saved",
        cached_build_json: cachedBuild,
        previous_completed_build_json: null,
        saved_settings_signature: "saved-signature",
        completed_settings_signature: "saved-signature",
        analysis_badge_json: { state: "complete", connectedComponentCount: 1 },
      }],
      design_lines: [
        { design_id: "design-transaction:txn-saved", line_index: 0, text: "Saved", font_id: "skywalk" },
      ],
    });
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");

    const result = await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      items: [{
        text: "Draft overwrite",
        presetId: "somekind",
        source: { orderNumber: "3601", transactionId: "txn-saved", buyerName: "Ada" },
        settings: { lines: [{ fontId: "somekind" }] },
      }],
    });

    const designsUpsert = supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert");
    const designLinesDelete = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "delete");
    const designLinesUpsert = supabaseMock.calls.find((call) => call.table === "design_lines" && call.operation === "upsert");
    const importedItem = result.orders[0].items[0];

    expect(designsUpsert).toBeUndefined();
    expect(designLinesDelete).toBeUndefined();
    expect(designLinesUpsert).toBeUndefined();
    expect(importedItem.design).toMatchObject({
      text: "Saved",
      productionStatus: "saved",
      cachedBuild,
      savedSettingsSignature: "saved-signature",
      completedSettingsSignature: "saved-signature",
      lines: [{ lineIndex: 0, text: "Saved", fontId: "skywalk" }],
    });
  });

  it("returns copyable saved build fields when listing workspace orders", async () => {
    const cachedBuild = {
      signature: "copyable-signature",
      layout: { text: "Ada", lines: [{ text: "Ada" }] },
      analysis: { connectedComponents: 1 },
    };
    resetDb({
      order_items: [{
        id: "item-copyable",
        workspace_id: "workspace-1",
        status: "active",
        order_number: "3701",
        buyer_name: "Ada",
        source_json: {},
        quantity: 1,
      }],
      designs: [{
        id: "design-copyable",
        workspace_id: "workspace-1",
        order_item_id: "item-copyable",
        design_text: "Ada",
        production_status: "export_ready",
        cached_build_json: cachedBuild,
        previous_completed_build_json: { signature: "previous", layout: {}, analysis: {} },
        saved_settings_signature: "copyable-signature",
        completed_settings_signature: "copyable-signature",
        analysis_badge_json: { state: "complete", connectedComponentCount: 1 },
      }],
      design_lines: [
        { design_id: "design-copyable", line_index: 0, text: "Ada", font_id: "skywalk" },
      ],
    });
    const { listWorkspaceOrders } = await import("../../api/_lib/orders-store.js");

    const result = await listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
    });

    expect(result.orders[0].items[0].design).toMatchObject({
      cachedBuild,
      previousCompletedBuild: { signature: "previous", layout: {}, analysis: {} },
      savedSettingsSignature: "copyable-signature",
      completedSettingsSignature: "copyable-signature",
      analysisBadge: { state: "complete", connectedComponentCount: 1 },
    });
  });

  it("adds every item in a grouped order to a production batch", async () => {
    resetDb({
      order_items: [
        {
          id: "item-1",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "4001",
          buyer_name: "Ada",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-2",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "4001",
          buyer_name: "Ada",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-3",
          workspace_id: "workspace-1",
          status: "open",
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

  it("allows direct batch item additions for open, complete, and skipped order items in the workspace", async () => {
    resetDb({
      order_items: [
        {
          id: "item-valid",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "5001",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-other-workspace",
          workspace_id: "workspace-2",
          status: "open",
          order_number: "5002",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-complete",
          workspace_id: "workspace-1",
          status: "complete",
          order_number: "5003",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-skipped",
          workspace_id: "workspace-1",
          status: "skipped",
          order_number: "5004",
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
      orderItemIds: ["item-valid", "item-other-workspace", "item-complete", "item-skipped", "item-missing"],
    });

    const batchItemsUpsert = supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert");

    expect(result).toEqual({ addedOrderItemIds: ["item-valid", "item-complete", "item-skipped"] });
    expect(supabaseMock.db.order_items.find((item) => item.id === "item-skipped")).toMatchObject({
      status: "open",
      updated_by: "user-1",
    });
    expect(batchItemsUpsert.payload).toEqual([expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "item-valid",
      batch_position: 0,
      status: "active",
      added_by: "user-1",
    }), expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "item-complete",
      batch_position: 1,
      status: "active",
      added_by: "user-1",
    }), expect.objectContaining({
      workspace_id: "workspace-1",
      batch_id: "batch-1",
      order_item_id: "item-skipped",
      batch_position: 2,
      status: "active",
      added_by: "user-1",
    })]);
  });

  it("adds skipped order groups to production and reopens their items", async () => {
    resetDb({
      order_items: [
        {
          id: "item-skipped",
          workspace_id: "workspace-1",
          status: "skipped",
          order_number: "5005",
          source_json: {},
          quantity: 1,
        },
      ],
    });
    const { addOrderGroupsToProductionBatch } = await import("../../api/_lib/orders-store.js");

    const result = await addOrderGroupsToProductionBatch({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderIds: ["order:5005"],
    });

    expect(result).toEqual({ addedOrderItemIds: ["item-skipped"] });
    expect(supabaseMock.db.order_items[0]).toMatchObject({
      status: "open",
      updated_by: "user-1",
    });
  });

  it("marks an order item skipped and removes it from batch memberships", async () => {
    resetDb({
      production_batches: [
        {
          id: "batch-1",
          workspace_id: "workspace-1",
          active_order_item_id: "item-skip",
        },
      ],
      order_items: [
        {
          id: "item-skip",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "6001",
          source_json: {},
          quantity: 1,
        },
      ],
      batch_items: [
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-skip",
          batch_position: 0,
          status: "active",
        },
      ],
    });
    const { updateOrderItemStatus } = await import("../../api/_lib/orders-store.js");

    const result = await updateOrderItemStatus({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderItemId: "item-skip",
      status: "skipped",
    });

    expect(result).toEqual({ orderItemId: "item-skip", status: "skipped" });
    expect(supabaseMock.db.order_items[0]).toMatchObject({
      id: "item-skip",
      status: "skipped",
      updated_by: "user-1",
    });
    expect(supabaseMock.db.production_batches[0]).toMatchObject({
      id: "batch-1",
      active_order_item_id: null,
      updated_by: "user-1",
    });
    expect(supabaseMock.db.batch_items).toEqual([]);
  });

  it("marks every item in an order skipped and removes their batch memberships", async () => {
    resetDb({
      production_batches: [
        {
          id: "batch-1",
          workspace_id: "workspace-1",
          active_order_item_id: "item-skip-2",
        },
      ],
      order_items: [
        {
          id: "item-skip-1",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "7001",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-skip-2",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "7001",
          source_json: {},
          quantity: 1,
        },
        {
          id: "item-other-order",
          workspace_id: "workspace-1",
          status: "open",
          order_number: "7002",
          source_json: {},
          quantity: 1,
        },
      ],
      batch_items: [
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-skip-1",
          batch_position: 0,
          status: "active",
        },
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-skip-2",
          batch_position: 1,
          status: "active",
        },
        {
          workspace_id: "workspace-1",
          batch_id: "batch-1",
          order_item_id: "item-other-order",
          batch_position: 2,
          status: "active",
        },
      ],
    });
    const { updateOrderGroupStatus } = await import("../../api/_lib/orders-store.js");

    const result = await updateOrderGroupStatus({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderId: "order:7001",
      status: "skipped",
    });

    expect(result).toEqual({ orderItemIds: ["item-skip-1", "item-skip-2"], status: "skipped" });
    expect(supabaseMock.db.order_items.filter((item) => item.order_number === "7001")).toEqual([
      expect.objectContaining({ id: "item-skip-1", status: "skipped", updated_by: "user-1" }),
      expect.objectContaining({ id: "item-skip-2", status: "skipped", updated_by: "user-1" }),
    ]);
    expect(supabaseMock.db.production_batches[0]).toMatchObject({
      id: "batch-1",
      active_order_item_id: null,
      updated_by: "user-1",
    });
    expect(supabaseMock.db.batch_items).toEqual([
      expect.objectContaining({ order_item_id: "item-other-order" }),
    ]);
    expect(supabaseMock.calls.filter((call) => (
      call.operation === "select"
      && ["designs", "design_lines"].includes(call.table)
    ))).toEqual([]);
  });

  it("marks items in multiple orders skipped and removes their batch memberships", async () => {
    resetDb({
      production_batches: [
        {
          id: "batch-1",
          workspace_id: "workspace-1",
          active_order_item_id: "item-b",
        },
      ],
      order_items: [
        { id: "item-a", workspace_id: "workspace-1", status: "open", order_number: "8001", source_json: {}, quantity: 1 },
        { id: "item-b", workspace_id: "workspace-1", status: "open", order_number: "8002", source_json: {}, quantity: 1 },
        { id: "item-c", workspace_id: "workspace-1", status: "open", order_number: "8003", source_json: {}, quantity: 1 },
      ],
      batch_items: [
        { workspace_id: "workspace-1", batch_id: "batch-1", order_item_id: "item-a", batch_position: 0, status: "active" },
        { workspace_id: "workspace-1", batch_id: "batch-1", order_item_id: "item-b", batch_position: 1, status: "active" },
        { workspace_id: "workspace-1", batch_id: "batch-1", order_item_id: "item-c", batch_position: 2, status: "active" },
      ],
    });
    const { updateOrderGroupsStatus } = await import("../../api/_lib/orders-store.js");

    const result = await updateOrderGroupsStatus({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderIds: ["order:8001", "order:8002"],
      status: "skipped",
    });

    expect(result).toEqual({ orderItemIds: ["item-a", "item-b"], status: "skipped" });
    expect(supabaseMock.calls.filter((call) => call.operation === "select").map((call) => call.table)).toEqual(["order_items"]);
    expect(supabaseMock.db.order_items).toEqual([
      expect.objectContaining({ id: "item-a", status: "skipped" }),
      expect.objectContaining({ id: "item-b", status: "skipped" }),
      expect.objectContaining({ id: "item-c", status: "open" }),
    ]);
    expect(supabaseMock.db.production_batches[0]).toMatchObject({
      id: "batch-1",
      active_order_item_id: null,
      updated_by: "user-1",
    });
    expect(supabaseMock.db.batch_items).toEqual([
      expect.objectContaining({ order_item_id: "item-c" }),
    ]);
  });
});
