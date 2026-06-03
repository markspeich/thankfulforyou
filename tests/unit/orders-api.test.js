import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("orders api client", () => {
  it("attaches a bearer token when loading workspace orders", async () => {
    const payload = { orders: [{ id: "order:1001", items: [{ id: "item-1" }] }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWorkspaceOrders } = await import("../../src/orders-api.js");

    await expect(fetchWorkspaceOrders({ batchId: "batch-1", accessToken: "token-1" })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders?batchId=batch-1", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
    });
  });

  it("imports clipboard items to the orders target", async () => {
    const payload = {
      importedOrderItemCount: 1,
      addedOrderItemCount: 0,
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { importWorkspaceOrders } = await import("../../src/orders-api.js");
    const items = [{ id: "item-1", text: "Mark" }];

    await expect(importWorkspaceOrders({ target: "orders", items })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "importClipboardItems",
        target: "orders",
        items,
      }),
    });
  });

  it("attaches a bearer token when importing clipboard items", async () => {
    const payload = {
      importedOrderItemCount: 1,
      addedOrderItemCount: 1,
      orders: [{ id: "order:1001", items: [{ id: "item-1" }] }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { importWorkspaceOrders } = await import("../../src/orders-api.js");
    const items = [{ id: "item-1", text: "Mark" }];

    await expect(importWorkspaceOrders({
      target: "productionBatch",
      items,
      batchId: "batch-1",
      accessToken: "token-1",
    })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        action: "importClipboardItems",
        target: "productionBatch",
        items,
        batchId: "batch-1",
      }),
    }));
  });

  it("throws a readable error when adding an order item fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "orderItemId is required." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { addOrderItemToProductionBatch } = await import("../../src/orders-api.js");

    await expect(addOrderItemToProductionBatch({
      batchId: "batch-1",
      orderItemId: "",
    })).rejects.toThrow("orderItemId is required.");
  });

  it("attaches a bearer token when adding one order item to a production batch", async () => {
    const payload = { importedOrderItemCount: 0, addedOrderItemCount: 1, orders: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { addOrderItemToProductionBatch } = await import("../../src/orders-api.js");

    await expect(addOrderItemToProductionBatch({
      batchId: "batch-1",
      orderItemId: "item-1",
      accessToken: "token-1",
    })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        action: "addOrderItemToProductionBatch",
        batchId: "batch-1",
        orderItemId: "item-1",
      }),
    }));
  });

  it("adds grouped orders to a production batch", async () => {
    const payload = {
      importedOrderItemCount: 0,
      addedOrderItemCount: 2,
      orders: [{ id: "order:1001", items: [{ id: "item-1" }, { id: "item-2" }] }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { addOrdersToProductionBatch } = await import("../../src/orders-api.js");

    await expect(addOrdersToProductionBatch({
      batchId: "batch-1",
      orderIds: ["order:1001"],
      accessToken: "token-1",
    })).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        action: "addOrdersToProductionBatch",
        batchId: "batch-1",
        orderIds: ["order:1001"],
      }),
    });
  });

  it("omits the batch id query string when loading orders without a batch id", async () => {
    const payload = { orders: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWorkspaceOrders } = await import("../../src/orders-api.js");

    await expect(fetchWorkspaceOrders({})).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/orders", {
      headers: {
        Accept: "application/json",
      },
    });
  });
});
