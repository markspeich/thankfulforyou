import { createSupabaseAdminClient } from "./supabase-admin.js";

const OUTCOMES = new Set(["imported", "existing", "failed"]);

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} is required.`);
  }
  return value.trim();
}

function nullableString(value, name) {
  if (value == null) return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string.`);
  return value.trim() || null;
}

function nullableJson(value, name) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new TypeError(`${name} must be JSON serializable.`);
  }
}

export async function appendEtsyImportAttempt(input = {}) {
  const outcome = requiredString(input.outcome, "outcome");
  if (!OUTCOMES.has(outcome)) throw new TypeError("outcome must be imported, existing, or failed.");
  const row = {
    run_id: requiredString(input.runId, "runId"),
    workspace_id: requiredString(input.workspaceId, "workspaceId"),
    initiated_by: nullableString(input.initiatedBy, "initiatedBy"),
    order_number: nullableString(input.orderNumber, "orderNumber"),
    transaction_id: nullableString(input.transactionId, "transactionId"),
    listing_id: nullableString(input.listingId, "listingId"),
    outcome,
    stage: requiredString(input.stage, "stage"),
    raw_receipt: nullableJson(input.rawReceipt, "rawReceipt"),
    raw_transaction: nullableJson(input.rawTransaction, "rawTransaction"),
    raw_listing: nullableJson(input.rawListing, "rawListing"),
    raw_image: nullableJson(input.rawImage, "rawImage"),
    normalized_item: nullableJson(input.normalizedItem, "normalizedItem"),
    persistence: nullableJson(input.persistence, "persistence"),
    fetch_errors: nullableJson(input.fetchErrors, "fetchErrors"),
    error: nullableJson(input.error, "error"),
  };
  const { error } = await createSupabaseAdminClient().from("etsy_import_attempts").insert(row);
  if (error) throw error;
}

export async function listEtsyImportAttemptsByOrder({ workspaceId, orderNumber } = {}) {
  const { data, error } = await createSupabaseAdminClient()
    .from("etsy_import_attempts")
    .select("*")
    .eq("workspace_id", requiredString(workspaceId, "workspaceId"))
    .eq("order_number", requiredString(orderNumber, "orderNumber"))
    .order("attempted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
