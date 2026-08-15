import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveProductionBatchAuthMock = vi.fn();
const listWorkspaceFontAliasesMock = vi.fn();
const mapWorkspaceFontAliasMock = vi.fn();

vi.mock("../../api/_lib/production-batch-auth.js", () => ({ resolveProductionBatchAuth: resolveProductionBatchAuthMock }));
vi.mock("../../api/_lib/font-alias-store.js", () => ({
  listWorkspaceFontAliases: listWorkspaceFontAliasesMock,
  mapWorkspaceFontAlias: mapWorkspaceFontAliasMock,
}));

function createResponseRecorder() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  vi.resetModules();
  resolveProductionBatchAuthMock.mockReset();
  listWorkspaceFontAliasesMock.mockReset();
  mapWorkspaceFontAliasMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("font aliases api route", () => {
  it("lists browser-safe aliases for the authenticated workspace", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "operator-1", workspaceId: "workspace-1" });
    listWorkspaceFontAliasesMock.mockResolvedValue([{ id: "alias-1", aliasName: "Lemonade", font: { displayName: "Crushed Lemonade" } }]);
    const { default: handler } = await import("../../api/font-aliases.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", headers: { authorization: "Bearer token" } }, response);

    expect(listWorkspaceFontAliasesMock).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ fontAliases: [{ id: "alias-1", aliasName: "Lemonade", font: { displayName: "Crushed Lemonade" } }] });
  });

  it("canonicalizes aliases on the server and uses the authenticated operator", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "operator-1", workspaceId: "workspace-1" });
    mapWorkspaceFontAliasMock.mockResolvedValue({ alias: { id: "alias-1" }, line: null, orderRevision: null, designRevision: null });
    const { default: handler } = await import("../../api/font-aliases.js");
    const response = createResponseRecorder();

    await handler({
      method: "POST", headers: { authorization: "Bearer token" },
      body: { aliasName: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ", normalizedAlias: "wrong", fontId: "font-1" },
    }, response);

    expect(mapWorkspaceFontAliasMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1", userId: "operator-1", aliasName: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ",
      normalizedAlias: "super boy", fontId: "font-1",
    }));
    expect(response.statusCode).toBe(200);
  });

  it("returns the authoritative aliases with a recoverable conflict response", async () => {
    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "operator-1", workspaceId: "workspace-1" });
    mapWorkspaceFontAliasMock.mockRejectedValue(Object.assign(new Error("This mapping changed while you were editing it. Refresh and try again."), {
      code: "FONT_ALIAS_CONFLICT", statusCode: 409, expose: true,
    }));
    listWorkspaceFontAliasesMock.mockResolvedValue([{ id: "alias-1", aliasName: "Lemonade", fontId: "font-current" }]);
    const { default: handler } = await import("../../api/font-aliases.js");
    const response = createResponseRecorder();

    await handler({ method: "POST", headers: {}, body: { aliasName: "Lemonade", fontId: "font-2" } }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "This mapping changed while you were editing it. Refresh and try again.",
      code: "FONT_ALIAS_CONFLICT",
      fontAliases: [{ id: "alias-1", aliasName: "Lemonade", fontId: "font-current" }],
    });
  });

  it("requires authentication and rejects unsupported methods", async () => {
    resolveProductionBatchAuthMock.mockRejectedValue(Object.assign(new Error("Authentication required."), { statusCode: 401, expose: true }));
    const { default: handler } = await import("../../api/font-aliases.js");
    const unauthenticated = createResponseRecorder();
    await handler({ method: "GET", headers: {} }, unauthenticated);
    expect(unauthenticated.statusCode).toBe(401);

    resolveProductionBatchAuthMock.mockResolvedValue({ userId: "operator-1", workspaceId: "workspace-1" });
    const wrongMethod = createResponseRecorder();
    await handler({ method: "DELETE", headers: {} }, wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.headers.Allow).toBe("GET, POST");
  });
});
