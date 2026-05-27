import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionContextMock = vi.fn();

vi.mock("../../api/_lib/shared-queue-store.js", () => ({
  getSessionContext: getSessionContextMock,
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared session api", () => {
  it("returns the current operator, workspace, and queue context for an authenticated request", async () => {
    getSessionContextMock.mockResolvedValue({
      operator: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      queue: { id: "queue-1", workspaceId: "workspace-1" },
    });

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      auth: { userId: "user-1", workspaceId: "workspace-1" },
    }, response);

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
    getSessionContextMock.mockRejectedValue(Object.assign(new Error("Shared workspace access denied."), {
      code: "SHARED_SESSION_FORBIDDEN",
      statusCode: 403,
      expose: true,
    }));

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      auth: { userId: "user-1", workspaceId: "workspace-1" },
    }, response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "Shared workspace access denied." });
  });

  it("returns a generic 500 message for unexpected shared session errors", async () => {
    getSessionContextMock.mockRejectedValue(new Error("Raw database failure"));

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      auth: { userId: "user-1", workspaceId: "workspace-1" },
    }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: "Unable to load the shared queue session." });
  });

  it("requires authentication before loading the shared session context", async () => {
    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", auth: null }, response);

    expect(getSessionContextMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required." });
  });
});
