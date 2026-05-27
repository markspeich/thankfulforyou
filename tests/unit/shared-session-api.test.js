import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionContextMock = vi.fn();
const resolveSharedQueueAuthMock = vi.fn();

vi.mock("../../api/_lib/shared-queue-store.js", () => ({
  getSessionContext: getSessionContextMock,
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
  };
}

beforeEach(() => {
  vi.resetModules();
  getSessionContextMock.mockReset();
  resolveSharedQueueAuthMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared session api", () => {
  it("returns the current operator, workspace, and queue context for an authenticated request", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    getSessionContextMock.mockResolvedValue({
      operator: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      queue: { id: "queue-1", workspaceId: "workspace-1" },
    });

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
    }, response);

    expect(resolveSharedQueueAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
    }));
    expect(getSessionContextMock).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      operator: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      queue: { id: "queue-1", workspaceId: "workspace-1" },
    });
  });

  it("returns 403 for authenticated requests without shared workspace access", async () => {
    resolveSharedQueueAuthMock.mockRejectedValue(Object.assign(new Error("Shared workspace access denied."), {
      statusCode: 403,
      expose: true,
    }));

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
    }, response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "Shared workspace access denied." });
  });

  it("returns a generic 500 message for unexpected shared session errors", async () => {
    resolveSharedQueueAuthMock.mockResolvedValue({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    getSessionContextMock.mockRejectedValue(new Error("Raw database failure"));

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
    }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: "Unable to load the shared queue session." });
  });

  it("requires authentication before loading the shared session context", async () => {
    resolveSharedQueueAuthMock.mockRejectedValue(Object.assign(new Error("Authentication required."), {
      statusCode: 401,
      expose: true,
    }));
    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", headers: {} }, response);

    expect(getSessionContextMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required." });
  });
});
