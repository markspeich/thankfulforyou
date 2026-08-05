import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addOrderGroupsToProductionBatchMock = vi.fn();
const addOrderItemsToProductionBatchMock = vi.fn();
const importWorkspaceOrderItemsMock = vi.fn();
const getWorkspaceOrderDetailMock = vi.fn();
const listWorkspaceOrderSummariesMock = vi.fn();
const listWorkspaceOrdersMock = vi.fn();
const updateOrderGroupStatusMock = vi.fn();
const updateOrderGroupsStatusMock = vi.fn();
const updateOrderItemStatusMock = vi.fn();
const resolveProductionBatchAuthMock = vi.fn();

vi.mock("../../api/_lib/orders-store.js", () => ({
  addOrderGroupsToProductionBatch: addOrderGroupsToProductionBatchMock,
  addOrderItemsToProductionBatch: addOrderItemsToProductionBatchMock,
  importWorkspaceOrderItems: importWorkspaceOrderItemsMock,
  getWorkspaceOrderDetail: getWorkspaceOrderDetailMock,
  listWorkspaceOrderSummaries: listWorkspaceOrderSummariesMock,
  listWorkspaceOrders: listWorkspaceOrdersMock,
  updateOrderGroupStatus: updateOrderGroupStatusMock,
  updateOrderGroupsStatus: updateOrderGroupsStatusMock,
  updateOrderItemStatus: updateOrderItemStatusMock,
}));

vi.mock("../../api/_lib/production-batch-auth.js", () => ({
  resolveProductionBatchAuth: resolveProductionBatchAuthMock,
}));

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

beforeEach(() => {
  vi.resetModules();
  addOrderGroupsToProductionBatchMock.mockReset();
  addOrderItemsToProductionBatchMock.mockReset();
  importWorkspaceOrderItemsMock.mockReset();
  getWorkspaceOrderDetailMock.mockReset();
  listWorkspaceOrderSummariesMock.mockReset();
  listWorkspaceOrdersMock.mockReset();
  updateOrderGroupStatusMock.mockReset();
  updateOrderGroupsStatusMock.mockReset();
  updateOrderItemStatusMock.mockReset();
  resolveProductionBatchAuthMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("orders api route", () => {
  it("passes validated compact pagination parameters to the summaries store", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    listWorkspaceOrderSummariesMock.mockResolvedValue({
      orders: [{ id: "order:1001", items: [{ id: "item-1", designText: "Ada\nRN" }] }],
      nextCursor: null,
      hasMore: false,
    });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: {
        view: "compact",
        batchId: " batch-1 ",
        status: " all ",
        batch: " notInBatch ",
        search: " 4118855809 ",
        limit: "50",
        cursor: encodeCursor({ version: 1, sortKey: "2026-08-05T00:00:00.000Z", groupId: "order:1001" }),
      },
    }, response);

    expect(listWorkspaceOrderSummariesMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "all",
      batchFilter: "notInBatch",
      searchTerm: "4118855809",
      limit: 50,
      cursor: { version: 1, sortKey: "2026-08-05T00:00:00.000Z", groupId: "order:1001" },
    });
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0].items[0]).toEqual({ id: "item-1", designText: "Ada\nRN" });
  });

  it("uses compact pagination defaults", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    listWorkspaceOrderSummariesMock.mockResolvedValue({ orders: [], nextCursor: null, hasMore: false });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", headers: {}, query: { view: "compact" } }, response);

    expect(listWorkspaceOrderSummariesMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: null,
      statusFilter: "open",
      batchFilter: "all",
      searchTerm: "",
      limit: 50,
      cursor: null,
    });
    expect(response.body).toEqual({ orders: [], nextCursor: null, hasMore: false });
  });

  it.each([
    ["a malformed cursor", { cursor: "not-base64url" }],
    ["a cursor with unexpected fields", { cursor: encodeCursor({ version: 1, sortKey: "2026-08-05", groupId: "order:1001", extra: true }) }],
    ["limit zero", { limit: "0" }],
    ["a limit above 50", { limit: "51" }],
    ["an unknown status", { status: "pending" }],
    ["an unknown batch filter", { batch: "archived" }],
  ])("rejects compact requests with %s before loading the store", async (_label, invalidQuery) => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", headers: {}, query: { view: "compact", ...invalidQuery } }, response);

    expect(response.statusCode).toBe(400);
    expect(listWorkspaceOrderSummariesMock).not.toHaveBeenCalled();
  });

  it("returns one complete order through the additive detail contract", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    getWorkspaceOrderDetailMock.mockResolvedValue({
      order: { id: "order:1001", items: [{ id: "item-1", design: { lines: [{ text: "Ada" }] } }] },
    });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { view: "detail", orderId: " order:1001 ", batchId: "batch-1" },
    }, response);

    expect(getWorkspaceOrderDetailMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      orderId: "order:1001",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.order.items[0].design.lines).toEqual([{ text: "Ada" }]);
  });

  it("returns 404 when the requested detail order does not exist", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    getWorkspaceOrderDetailMock.mockResolvedValue({ order: null });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", headers: {}, query: { view: "detail", orderId: "item:missing" } }, response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: "Order not found." });
  });

  it("returns workspace orders for an authenticated GET request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: " batch-1 " },
    }, response);

    expect(resolveProductionBatchAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: " batch-1 " },
    }));
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "open",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });
  });

  it("loads skipped workspace orders when requested", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1003", status: "skipped", items: [{ id: "item-3", status: "skipped" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: "batch-1", status: "skipped" },
    }, response);

    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "skipped",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0]).toMatchObject({ status: "skipped" });
  });

  it("imports clipboard items to workspace orders and returns counts with refreshed orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    importWorkspaceOrderItemsMock.mockResolvedValue({
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
      importedOrderItemIds: ["item-1"],
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();
    const items = [{ id: "item-1", text: "Mark" }];

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "importClipboardItems",
        target: " orders ",
        items,
      },
    }, response);

    expect(importWorkspaceOrderItemsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      items,
      target: "orders",
      batchId: null,
    });
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 1,
      addedOrderItemCount: 0,
      skippedOrderItemCount: 0,
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });
  });

  it("reports skipped duplicate clipboard items from import counts", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    importWorkspaceOrderItemsMock.mockResolvedValue({
      importedCount: 1,
      importedOrderItemIds: ["item-3"],
      addedToBatchCount: 0,
    });
    listWorkspaceOrdersMock.mockResolvedValue({ orders: [] });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "importClipboardItems",
        target: "orders",
        items: [
          { id: "item-1", text: "Duplicate" },
          { id: "item-2", text: "Duplicate" },
          { id: "item-3", text: "New" },
        ],
      },
    }, response);

    expect(response.body).toEqual({
      importedOrderItemCount: 1,
      addedOrderItemCount: 0,
      skippedOrderItemCount: 2,
      orders: [],
    });
  });

  it("uses batch id as membership context when importing clipboard items to workspace orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    importWorkspaceOrderItemsMock.mockResolvedValue({
      importedCount: 0,
      addedToBatchCount: 0,
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1", isInActiveBatch: true }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();
    const items = [{ id: "item-1", text: "Mark" }];

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "importClipboardItems",
        target: "orders",
        batchId: " batch-1 ",
        items,
      },
    }, response);

    expect(importWorkspaceOrderItemsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      items,
      target: "orders",
      batchId: "batch-1",
    });
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "open",
    });
    expect(response.body).toEqual({
      importedOrderItemCount: 0,
      addedOrderItemCount: 0,
      skippedOrderItemCount: 1,
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1", isInActiveBatch: true }] }],
    });
  });

  it("passes complete status filters to the orders store", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1002", items: [{ id: "item-2", status: "complete" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: "batch-1", status: " complete " },
    }, response);

    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "complete",
    });
    expect(response.statusCode).toBe(200);
  });

  it("returns the store's production batch add count when importing clipboard items to a batch", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    importWorkspaceOrderItemsMock.mockResolvedValue({
      importedCount: 3,
      addedToBatchCount: 1,
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();
    const items = [
      { id: "item-1", text: "Mark" },
      { id: "item-2", text: "Sam" },
      { id: "item-3", text: "Lee" },
    ];

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "importClipboardItems",
        target: "productionBatch",
        batchId: "batch-1",
        items,
      },
    }, response);

    expect(importWorkspaceOrderItemsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      items,
      target: "productionBatch",
      batchId: "batch-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 3,
      addedOrderItemCount: 1,
      skippedOrderItemCount: 0,
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
    });
  });

  it("adds one order item to a production batch and returns a compact delta", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    addOrderItemsToProductionBatchMock.mockResolvedValue({
      addedOrderItemIds: ["item-1"],
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      addedOrderItemIds: ["item-1"],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "addOrderItemToProductionBatch",
        batchId: " batch-1 ",
        orderItemId: " item-1 ",
        statusFilter: " complete ",
      },
    }, response);

    expect(addOrderItemsToProductionBatchMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderItemIds: ["item-1"],
    });
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 0,
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    });
  });

  it("adds grouped orders to a production batch and returns a compact delta", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    addOrderGroupsToProductionBatchMock.mockResolvedValue({
      addedOrderItemIds: ["item-1", "item-2"],
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      addedOrderItemIds: ["item-1", "item-2"],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "addOrdersToProductionBatch",
        batchId: " batch-1 ",
        orderIds: [" order:1001 ", "", "order:1002"],
      },
    }, response);

    expect(addOrderGroupsToProductionBatchMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderIds: ["order:1001", "order:1002"],
    });
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 0,
      addedOrderItemCount: 2,
      addedOrderItemIds: ["item-1", "item-2"],
    });
  });

  it("marks an order item skipped and returns refreshed skipped orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    updateOrderItemStatusMock.mockResolvedValue({ orderItemId: "item-1", status: "skipped" });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", status: "skipped", items: [{ id: "item-1", status: "skipped" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "skipOrderItem",
        batchId: " batch-1 ",
        orderItemId: " item-1 ",
      },
    }, response);

    expect(updateOrderItemStatusMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderItemId: "item-1",
      status: "skipped",
    });
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "skipped",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0]).toMatchObject({ status: "skipped" });
  });

  it("reopens a skipped order item and returns refreshed open orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    updateOrderItemStatusMock.mockResolvedValue({ orderItemId: "item-1", status: "open" });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", status: "open", items: [{ id: "item-1", status: "open" }] }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "reopenOrderItem",
        batchId: "batch-1",
        orderItemId: "item-1",
      },
    }, response);

    expect(updateOrderItemStatusMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderItemId: "item-1",
      status: "open",
    });
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "open",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0]).toMatchObject({ status: "open" });
  });

  it("marks every item in an order skipped and returns refreshed skipped orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    updateOrderGroupStatusMock.mockResolvedValue({ orderItemIds: ["item-1", "item-2"], status: "skipped" });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{
        id: "order:1001",
        status: "skipped",
        items: [{ id: "item-1", status: "skipped" }, { id: "item-2", status: "skipped" }],
      }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "skipOrder",
        batchId: "batch-1",
        orderId: " order:1001 ",
      },
    }, response);

    expect(updateOrderGroupStatusMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderId: "order:1001",
      status: "skipped",
    });
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "skipped",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0]).toMatchObject({ status: "skipped" });
  });

  it("reopens every skipped item in an order and returns refreshed open orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    updateOrderGroupStatusMock.mockResolvedValue({ orderItemIds: ["item-1", "item-2"], status: "open" });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{
        id: "order:1001",
        status: "open",
        items: [{ id: "item-1", status: "open" }, { id: "item-2", status: "open" }],
      }],
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "reopenOrder",
        batchId: "batch-1",
        orderId: "order:1001",
      },
    }, response);

    expect(updateOrderGroupStatusMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderId: "order:1001",
      status: "open",
    });
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
      statusFilter: "open",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.orders[0]).toMatchObject({ status: "open" });
  });

  it("marks checked orders skipped and returns a compact mutation result", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    updateOrderGroupsStatusMock.mockResolvedValue({ orderItemIds: ["item-1", "item-2"], status: "skipped" });
    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "skipOrders",
        batchId: "batch-1",
        orderIds: [" order:1001 ", "", "order:1002"],
      },
    }, response);

    expect(updateOrderGroupsStatusMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      orderIds: ["order:1001", "order:1002"],
      status: "skipped",
    });
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      orderItemIds: ["item-1", "item-2"],
      status: "skipped",
    });
  });

  it("rejects unsupported POST actions", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: { action: "deleteEverything" },
    }, response);

    expect(addOrderGroupsToProductionBatchMock).not.toHaveBeenCalled();
    expect(addOrderItemsToProductionBatchMock).not.toHaveBeenCalled();
    expect(importWorkspaceOrderItemsMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Unsupported orders action.",
    });
  });

  it("returns 405 with allowed methods for unsupported methods", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "DELETE",
      headers: { authorization: "Bearer token-1" },
    }, response);

    expect(response.statusCode).toBe(405);
    expect(response.headers).toMatchObject({ Allow: "GET, POST" });
    expect(response.body).toEqual({
      error: "Method not allowed.",
    });
  });

  it("returns exposed auth errors without loading orders", async () => {
    resolveProductionBatchAuthMock.mockRejectedValue(Object.assign(new Error("Shared workspace access denied."), {
      statusCode: 403,
      expose: true,
    }));

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
    }, response);

    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: "Shared workspace access denied.",
    });
  });

  it("rejects production batch imports without a batch id", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "importClipboardItems",
        target: "productionBatch",
        items: [{ id: "item-1", text: "Mark" }],
      },
    }, response);

    expect(importWorkspaceOrderItemsMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "batchId is required when importing to a production batch.",
    });
  });

  it("returns 400 for malformed JSON request bodies", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: "{ not-json",
    }, response);

    expect(importWorkspaceOrderItemsMock).not.toHaveBeenCalled();
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid JSON request body.",
    });
  });

  it("returns 400 for null JSON request bodies", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/orders.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: "null",
    }, response);

    expect(importWorkspaceOrderItemsMock).not.toHaveBeenCalled();
    expect(listWorkspaceOrdersMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Request body must be a JSON object.",
    });
  });
});

