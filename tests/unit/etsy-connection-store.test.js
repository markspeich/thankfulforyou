import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ calls: [], responses: [] }));

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => ({ from: (table) => builder(table) }),
}));

function builder(table, call = { table, filters: [] }) {
  const chain = {
    select(columns) { call.select = columns; return this; },
    upsert(payload, options) { call.operation = "upsert"; call.payload = payload; call.options = options; return this; },
    update(payload) { call.operation = "update"; call.payload = payload; return this; },
    eq(column, value) { call.filters.push(["eq", column, value]); return this; },
    or(value) { call.filters.push(["or", value]); return this; },
    maybeSingle() { database.calls.push(call); return Promise.resolve(database.responses.shift() || { data: null, error: null }); },
  };
  return chain;
}

const key = Buffer.alloc(32, 9).toString("base64");
const row = {
  workspace_id: "workspace-1", etsy_user_id: "user-1", etsy_shop_id: "shop-1", etsy_shop_name: "Shop",
  scopes: ["transactions_r"], status: "connected", access_token_envelope: {}, refresh_token_envelope: {},
  access_token_expires_at: "2026-07-16T22:00:00.000Z", refresh_token_expires_at: "2026-10-16T22:00:00.000Z",
  last_synced_at: null, import_lock_until: null, created_at: "2026-07-16T20:00:00.000Z", updated_at: "2026-07-16T20:00:00.000Z",
};

beforeEach(() => { process.env.ETSY_TOKEN_ENCRYPTION_KEY = key; database.calls = []; database.responses = []; });
afterEach(() => { delete process.env.ETSY_TOKEN_ENCRYPTION_KEY; });

describe("Etsy connection store", () => {
  it("saves encrypted tokens with a workspace-scoped upsert", async () => {
    database.responses.push({ data: row, error: null });
    const { saveEtsyConnection } = await import("../../api/_lib/etsy-connection-store.js");
    await saveEtsyConnection({ workspaceId: "workspace-1", etsyUserId: "user-1", etsyShopId: "shop-1", etsyShopName: "Shop", scopes: ["transactions_r"], accessToken: "access", refreshToken: "refresh", accessTokenExpiresAt: row.access_token_expires_at, refreshTokenExpiresAt: row.refresh_token_expires_at });
    expect(database.calls[0]).toMatchObject({ table: "etsy_connections", operation: "upsert", options: { onConflict: "workspace_id" } });
    expect(database.calls[0].payload.access_token_envelope.ciphertext).not.toContain("access");
  });

  it("returns status without selecting or exposing token envelopes", async () => {
    database.responses.push({ data: row, error: null });
    const { getEtsyConnection } = await import("../../api/_lib/etsy-connection-store.js");
    const result = await getEtsyConnection({ workspaceId: "workspace-1" });
    expect(database.calls[0].select).not.toContain("envelope");
    expect(database.calls[0].filters).toContainEqual(["eq", "workspace_id", "workspace-1"]);
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("access_token_envelope");
  });

  it("decrypts credentials only from the internal credential read", async () => {
    const { encryptEtsySecret, readEtsyTokenEncryptionKey } = await import("../../api/_lib/etsy-token-crypto.js");
    const encryptionKey = readEtsyTokenEncryptionKey();
    database.responses.push({ data: { ...row, access_token_envelope: encryptEtsySecret("access", encryptionKey), refresh_token_envelope: encryptEtsySecret("refresh", encryptionKey) }, error: null });
    const { getEtsyConnectionCredentials } = await import("../../api/_lib/etsy-connection-store.js");
    expect(await getEtsyConnectionCredentials({ workspaceId: "workspace-1" })).toMatchObject({ accessToken: "access", refreshToken: "refresh" });
  });

  it("encrypts token updates and supports reconnect and sync cursor updates", async () => {
    database.responses.push({ data: row, error: null }, { data: row, error: null }, { data: row, error: null });
    const store = await import("../../api/_lib/etsy-connection-store.js");
    await store.updateEtsyTokens({ workspaceId: "workspace-1", accessToken: "new-access", refreshToken: "new-refresh", accessTokenExpiresAt: row.access_token_expires_at, refreshTokenExpiresAt: row.refresh_token_expires_at });
    await store.markEtsyConnectionReconnectRequired({ workspaceId: "workspace-1" });
    await store.updateEtsySyncCursor({ workspaceId: "workspace-1", lastSyncedAt: "2026-07-16T21:00:00.000Z" });
    expect(database.calls[0].payload.access_token_envelope).toBeTypeOf("object");
    expect(database.calls[1].payload.status).toBe("reconnect_required");
    expect(database.calls[2].payload.last_synced_at).toBe("2026-07-16T21:00:00.000Z");
    database.calls.forEach((call) => expect(call.filters).toContainEqual(["eq", "workspace_id", "workspace-1"]));
  });

  it("acquires a lock with one conditional update and reports conflicts", async () => {
    database.responses.push({ data: { workspace_id: "workspace-1" }, error: null }, { data: null, error: null });
    const { acquireEtsyImportLock } = await import("../../api/_lib/etsy-connection-store.js");
    expect(await acquireEtsyImportLock({ workspaceId: "workspace-1", now: new Date("2026-07-16T20:00:00.000Z"), lockToken: "token-a" })).toBe(true);
    expect(await acquireEtsyImportLock({ workspaceId: "workspace-1", now: new Date("2026-07-16T20:00:00.000Z"), lockToken: "token-b" })).toBe(false);
    expect(database.calls[0].payload.import_lock_until).toBe("2026-07-16T20:10:00.000Z");
    expect(database.calls[0].payload.import_lock_token).toBe("token-a");
    expect(database.calls[0].filters).toContainEqual(["or", "import_lock_until.is.null,import_lock_until.lte.2026-07-16T20:00:00.000Z"]);
  });

  it("does not let stale owner A release a lock reacquired by B", async () => {
    database.responses.push(
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: null, error: null },
      { data: { workspace_id: "workspace-1" }, error: null },
    );
    const { acquireEtsyImportLock, releaseEtsyImportLock } = await import("../../api/_lib/etsy-connection-store.js");
    expect(await acquireEtsyImportLock({ workspaceId: "workspace-1", now: new Date("2026-07-16T20:00:00.000Z"), lockToken: "token-a" })).toBe(true);
    expect(await acquireEtsyImportLock({ workspaceId: "workspace-1", now: new Date("2026-07-16T20:11:00.000Z"), lockToken: "token-b" })).toBe(true);
    expect(await releaseEtsyImportLock({ workspaceId: "workspace-1", lockToken: "token-a" })).toBe(false);
    expect(database.calls[2]).toMatchObject({ operation: "update", payload: { import_lock_until: null, import_lock_token: null } });
    expect(database.calls[2].filters).toContainEqual(["eq", "workspace_id", "workspace-1"]);
    expect(database.calls[2].filters).toContainEqual(["eq", "import_lock_token", "token-a"]);
    expect(await releaseEtsyImportLock({ workspaceId: "workspace-1", lockToken: "token-b" })).toBe(true);
    expect(database.calls[3].filters).toContainEqual(["eq", "import_lock_token", "token-b"]);
  });
  it("renews a lease only for its matching owner", async () => {
    database.responses.push(
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: null, error: null },
    );
    const { renewEtsyImportLock } = await import("../../api/_lib/etsy-connection-store.js");
    const now = new Date("2026-07-16T20:05:00.000Z");
    expect(await renewEtsyImportLock({ workspaceId: "workspace-1", lockToken: "token-a", now })).toBe(true);
    expect(database.calls[0].payload).toMatchObject({
      import_lock_until: "2026-07-16T20:15:00.000Z",
      updated_at: "2026-07-16T20:05:00.000Z",
    });
    expect(database.calls[0].filters).toContainEqual(["eq", "import_lock_token", "token-a"]);
    expect(await renewEtsyImportLock({ workspaceId: "workspace-1", lockToken: "stale", now })).toBe(false);
  });


  it("rejects empty lock tokens", async () => {
    const { acquireEtsyImportLock, renewEtsyImportLock, releaseEtsyImportLock } = await import("../../api/_lib/etsy-connection-store.js");
    await expect(acquireEtsyImportLock({ workspaceId: "workspace-1", lockToken: "" })).rejects.toThrow("lockToken is required");
    await expect(releaseEtsyImportLock({ workspaceId: "workspace-1", lockToken: "  " })).rejects.toThrow("lockToken is required");
    await expect(renewEtsyImportLock({ workspaceId: "workspace-1", lockToken: "" })).rejects.toThrow("lockToken is required");
  });
});
