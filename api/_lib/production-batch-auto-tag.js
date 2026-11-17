import { loadProductionBatch } from "./production-batch-store.js";
import { tagProductionBatchInShipStation } from "./production-batch-shipstation.js";

export function autoTagProductionBatchAdditions(options) {
  return autoTagProductionBatch({ ...options, change: "added to" });
}

export function autoTagProductionBatchRemovals(options) {
  return autoTagProductionBatch({ ...options, change: "removed from", removalsOnly: true });
}

/** Membership is already committed. Tag failures must never fail the saved mutation. */
async function autoTagProductionBatch({ batchId, workspaceId, change, removalsOnly = false }) {
  try {
    if (!batchId || !workspaceId) throw new Error("Saved production batch unavailable.");
    const snapshot = await loadProductionBatch({ batchId, workspaceId });
    if (!snapshot) throw new Error("Saved production batch unavailable.");
    const result = await tagProductionBatchInShipStation(removalsOnly ? { snapshot, removalsOnly } : { snapshot });
    return {
      ...result,
      status: result.unmatchedOrders.length || result.failures.length ? "warning" : "success",
    };
  } catch {
    return {
      status: "warning",
      tagName: "Current Production Batch",
      taggedOrders: 0,
      removedTags: 0,
      unmatchedOrders: [],
      failures: [],
      message: `Orders were ${change} the production batch, but ShipStation tagging could not finish. Use Tag Batch in ShipStation to retry before printing packing slips.`,
    };
  }
}
