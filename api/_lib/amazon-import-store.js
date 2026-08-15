import {
  buildImportedDesignLineRows,
  buildImportedDesignRow,
  buildImportedOrderItemRow,
} from "./orders-store.js";
import { createSupabaseAdminClient } from "./supabase-admin.js";

const AMAZON_IMPORT_LEASE_MS = 10 * 60 * 1000;

export class AmazonImportStoreError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "AmazonImportStoreError";
    this.code = "amazon_import_store_error";
  }
}

function requireIdentifier(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} is required.`);
  }
  return value;
}

function normalizeNow(now) {
  const value = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("now must be a valid date.");
  }
  return value;
}

function throwDatabaseError(error, message) {
  if (error) {
    throw new AmazonImportStoreError(message, { cause: error });
  }
}

function validateIdArray(value) {
  return Array.isArray(value)
    && value.every((id) => typeof id === "string" && Boolean(id.trim()))
    && new Set(value).size === value.length;
}

function validateImportResult(data, requestedIds) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !validateIdArray(data.importedOrderItemIds)
    || !validateIdArray(data.existingOrderItemIds)) {
    throw new AmazonImportStoreError("Amazon import database returned an invalid response.");
  }

  const importedIds = new Set(data.importedOrderItemIds);
  const existingIds = new Set(data.existingOrderItemIds);
  const requestedIdSet = new Set(requestedIds);
  const returnedIds = [...data.importedOrderItemIds, ...data.existingOrderItemIds];
  if (data.existingOrderItemIds.some((id) => importedIds.has(id))
    || returnedIds.length !== requestedIds.length
    || returnedIds.some((id) => !requestedIdSet.has(id))
    || requestedIds.some((id) => !importedIds.has(id) && !existingIds.has(id))) {
    throw new AmazonImportStoreError("Amazon import database returned an invalid response.");
  }

  return {
    importedOrderItemIds: [...data.importedOrderItemIds],
    existingOrderItemIds: [...data.existingOrderItemIds],
  };
}

function buildTransactionalItem(item, context) {
  const orderItem = buildImportedOrderItemRow(item, context);
  delete orderItem.etsy_import_diagnostics;

  return {
    orderItem,
    design: buildImportedDesignRow(item, context),
    lines: buildImportedDesignLineRows(item),
  };
}

export async function acquireAmazonImportLock({
  workspaceId,
  lockToken,
  now = new Date(),
}) {
  const normalizedWorkspaceId = requireIdentifier(workspaceId, "workspaceId");
  const normalizedLockToken = requireIdentifier(lockToken, "lockToken");
  const current = normalizeNow(now);
  const currentIso = current.toISOString();
  const lockUntil = new Date(current.getTime() + AMAZON_IMPORT_LEASE_MS).toISOString();
  const supabase = createSupabaseAdminClient();

  const { error: stateError } = await supabase
    .from("amazon_import_state")
    .upsert(
      { workspace_id: normalizedWorkspaceId },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );
  throwDatabaseError(stateError, "Unable to acquire Amazon import lock.");

  const { data, error } = await supabase
    .from("amazon_import_state")
    .update({
      import_lock_token: normalizedLockToken,
      import_lock_until: lockUntil,
      updated_at: currentIso,
    })
    .eq("workspace_id", normalizedWorkspaceId)
    .or(`import_lock_until.is.null,import_lock_until.lte.${currentIso}`)
    .select("workspace_id")
    .maybeSingle();
  throwDatabaseError(error, "Unable to acquire Amazon import lock.");
  return Boolean(data);
}

export async function renewAmazonImportLock({
  workspaceId,
  lockToken,
  now = new Date(),
}) {
  const normalizedWorkspaceId = requireIdentifier(workspaceId, "workspaceId");
  const normalizedLockToken = requireIdentifier(lockToken, "lockToken");
  const current = normalizeNow(now);
  const currentIso = current.toISOString();
  const lockUntil = new Date(current.getTime() + AMAZON_IMPORT_LEASE_MS).toISOString();

  const { data, error } = await createSupabaseAdminClient()
    .from("amazon_import_state")
    .update({
      import_lock_until: lockUntil,
      updated_at: currentIso,
    })
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("import_lock_token", normalizedLockToken)
    .gt("import_lock_until", currentIso)
    .select("workspace_id")
    .maybeSingle();
  throwDatabaseError(error, "Unable to renew Amazon import lock.");
  return Boolean(data);
}

export async function releaseAmazonImportLock({ workspaceId, lockToken }) {
  const normalizedWorkspaceId = requireIdentifier(workspaceId, "workspaceId");
  const normalizedLockToken = requireIdentifier(lockToken, "lockToken");

  const { data, error } = await createSupabaseAdminClient()
    .from("amazon_import_state")
    .update({
      import_lock_until: null,
      import_lock_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("import_lock_token", normalizedLockToken)
    .select("workspace_id")
    .maybeSingle();
  throwDatabaseError(error, "Unable to release Amazon import lock.");
  return Boolean(data);
}

export async function importAmazonOrderItemsTransactional({
  workspaceId,
  userId,
  items,
}) {
  const normalizedWorkspaceId = requireIdentifier(workspaceId, "workspaceId");
  if (userId != null) {
    requireIdentifier(userId, "userId");
  }
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array.");
  }

  const context = { workspaceId: normalizedWorkspaceId, userId: userId || null };
  const payload = items.map((item) => buildTransactionalItem(item, context));
  const requestedIds = payload.map(({ orderItem }) => orderItem.id);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new AmazonImportStoreError(
      "Amazon import items must have unique order item IDs.",
    );
  }
  const { data, error } = await createSupabaseAdminClient().rpc("import_amazon_order_items", {
    p_workspace_id: normalizedWorkspaceId,
    p_user_id: userId || null,
    p_items: payload,
  });
  throwDatabaseError(error, "Unable to import Amazon order items.");
  return validateImportResult(data, requestedIds);
}
