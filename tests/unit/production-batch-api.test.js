import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("production batch api client", () => {
  it("loads the batch session payload", async () => {
    const payload = {
      operator: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      batch: { id: "batch-1", workspaceId: "workspace-1" },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchBatchSession } = await import("../../src/production-batch-api.js");

    await expect(fetchBatchSession()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/batch-session", {
      headers: { Accept: "application/json" },
    });
  });

  it("attaches the bearer token to shared-session requests", async () => {
    const payload = {
      operator: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      batch: { id: "batch-1", workspaceId: "workspace-1" },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchBatchSession } = await import("../../src/production-batch-api.js");

    await expect(fetchBatchSession("token-1")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/batch-session", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
    });
  });

  it("loads a batch and calls /api/production-batch with the batch id", async () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchProductionBatchSnapshot } = await import("../../src/production-batch-api.js");

    await expect(fetchProductionBatchSnapshot("batch-1")).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/production-batch?batchId=batch-1", {
      headers: { Accept: "application/json" },
    });
  });

  it("throws ProductionBatchConflictError with details on a 409 save response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Revision conflict",
        details: { orderItemId: "order-1", revision: 2 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ProductionBatchConflictError, saveProductionBatchSnapshot } = await import("../../src/production-batch-api.js");
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    };

    const error = await saveProductionBatchSnapshot(snapshot).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(ProductionBatchConflictError);
    expect(error).toMatchObject({
      name: "ProductionBatchConflictError",
      details: { orderItemId: "order-1", revision: 2 },
      message: "Revision conflict",
    });
  });

  it("normalizes JSON string conflict details from Supabase", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Revision conflict",
        details: JSON.stringify({ orderItemId: "order-2", revision: 5 }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ProductionBatchConflictError, saveProductionBatchSnapshot } = await import("../../src/production-batch-api.js");
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    };

    const error = await saveProductionBatchSnapshot(snapshot).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(ProductionBatchConflictError);
    expect(error.details).toEqual({ orderItemId: "order-2", revision: 5 });
  });

  it("passes keepalive through for unload-safe shared saves", async () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { saveProductionBatchSnapshot } = await import("../../src/production-batch-api.js");

    await expect(saveProductionBatchSnapshot(snapshot, { keepalive: true, accessToken: "token-1" })).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/production-batch", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      keepalive: true,
      body: JSON.stringify({ snapshot }),
    });
  });

  it("passes changed order item ids through for scoped production batch saves", async () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-1", revision: 1 }, { id: "order-2", revision: 3 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { saveProductionBatchSnapshot } = await import("../../src/production-batch-api.js");

    await expect(saveProductionBatchSnapshot(snapshot, { changedOrderItemIds: ["order-2"] })).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/production-batch", expect.objectContaining({
      body: JSON.stringify({ snapshot, changedOrderItemIds: ["order-2"] }),
    }));
  });

  it("archives a production batch through the shared API route", async () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: null,
      orderItems: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { archiveProductionBatch } = await import("../../src/production-batch-api.js");

    await expect(archiveProductionBatch("batch-1", { accessToken: "token-1" })).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/production-batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        action: "archive",
        batchId: "batch-1",
      }),
    });
  });

  it("archives one production batch item through the shared API route", async () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-2",
      orderItems: [{ id: "order-2", revision: 1 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { archiveProductionBatchItem } = await import("../../src/production-batch-api.js");

    await expect(archiveProductionBatchItem("batch-1", "order-1", { accessToken: "token-1" })).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/production-batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        action: "archive-item",
        batchId: "batch-1",
        orderItemId: "order-1",
      }),
    });
  });
});

describe("auth session helpers", () => {
  it("creates a browser supabase client from app config and loads the signed-in session", async () => {
    const session = {
      access_token: "token-1",
      user: { id: "user-1", email: "mark@example.com" },
    };
    const getSessionMock = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });
    vi.stubGlobal("window", {
      __APP_CONFIG__: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      },
    });
    vi.stubGlobal("__TFU_TEST_SUPABASE_CLIENT__", {
      auth: {
        getSession: getSessionMock,
      },
    });

    const { getBrowserSupabaseClient, getSignedInSession } = await import("../../src/auth-session.js");

    const client = getBrowserSupabaseClient();

    expect(client.auth.getSession).toBe(getSessionMock);
    await expect(getSignedInSession()).resolves.toEqual(session);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the browser supabase config is missing", async () => {
    vi.stubGlobal("window", {});

    const { getBrowserSupabaseClient } = await import("../../src/auth-session.js");

    expect(() => getBrowserSupabaseClient()).toThrow(
      "Supabase browser config is missing. Set window.__APP_CONFIG__.supabaseUrl and window.__APP_CONFIG__.supabaseAnonKey before loading batch sessions.",
    );
  });

  it("signs in with email and password through the browser supabase client", async () => {
    const session = {
      access_token: "token-1",
      user: { id: "user-1", email: "mark@example.com" },
    };
    const signInWithPasswordMock = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });
    vi.stubGlobal("window", {
      __APP_CONFIG__: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      },
    });
    vi.stubGlobal("__TFU_TEST_SUPABASE_CLIENT__", {
      auth: {
        signInWithPassword: signInWithPasswordMock,
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    });

    const { signInWithPassword } = await import("../../src/auth-session.js");

    await expect(signInWithPassword("mark@example.com", "secret-pass")).resolves.toEqual(session);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "mark@example.com",
      password: "secret-pass",
    });
  });

  it("signs out through the browser supabase client", async () => {
    const signOutMock = vi.fn().mockResolvedValue({
      error: null,
    });
    vi.stubGlobal("window", {
      __APP_CONFIG__: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      },
    });
    vi.stubGlobal("__TFU_TEST_SUPABASE_CLIENT__", {
      auth: {
        signOut: signOutMock,
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    });

    const { signOutBrowserSession } = await import("../../src/auth-session.js");

    await expect(signOutBrowserSession()).resolves.toBeUndefined();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("returns the current access token when a session exists", async () => {
    const getSessionMock = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "token-1",
          user: { id: "user-1", email: "mark@example.com" },
        },
      },
      error: null,
    });
    vi.stubGlobal("window", {
      __APP_CONFIG__: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      },
    });
    vi.stubGlobal("__TFU_TEST_SUPABASE_CLIENT__", {
      auth: {
        getSession: getSessionMock,
      },
    });

    const { getAccessToken } = await import("../../src/auth-session.js");

    await expect(getAccessToken()).resolves.toBe("token-1");
  });
});
