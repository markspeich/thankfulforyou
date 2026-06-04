import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProductionBatchMock = vi.fn();
const saveProductionBatchMock = vi.fn();
const archiveProductionBatchMock = vi.fn();
const archiveProductionBatchItemMock = vi.fn();
const resolveProductionBatchAuthMock = vi.fn();

vi.mock("../../api/_lib/production-batch-store.js", () => ({
  archiveProductionBatch: archiveProductionBatchMock,
  archiveProductionBatchItem: archiveProductionBatchItemMock,
  loadProductionBatch: loadProductionBatchMock,
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
  archiveProductionBatchMock.mockReset();
  archiveProductionBatchItemMock.mockReset();
  resolveProductionBatchAuthMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production batch api route", () => {
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

  it("archives the current production batch for a valid POST request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    archiveProductionBatchMock.mockResolvedValue({
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
        action: "archive",
        batchId: "batch-1",
      },
    }, response);

    expect(archiveProductionBatchMock).toHaveBeenCalledWith({
      batchId: "batch-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: null,
      orderItems: [],
    });
  });

  it("archives a single production batch item for a valid POST request", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    archiveProductionBatchItemMock.mockResolvedValue({
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
        action: "archive-item",
        batchId: "batch-1",
        orderItemId: "order-1",
      },
    }, response);

    expect(archiveProductionBatchItemMock).toHaveBeenCalledWith({
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

    expect(archiveProductionBatchMock).not.toHaveBeenCalled();
    expect(archiveProductionBatchItemMock).not.toHaveBeenCalled();
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
    archiveProductionBatchMock.mockRejectedValue({
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
        action: "archive",
        batchId: "batch-1",
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
