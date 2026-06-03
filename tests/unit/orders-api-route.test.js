import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addOrderGroupsToProductionBatchMock = vi.fn();
const addOrderItemsToProductionBatchMock = vi.fn();
const importWorkspaceOrderItemsMock = vi.fn();
const listWorkspaceOrdersMock = vi.fn();
const resolveProductionBatchAuthMock = vi.fn();

vi.mock("../../api/_lib/orders-store.js", () => ({
  addOrderGroupsToProductionBatch: addOrderGroupsToProductionBatchMock,
  addOrderItemsToProductionBatch: addOrderItemsToProductionBatchMock,
  importWorkspaceOrderItems: importWorkspaceOrderItemsMock,
  listWorkspaceOrders: listWorkspaceOrdersMock,
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

beforeEach(() => {
  vi.resetModules();
  addOrderGroupsToProductionBatchMock.mockReset();
  addOrderItemsToProductionBatchMock.mockReset();
  importWorkspaceOrderItemsMock.mockReset();
  listWorkspaceOrdersMock.mockReset();
  resolveProductionBatchAuthMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("orders api route", () => {
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
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });
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
    expect(listWorkspaceOrdersMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: null,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 1,
      addedOrderItemCount: 0,
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    });
  });

  it("returns the store's production batch add count when importing clipboard items to a batch", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    importWorkspaceOrderItemsMock.mockResolvedValue({
      importedCount: 3,
      addedToBatchCount: 1,
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
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
    });
  });

  it("adds one order item to a production batch and returns counts with refreshed orders", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    addOrderItemsToProductionBatchMock.mockResolvedValue({
      addedOrderItemIds: ["item-1"],
    });
    listWorkspaceOrdersMock.mockResolvedValue({
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
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
      },
    }, response);

    expect(addOrderItemsToProductionBatchMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderItemIds: ["item-1"],
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      importedOrderItemCount: 0,
      addedOrderItemCount: 1,
      orders: [{ id: "order:1001", isInActiveBatch: true, items: [{ id: "item-1" }] }],
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
});
