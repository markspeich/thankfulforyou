import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveProductionBatchAuthMock = vi.fn();
const listWorkspaceFontsMock = vi.fn();
const createWorkspaceFontMock = vi.fn();
const replaceWorkspaceFontMock = vi.fn();
const deleteWorkspaceFontMock = vi.fn();

vi.mock("../../api/_lib/production-batch-auth.js", () => ({
  resolveProductionBatchAuth: resolveProductionBatchAuthMock,
}));

vi.mock("../../api/_lib/font-store.js", () => ({
  listWorkspaceFonts: listWorkspaceFontsMock,
  createWorkspaceFont: createWorkspaceFontMock,
  replaceWorkspaceFont: replaceWorkspaceFontMock,
  deleteWorkspaceFont: deleteWorkspaceFontMock,
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
  listWorkspaceFontsMock.mockReset();
  createWorkspaceFontMock.mockReset();
  replaceWorkspaceFontMock.mockReset();
  deleteWorkspaceFontMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fonts api route", () => {
  it("lists workspace fonts for authenticated operators", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    listWorkspaceFontsMock.mockResolvedValue([{ id: "font-1", display_name: "Clinic Sans" }]);
    const { default: handler } = await import("../../api/fonts.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      headers: { authorization: "Bearer token-1" },
      query: { includeDeleted: "true" },
    }, response);

    expect(listWorkspaceFontsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      includeDeleted: true,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ fonts: [{ id: "font-1", display_name: "Clinic Sans" }] });
  });

  it("rejects create requests without upload data", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fonts.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      headers: { authorization: "Bearer token-1" },
      body: { displayName: "Clinic Sans" },
    }, response);

    expect(createWorkspaceFontMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Font upload must include a file." });
  });

  it("returns store errors for protected built-in delete requests", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    deleteWorkspaceFontMock.mockRejectedValue(Object.assign(new Error("Built-in fonts cannot be deleted or replaced."), {
      statusCode: 400,
      expose: true,
    }));
    const { default: handler } = await import("../../api/fonts.js");
    const response = createResponseRecorder();

    await handler({
      method: "DELETE",
      headers: { authorization: "Bearer token-1" },
      query: { fontId: "candlepin" },
    }, response);

    expect(deleteWorkspaceFontMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      fontId: "candlepin",
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Built-in fonts cannot be deleted or replaced." });
  });

  it("returns 405 for unsupported methods", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    const { default: handler } = await import("../../api/fonts.js");
    const response = createResponseRecorder();

    await handler({ method: "PATCH", headers: {}, query: {} }, response);

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST, PUT, DELETE");
    expect(response.body).toEqual({ error: "Method not allowed." });
  });
});
