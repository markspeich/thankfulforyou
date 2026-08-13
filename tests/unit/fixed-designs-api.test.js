import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveProductionBatchAuthMock = vi.fn();
const listWorkspaceFixedDesignsMock = vi.fn();
const createWorkspaceFixedDesignMock = vi.fn();
const replaceWorkspaceFixedDesignMock = vi.fn();
const deleteWorkspaceFixedDesignMock = vi.fn();

vi.mock("../../api/_lib/production-batch-auth.js", () => ({
  resolveProductionBatchAuth: resolveProductionBatchAuthMock,
}));

vi.mock("../../api/_lib/fixed-design-store.js", () => ({
  listWorkspaceFixedDesigns: listWorkspaceFixedDesignsMock,
  createWorkspaceFixedDesign: createWorkspaceFixedDesignMock,
  replaceWorkspaceFixedDesign: replaceWorkspaceFixedDesignMock,
  deleteWorkspaceFixedDesign: deleteWorkspaceFixedDesignMock,
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
  resolveProductionBatchAuthMock.mockReset();
  listWorkspaceFixedDesignsMock.mockReset();
  createWorkspaceFixedDesignMock.mockReset();
  replaceWorkspaceFixedDesignMock.mockReset();
  deleteWorkspaceFixedDesignMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixed designs api route", () => {
  it("lists workspace fixed designs for authenticated operators", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    listWorkspaceFixedDesignsMock.mockResolvedValue([{ id: "fixed-design-1", display_name: "Pill Bottle" }]);
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { includeDeleted: "true" },
    }, response);

    expect(listWorkspaceFixedDesignsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      includeDeleted: true,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      fixedDesigns: [{ id: "fixed-design-1", display_name: "Pill Bottle" }],
    });
  });

  it("rejects create requests without a file", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: { displayName: "Pill Bottle" },
    }, response);

    expect(createWorkspaceFixedDesignMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Fixed design upload must include a file." });
  });

  it("returns an actionable conflict when a fixed design name already exists", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    createWorkspaceFixedDesignMock.mockRejectedValue(Object.assign(
      new Error('A fixed design named "Rbt" already exists. Select it and use Load New Version to replace its SVG.'),
      { statusCode: 409, expose: true },
    ));
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: {
        displayName: "Rbt",
        file: { name: "rbt.svg", type: "image/svg+xml", text: "<svg></svg>" },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'A fixed design named "Rbt" already exists. Select it and use Load New Version to replace its SVG.',
    });
  });

  it("rejects replace requests without a fixedDesignId", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      query: {},
      body: { file: { name: "pill-bottle.svg", text: "<svg />" } },
    }, response);

    expect(replaceWorkspaceFixedDesignMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "fixedDesignId is required." });
  });

  it("rejects replace requests without a file", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      headers: { authorization: "Bearer token-1" },
      query: { fixedDesignId: "fixed-design-1" },
      body: {},
    }, response);

    expect(replaceWorkspaceFixedDesignMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Fixed design upload must include a file." });
  });

  it("rejects delete requests without a fixedDesignId", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fixed-designs.js");
    const response = createResponseRecorder();

    await handler({
      method: "DELETE",
      headers: { authorization: "Bearer token-1" },
      query: {},
    }, response);

    expect(deleteWorkspaceFixedDesignMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "fixedDesignId is required." });
  });
});
