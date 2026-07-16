import { createSupabaseAdminClient } from "./supabase-admin.js";
import { decryptEtsySecret, encryptEtsySecret, readEtsyTokenEncryptionKey } from "./etsy-token-crypto.js";

const STATUS_COLUMNS = "workspace_id, etsy_user_id, etsy_shop_id, etsy_shop_name, scopes, status, access_token_expires_at, refresh_token_expires_at, last_synced_at, import_lock_until, created_at, updated_at";
const CREDENTIAL_COLUMNS = `${STATUS_COLUMNS}, access_token_envelope, refresh_token_envelope`;

function check(error) { if (error) throw error; }
function status(row) {
  if (!row) return null;
  return { workspaceId: row.workspace_id, etsyUserId: row.etsy_user_id, etsyShopId: row.etsy_shop_id, etsyShopName: row.etsy_shop_name, scopes: row.scopes || [], status: row.status, accessTokenExpiresAt: row.access_token_expires_at, refreshTokenExpiresAt: row.refresh_token_expires_at, lastSyncedAt: row.last_synced_at, importLockUntil: row.import_lock_until, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function update(workspaceId, payload, columns = STATUS_COLUMNS) {
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").update({ ...payload, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).select(columns).maybeSingle();
  check(error); return data;
}

function requireLockToken(lockToken) {
  if (typeof lockToken !== "string" || !lockToken.trim()) {
    throw new Error("lockToken is required.");
  }
  return lockToken;
}

export async function saveEtsyConnection({ workspaceId, etsyUserId, etsyShopId, etsyShopName = null, scopes = [], accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }) {
  const key = readEtsyTokenEncryptionKey();
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").upsert({ workspace_id: workspaceId, etsy_user_id: etsyUserId, etsy_shop_id: etsyShopId, etsy_shop_name: etsyShopName, scopes, status: "connected", access_token_envelope: encryptEtsySecret(accessToken, key), refresh_token_envelope: encryptEtsySecret(refreshToken, key), access_token_expires_at: accessTokenExpiresAt, refresh_token_expires_at: refreshTokenExpiresAt, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" }).select(STATUS_COLUMNS).maybeSingle();
  check(error); return status(data);
}

export async function getEtsyConnection({ workspaceId }) {
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").select(STATUS_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  check(error); return status(data);
}

export async function getEtsyConnectionCredentials({ workspaceId }) {
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").select(CREDENTIAL_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  check(error); if (!data) return null;
  const key = readEtsyTokenEncryptionKey();
  return { ...status(data), accessToken: decryptEtsySecret(data.access_token_envelope, key), refreshToken: decryptEtsySecret(data.refresh_token_envelope, key) };
}

export async function updateEtsyTokens({ workspaceId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }) {
  const key = readEtsyTokenEncryptionKey();
  return status(await update(workspaceId, { access_token_envelope: encryptEtsySecret(accessToken, key), refresh_token_envelope: encryptEtsySecret(refreshToken, key), access_token_expires_at: accessTokenExpiresAt, refresh_token_expires_at: refreshTokenExpiresAt, status: "connected" }));
}
export async function markEtsyConnectionReconnectRequired({ workspaceId }) { return status(await update(workspaceId, { status: "reconnect_required" })); }
export async function updateEtsySyncCursor({ workspaceId, lastSyncedAt }) { return status(await update(workspaceId, { last_synced_at: lastSyncedAt })); }

export async function acquireEtsyImportLock({ workspaceId, now = new Date(), lockToken }) {
  const token = requireLockToken(lockToken);
  const current = now instanceof Date ? now : new Date(now);
  const currentIso = current.toISOString();
  const lockUntil = new Date(current.getTime() + 600_000).toISOString();
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").update({ import_lock_until: lockUntil, import_lock_token: token, updated_at: currentIso }).eq("workspace_id", workspaceId).or(`import_lock_until.is.null,import_lock_until.lte.${currentIso}`).select("workspace_id").maybeSingle();
  check(error); return Boolean(data);
}

export async function releaseEtsyImportLock({ workspaceId, lockToken }) {
  const token = requireLockToken(lockToken);
  const { data, error } = await createSupabaseAdminClient().from("etsy_connections").update({ import_lock_until: null, import_lock_token: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("import_lock_token", token).select("workspace_id").maybeSingle();
  check(error);
  return Boolean(data);
}
