import { loadProductionBatch } from "./production-batch-store.js";
import { tagProductionBatchInShipStation } from "./production-batch-shipstation.js";

/** Membership is already committed. Tag failures must never turn an addition into a failed request. */
export async function autoTagProductionBatchAdditions({ batchId, workspaceId }) {
  try {
    const snapshot = await loadProductionBatch({ batchId, workspaceId });
    if (!snapshot) throw new Error("Saved production batch unavailable.");
    const result = await tagProductionBatchInShipStation({ snapshot });
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
      message: "Orders were added to the production batch, but ShipStation tagging could not finish. Use Tag Batch in ShipStation to retry before printing packing slips.",
    };
  }
}
