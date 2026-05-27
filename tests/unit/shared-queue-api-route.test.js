import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSharedQueueMock = vi.fn();
const saveSharedQueueMock = vi.fn();
const resolveSharedQueueAuthMock = vi.fn();

vi.mock("../../api/_lib/shared-queue-store.js", () => ({
  loadSharedQueue: loadSharedQueueMock,
  saveSharedQueue: saveSharedQueueMock,
}));

vi.mock("../../api/_lib/shared-queue-auth.js", () => ({
  resolveSharedQueueAuth: resolveSharedQueueAuthMock,
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
  loadSharedQueueMock.mockReset();
  saveSharedQueueMock.mockReset();
  resolveSharedQueueAuthMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared queue api route", () => {
  it("returns a shared queue snapshot for a valid GET request", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    loadSharedQueueMock.mockResolvedValue({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 3 }],
    });

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { queueId: "queue-1" },
    }, response);

    expect(resolveSharedQueueAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { queueId: "queue-1" },
    }));
    expect(loadSharedQueueMock).toHaveBeenCalledWith({
      queueId: "queue-1",
      workspaceId: "workspace-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.queue.id).toBe("queue-1");
  });

  it("rejects PUT requests without queue metadata", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: { activeOrderId: null, orders: [] },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "snapshot.queue.id and snapshot.queue.workspaceId are required.",
    });
  });

  it("rejects PUT requests when the snapshot workspace does not match the auth workspace", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          queue: { id: "queue-1", workspaceId: "workspace-2" },
          activeOrderId: null,
          orders: [],
        },
      },
    }, response);

    expect(saveSharedQueueMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: "snapshot.queue.workspaceId must match the authenticated workspace.",
    });
  });

  it("rejects PUT requests when snapshot.orders is not an array", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          queue: { id: "queue-1", workspaceId: "workspace-1" },
          activeOrderId: null,
          orders: { id: "order-1" },
        },
      },
    }, response);

    expect(saveSharedQueueMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "snapshot.orders must be an array.",
    });
  });

  it("returns a normalized shared queue snapshot for a valid PUT request", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    saveSharedQueueMock.mockResolvedValue({
      queue_json: { id: "queue-1", workspaceId: "workspace-1", updatedBy: "user-1" },
      active_order_id: "order-2",
      orders_json: [{ id: "order-2", revision: 4 }],
    });

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();
    const snapshot = {
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-2",
      orders: [{ id: "order-2", revision: 4 }],
    };

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: { snapshot },
    }, response);

    expect(saveSharedQueueMock).toHaveBeenCalledWith({
      snapshot,
      userId: "user-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      queue: { id: "queue-1", workspaceId: "workspace-1", updatedBy: "user-1" },
      activeOrderId: "order-2",
      orders: [{ id: "order-2", revision: 4 }],
    });
  });

  it("returns 409 when a stale revision save is rejected", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    saveSharedQueueMock.mockRejectedValue(Object.assign(new Error("Revision conflict"), {
      code: "REVISION_CONFLICT",
      details: { orderId: "order-1" },
    }));

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      body: {
        snapshot: {
          queue: { id: "queue-1", workspaceId: "workspace-1" },
          activeOrderId: "order-1",
          orders: [{ id: "order-1", revision: 2 }],
        },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "Revision conflict",
      details: { orderId: "order-1" },
    });
  });

  it("returns 401 when auth resolution fails before queue access", async () => {
    resolveSharedQueueAuthMock.mockRejectedValue(Object.assign(new Error("Authentication required."), {
      statusCode: 401,
      expose: true,
    }));

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: {},
      query: { queueId: "queue-1" },
    }, response);

    expect(loadSharedQueueMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: "Authentication required.",
    });
  });
});
