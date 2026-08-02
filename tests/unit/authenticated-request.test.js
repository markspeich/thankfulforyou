import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installSessionClient(refreshSession) {
  vi.stubGlobal("window", {
    __APP_CONFIG__: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    },
  });
  vi.stubGlobal("__TFU_TEST_SUPABASE_CLIENT__", {
    auth: { refreshSession },
  });
}

describe("authenticated request recovery", () => {
  it("shares one token refresh across concurrent unauthorized requests and retries each once", async () => {
    let releaseRefresh;
    const refreshSession = vi.fn(() => new Promise((resolve) => {
      releaseRefresh = () => resolve({
        data: { session: { access_token: "fresh-token", refresh_token: "refresh-2", user: { id: "user-1" } } },
        error: null,
      });
    }));
    installSessionClient(refreshSession);
    const { runAuthenticatedRequest } = await import("../../src/authenticated-request.js");
    const firstTokens = [];
    const secondTokens = [];
    const first = runAuthenticatedRequest(async (token) => {
      firstTokens.push(token);
      if (token === "expired-token") throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return "first complete";
    }, { accessToken: "expired-token" });
    const second = runAuthenticatedRequest(async (token) => {
      secondTokens.push(token);
      if (token === "expired-token") throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return "second complete";
    }, { accessToken: "expired-token" });

    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual(["first complete", "second complete"]);
    expect(firstTokens).toEqual(["expired-token", "fresh-token"]);
    expect(secondTokens).toEqual(["expired-token", "fresh-token"]);
  });

  it("returns the second unauthorized error without refreshing again", async () => {
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "fresh-token", refresh_token: "refresh-2", user: { id: "user-1" } } },
      error: null,
    });
    installSessionClient(refreshSession);
    const { runAuthenticatedRequest } = await import("../../src/authenticated-request.js");
    const request = vi.fn(async () => {
      throw Object.assign(new Error("Authentication required."), { status: 401 });
    });

    await expect(runAuthenticatedRequest(request, { accessToken: "expired-token" }))
      .rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("returns authentication required when refreshing the session fails", async () => {
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: new Error("Refresh token expired"),
    });
    installSessionClient(refreshSession);
    const { runAuthenticatedRequest } = await import("../../src/authenticated-request.js");

    await expect(runAuthenticatedRequest(async () => {
      throw Object.assign(new Error("Access denied."), { status: 401 });
    }, { accessToken: "expired-token" })).rejects.toMatchObject({
      message: "Authentication required.",
      status: 401,
    });
  });
});
