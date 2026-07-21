import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseAdminClientMock = vi.fn();

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

beforeEach(() => {
  vi.resetModules();
  createSupabaseAdminClientMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production batch auth helper", () => {
  it("extracts a bearer token from the authorization header", async () => {
    const { readBearerToken } = await import("../../api/_lib/production-batch-auth.js");

    expect(readBearerToken({
      headers: {
        authorization: "Bearer token-1",
      },
    })).toBe("token-1");
  });

  it("returns null when the authorization header is missing or not bearer auth", async () => {
    const { readBearerToken } = await import("../../api/_lib/production-batch-auth.js");

    expect(readBearerToken({ headers: {} })).toBeNull();
    expect(readBearerToken({
      headers: {
        authorization: "Basic abc123",
      },
    })).toBeNull();
  });

  it("returns verified req.auth context when the user has workspace membership", async () => {
    const membershipQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ workspace_id: "workspace-1" }],
        error: null,
      }),
    };
    createSupabaseAdminClientMock.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", email: "mark@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => membershipQuery),
    });

    const { resolveProductionBatchAuth } = await import("../../api/_lib/production-batch-auth.js");

    await expect(resolveProductionBatchAuth({
      headers: {
        authorization: "Bearer token-1",
      },
    })).resolves.toEqual({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
  });

  it("returns 401 when the request does not include a bearer token", async () => {
    const { resolveProductionBatchAuth } = await import("../../api/_lib/production-batch-auth.js");

    await expect(resolveProductionBatchAuth({
      headers: {},
    })).rejects.toMatchObject({
      statusCode: 401,
      expose: true,
      message: "Authentication required.",
    });
  });

  it("returns 401 when Supabase cannot verify the bearer token", async () => {
    createSupabaseAdminClientMock.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: null },
          error: new Error("Invalid JWT"),
        }),
      },
      from: vi.fn(),
    });

    const { resolveProductionBatchAuth } = await import("../../api/_lib/production-batch-auth.js");

    await expect(resolveProductionBatchAuth({
      headers: {
        authorization: "Bearer bad-token",
      },
    })).rejects.toMatchObject({
      statusCode: 401,
      expose: true,
      message: "Authentication required.",
    });
  });

  it("returns 503 when the dev server cannot reach Supabase auth", async () => {
    const fetchError = new Error("fetch failed");
    fetchError.name = "AuthRetryableFetchError";
    createSupabaseAdminClientMock.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: null },
          error: fetchError,
        }),
      },
      from: vi.fn(),
    });

    const { resolveProductionBatchAuth } = await import("../../api/_lib/production-batch-auth.js");

    await expect(resolveProductionBatchAuth({
      headers: {
        authorization: "Bearer token-1",
      },
    })).rejects.toMatchObject({
      statusCode: 503,
      expose: true,
      message: "Unable to reach Supabase auth from this dev server process.",
    });
  });

  it("returns 403 when the verified user has no shared workspace membership", async () => {
    createSupabaseAdminClientMock.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1", email: "mark@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      })),
    });

    const { resolveProductionBatchAuth } = await import("../../api/_lib/production-batch-auth.js");

    await expect(resolveProductionBatchAuth({
      headers: {
        authorization: "Bearer token-1",
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      expose: true,
      message: "Shared workspace access denied.",
    });
  });
});
