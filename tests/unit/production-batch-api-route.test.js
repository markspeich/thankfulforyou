import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProductionBatchMock = vi.fn();
const saveProductionBatchMock = vi.fn();
const completeProductionBatchMock = vi.fn();
const mutateSelectedProductionBatchItemsMock = vi.fn();
const removeProductionBatchItemMock = vi.fn();
const resolveProductionBatchAuthMock = vi.fn();
const tagProductionBatchInShipStationMock = vi.fn();
const removeProductionBatchShipStationTagsMock = vi.fn();

vi.mock("../../api/_lib/production-batch-shipstation.js", () => ({
  tagProductionBatchInShipStation: tagProductionBatchInShipStationMock,
  removeProductionBatchShipStationTags: removeProductionBatchShipStationTagsMock,
}));

vi.mock("../../api/_lib/production-batch-store.js", () => ({
  completeProductionBatch: completeProductionBatchMock,
  mutateSelectedProductionBatchItems: mutateSelectedProductionBatchItemsMock,
  loadProductionBatch: loadProductionBatchMock,
  removeProductionBatchItem: removeProductionBatchItemMock,
  saveProductionBatch: saveProductionBatchMock,
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
    end() {
      return this;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  loadProductionBatchMock.mockReset();
  saveProductionBatchMock.mockReset();
  completeProductionBatchMock.mockReset();
  mutateSelectedProductionBatchItemsMock.mockReset();
  removeProductionBatchItemMock.mockReset();
  resolveProductionBatchAuthMock.mockReset();
  tagProductionBatchInShipStationMock.mockReset();
  removeProductionBatchShipStationTagsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production batch api route", () => {
  it.each(["remove-item", "selected-items"])("never synchronizes when %s fails in the database", async action => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const error = Object.assign(new Error("Batch unavailable"), { expose: true, statusCode: 404 });
    removeProductionBatchItemMock.mockRejectedValue(error);
    mutateSelectedProductionBatchItemsMock.mockRejectedValue(error);
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action, operation: "remove", batchId: "batch-1", orderItemId: "item-1", orderItemIds: ["item-1"] } }, response);
    expect(response.statusCode).toBe(404);
    expect(loadProductionBatchMock).not.toHaveBeenCalled();
    expect(tagProductionBatchInShipStationMock).not.toHaveBeenCalled();
  });

  it("manually recovers an empty authenticated saved batch instead of accepting browser membership", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const saved = { batch: { id: "batch-1" }, orderItems: [] };
    loadProductionBatchMock.mockResolvedValue(saved);
    tagProductionBatchInShipStationMock.mockResolvedValue({ removedTags: 2, taggedOrders: 0, unmatchedOrders: [], failures: [] });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "tag-shipstation", batchId: "batch-1", snapshot: { orderItems: [{ id: "forged" }] } } }, response);
    expect(response.statusCode).toBe(200);
    expect(tagProductionBatchInShipStationMock).toHaveBeenCalledExactlyOnceWith({ snapshot: saved });
    expect(response.body.removedTags).toBe(2);
  });
  it.each(["remove-item", "remove", "skip", "complete"])("reconciles authenticated saved remaining membership after %s", async operation => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const saved = { batch: { id: "batch-1" }, orderItems: [{ id: "sibling" }] };
    removeProductionBatchItemMock.mockResolvedValue(saved);
    mutateSelectedProductionBatchItemsMock.mockResolvedValue(saved);
    loadProductionBatchMock.mockResolvedValue(saved);
    const tagging = { tagName: "Current Production Batch", taggedOrders: 1, removedTags: 1, unmatchedOrders: [], failures: [] };
    tagProductionBatchInShipStationMock.mockResolvedValue(tagging);
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: operation === "remove-item" ? operation : "selected-items", operation, batchId: "batch-1", orderItemId: "removed", orderItemIds: ["removed"], snapshot: { orderItems: [] } } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body.shipStationTagging).toEqual({ status: "success", ...tagging });
    expect(loadProductionBatchMock).toHaveBeenCalledWith({ batchId: "batch-1", workspaceId: "workspace-1" });
    expect(tagProductionBatchInShipStationMock).toHaveBeenCalledWith({ snapshot: saved });
  });

  it("retains a saved trash removal when upstream tagging fails", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    removeProductionBatchItemMock.mockResolvedValue({ batch: { id: "batch-1" }, orderItems: [] });
    loadProductionBatchMock.mockResolvedValue({ orderItems: [] });
    tagProductionBatchInShipStationMock.mockRejectedValue(new Error("upstream secret"));
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "remove-item", batchId: "batch-1", orderItemId: "removed" } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body.orderItems).toEqual([]);
    expect(response.body.shipStationTagging.status).toBe("warning");
    expect(JSON.stringify(response.body)).not.toContain("upstream secret");
  });
  it("checks batch ownership before cleanup and returns cleanup counts after completing", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    loadProductionBatchMock.mockResolvedValue({ batch: { id: "batch-1" }, orderItems: [{ id: "item-1" }] });
    removeProductionBatchShipStationTagsMock.mockImplementation(async () => {
      expect(loadProductionBatchMock).toHaveBeenCalledWith({ batchId: "batch-1", workspaceId: "workspace-1" });
      expect(completeProductionBatchMock).not.toHaveBeenCalled();
      return { removedTags: 3 };
    });
    completeProductionBatchMock.mockResolvedValue({ batch: { id: "batch-1" }, orderItems: [] });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "complete", batchId: "batch-1" } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body.shipStationCleanup).toEqual({ removedTags: 3 });
    expect(completeProductionBatchMock).toHaveBeenCalledOnce();
  });

  it("does not clean tags or complete when the authenticated batch is missing", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    loadProductionBatchMock.mockResolvedValue(null);
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "complete", batchId: "other-batch" } }, response);
    expect(response.statusCode).toBe(404);
    expect(removeProductionBatchShipStationTagsMock).not.toHaveBeenCalled();
    expect(completeProductionBatchMock).not.toHaveBeenCalled();
  });

  it("keeps the database batch open when tag cleanup fails", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    loadProductionBatchMock.mockResolvedValue({ batch: { id: "batch-1" } });
    removeProductionBatchShipStationTagsMock.mockRejectedValue(Object.assign(new Error("Batch is still open. Retry completion."), { expose: true, statusCode: 502 }));
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "complete", batchId: "batch-1" } }, response);
    expect(response.statusCode).toBe(502);
    expect(completeProductionBatchMock).not.toHaveBeenCalled();
  });

  it("explains that cleanup already ran when database completion fails", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    loadProductionBatchMock.mockResolvedValue({ batch: { id: "batch-1" } });
    removeProductionBatchShipStationTagsMock.mockResolvedValue({ removedTags: 3 });
    completeProductionBatchMock.mockRejectedValue(new Error("private database details"));
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "complete", batchId: "batch-1" } }, response);
    expect(response.statusCode).toBe(500);
    expect(response.body.error).toBe("ShipStation batch tags were removed, but completion could not be confirmed. Refresh the batch to check its status before retrying.");
    expect(response.body.error).not.toContain("private database details");
  });
  it("tags only the saved batch loaded through the authenticated workspace", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const snapshot = { batch: { id: "batch-1" }, orderItems: [{ source: { orderNumber: "100" } }] };
    loadProductionBatchMock.mockResolvedValue(snapshot);
    tagProductionBatchInShipStationMock.mockResolvedValue({ tagName: "Current Production Batch", taggedOrders: 1, removedTags: 0, unmatchedOrders: [], failures: [] });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "tag-shipstation", batchId: "batch-1", orderItems: [{ source: { orderNumber: "forged" } }] } }, response);
    expect(loadProductionBatchMock).toHaveBeenCalledWith({ batchId: "batch-1", workspaceId: "workspace-1" });
    expect(tagProductionBatchInShipStationMock).toHaveBeenCalledExactlyOnceWith({ snapshot });
    expect(response.statusCode).toBe(200);
    expect(response.body.taggedOrders).toBe(1);
  });

  it("does not tag another workspace's missing batch", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    loadProductionBatchMock.mockResolvedValue(null);
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "tag-shipstation", batchId: "other-batch" } }, response);
    expect(response.statusCode).toBe(404);
    expect(tagProductionBatchInShipStationMock).not.toHaveBeenCalled();
  });

  it.each(["complete", "skip", "remove"])("dispatches selected %s with authenticated workspace", async (operation) => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    mutateSelectedProductionBatchItemsMock.mockResolvedValue({ batch: { id: "batch-1" }, orderItems: [] });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "selected-items", operation, batchId: "batch-1", orderItemIds: ["order-1"] } }, response);
    expect(response.statusCode).toBe(200);
    expect(mutateSelectedProductionBatchItemsMock).toHaveBeenCalledWith({ operation, batchId: "batch-1", orderItemIds: ["order-1"], workspaceId: "workspace-1", userId: "user-1" });
  });

  it.each([[], [""], ["order-1", "order-1"], [null], "order-1"])("rejects invalid selected IDs %j", async (orderItemIds) => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { action: "selected-items", operation: "skip", batchId: "batch-1", orderItemIds } }, response);
    expect(response.statusCode).toBe(400);
    expect(mutateSelectedProductionBatchItemsMock).not.toHaveBeenCalled();
  });
  it("returns a production batch snapshot for a valid GET request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 3 }],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: "batch-1" },
    }, response);

    expect(resolveProductionBatchAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { batchId: "batch-1" },
    }));
    expect(loadProductionBatchMock).toHaveBeenCalledWith({
      batchId: "batch-1",
      workspaceId: "workspace-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.batch.id).toBe("batch-1");
  });

  it("rejects PUT requests without batch metadata", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: { activeOrderItemId: null, orderItems: [] },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "snapshot.batch.id and snapshot.batch.workspaceId are required.",
    });
  });

  it("rejects PUT requests when the snapshot workspace does not match the auth workspace", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-2" },
          activeOrderItemId: null,
          orderItems: [],
        },
      },
    }, response);

    expect(saveProductionBatchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: "snapshot.batch.workspaceId must match the authenticated workspace.",
    });
  });

  it("rejects PUT requests when snapshot.orderItems is not an array", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-1" },
          activeOrderItemId: null,
          orderItems: { id: "order-1" },
        },
      },
    }, response);

    expect(saveProductionBatchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "snapshot.orderItems must be an array.",
    });
  });

  it("returns a normalized production batch snapshot for a valid PUT request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 4 }],
    });
    saveProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1", updatedBy: "user-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 4 }],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 4 }],
    };

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: { snapshot },
    }, response);

    expect(saveProductionBatchMock).toHaveBeenCalledWith({
      snapshot,
      changedOrderItemIds: null,
      userId: "user-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      batch: { id: "batch-1", workspaceId: "workspace-1", updatedBy: "user-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 4 }],
    });
  });

  it("checks conflicts only for changed order items and preserves current unchanged rows", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [
        { id: "order-1", revision: 9, text: "Current unchanged" },
        { id: "order-2", revision: 4, text: "Current changed" },
      ],
    });
    saveProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [
        { id: "order-1", revision: 9, text: "Current unchanged" },
        { id: "order-2", revision: 5, text: "Incoming changed" },
      ],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        changedOrderItemIds: ["order-2"],
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-1" },
          activeOrderItemId: "order-2",
          orderItems: [
            { id: "order-1", revision: 1, text: "Stale unchanged" },
            { id: "order-2", revision: 4, text: "Incoming changed" },
          ],
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(saveProductionBatchMock).toHaveBeenCalledWith({
      changedOrderItemIds: ["order-2"],
      userId: "user-1",
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-2",
        orderItems: [
          { id: "order-1", revision: 9, text: "Current unchanged" },
          { id: "order-2", revision: 4, text: "Incoming changed" },
        ],
      },
    });
  });

  it("keeps scoped saves scoped when their snapshot includes a new order item", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [
        { id: "order-1", revision: 9, text: "Current existing" },
      ],
    });
    saveProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [
        { id: "order-1", revision: 9, text: "Current existing" },
        { id: "order-2", revision: 1, text: "New manual design" },
      ],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        changedOrderItemIds: ["order-2"],
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-1" },
          activeOrderItemId: "order-2",
          orderItems: [
            { id: "order-1", revision: 1, text: "Stale existing" },
            { id: "order-2", revision: null, text: "New manual design" },
          ],
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(saveProductionBatchMock).toHaveBeenCalledWith({
      changedOrderItemIds: ["order-2"],
      userId: "user-1",
      snapshot: {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-2",
        orderItems: [
          { id: "order-1", revision: 9, text: "Current existing" },
          { id: "order-2", revision: null, text: "New manual design" },
        ],
      },
    });
  });
  it("returns 409 before saving when the current production batch has a newer row revision", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [
        {
          id: "order-1",
          revision: 4,
          updatedAt: "2026-05-28T04:30:00.000Z",
          updatedBy: { email: "first-browser@example.com" },
        },
      ],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-1" },
          activeOrderItemId: "order-1",
          orderItems: [{ id: "order-1", revision: 3 }],
        },
      },
    }, response);

    expect(saveProductionBatchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "Revision conflict",
      details: {
        orderItemId: "order-1",
        revision: 4,
        updatedAt: "2026-05-28T04:30:00.000Z",
        updatedBy: { email: "first-browser@example.com" },
      },
    });
  });

  it("returns 409 when a stale revision save is rejected", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 2 }],
    });
    saveProductionBatchMock.mockRejectedValue(Object.assign(new Error("Revision conflict"), {
      code: "REVISION_CONFLICT",
      details: { orderItemId: "order-1" },
    }));

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          batch: { id: "batch-1", workspaceId: "workspace-1" },
          activeOrderItemId: "order-1",
          orderItems: [{ id: "order-1", revision: 2 }],
        },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "Revision conflict",
      details: { orderItemId: "order-1" },
    });
  });

  it("completes the current production batch for a valid POST request", async () => {
    loadProductionBatchMock.mockResolvedValue({ batch: { id: "batch-1" }, orderItems: [{ id: "item-1" }] });
    removeProductionBatchShipStationTagsMock.mockResolvedValue({ removedTags: 2 });
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    completeProductionBatchMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: null,
      orderItems: [],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "complete",
        batchId: "batch-1",
      },
    }, response);

    expect(completeProductionBatchMock).toHaveBeenCalledWith({
      batchId: "batch-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: null,
      orderItems: [],
      shipStationCleanup: { removedTags: 2 },
    });
  });

  it("removes a single production batch item for a valid POST request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    removeProductionBatchItemMock.mockResolvedValue({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 1 }],
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "remove-item",
        batchId: "batch-1",
        orderItemId: "order-1",
      },
    }, response);

    expect(removeProductionBatchItemMock).toHaveBeenCalledWith({
      batchId: "batch-1",
      orderItemId: "order-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 1 }],
      shipStationTagging: expect.objectContaining({ status: "warning" }),
    });
  });

  it("rejects unsupported POST actions", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "delete",
        batchId: "batch-1",
      },
    }, response);

    expect(completeProductionBatchMock).not.toHaveBeenCalled();
    expect(removeProductionBatchItemMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Unsupported production batch action.",
    });
  });

  it("returns Supabase-style object error details instead of a generic message", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    removeProductionBatchItemMock.mockRejectedValue({
      message: 'new row for relation "batch_items" violates check constraint "batch_items_status_check"',
      code: "23514",
      details: "Failing row contains archived status.",
      hint: "Apply the archive batch migration.",
    });

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        action: "remove-item",
        batchId: "batch-1",
        orderItemId: "order-1",
      },
    }, response);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Production batch API error",
      expect.objectContaining({
        code: "23514",
      }),
      expect.any(Object),
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: 'new row for relation "batch_items" violates check constraint "batch_items_status_check"',
      code: "23514",
      details: "Failing row contains archived status.",
      hint: "Apply the archive batch migration.",
    });
  });

  it("returns 401 when auth resolution fails before batch access", async () => {
    resolveProductionBatchAuthMock.mockRejectedValue(Object.assign(new Error("Authentication required."), {
      statusCode: 401,
      expose: true,
    }));

    const { default: handler } = await import("../../api/production-batch.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: {},
      query: { batchId: "batch-1" },
    }, response);

    expect(loadProductionBatchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: "Authentication required.",
    });
  });
});

it("forwards explicit color intent to persistence on a revision-checked scoped save", async () => {
  resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
  const snapshot = { batch: { id: "batch-1", workspaceId: "workspace-1" }, orderItems: [{ id: "order-1", revision: 1 }] };
  loadProductionBatchMock.mockResolvedValue(snapshot);
  saveProductionBatchMock.mockResolvedValue(snapshot);
  const colorUpdates = [{ orderItemId: "order-1", action: "set", colorName: "Purple" }];
  const { default: handler } = await import("../../api/production-batch.js");
  const response = createResponseRecorder();
  await handler({ method: "PUT", body: { snapshot, changedOrderItemIds: ["order-1"], colorUpdates } }, response);
  expect(response.statusCode).toBe(200);
  expect(saveProductionBatchMock).toHaveBeenCalledWith(expect.objectContaining({ colorUpdates, changedOrderItemIds: ["order-1"] }));
});
