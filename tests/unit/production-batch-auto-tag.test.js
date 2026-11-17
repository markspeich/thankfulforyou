import { beforeEach, describe, expect, it, vi } from "vitest";

const loadProductionBatch = vi.hoisted(() => vi.fn());
const tagProductionBatchInShipStation = vi.hoisted(() => vi.fn());
vi.mock("../../api/_lib/production-batch-store.js", () => ({ loadProductionBatch }));
vi.mock("../../api/_lib/production-batch-shipstation.js", () => ({ tagProductionBatchInShipStation }));
import { autoTagProductionBatchAdditions, autoTagProductionBatchRemovals } from "../../api/_lib/production-batch-auto-tag.js";

const result = { tagName: "Current Production Batch", taggedOrders: 2, removedTags: 1, unmatchedOrders: [], failures: [] };
beforeEach(() => { vi.clearAllMocks(); });

describe("automatic batch addition tagging", () => {
  it("never attempts discovery or tag cleanup without an explicit saved batch id", async () => {
    const warning = await autoTagProductionBatchRemovals({ batchId: "", workspaceId: "workspace-1" });
    expect(warning.status).toBe("warning");
    expect(loadProductionBatch).not.toHaveBeenCalled();
    expect(tagProductionBatchInShipStation).not.toHaveBeenCalled();
  });
  it("reconciles saved remaining membership after removal and keeps failures safe", async () => {
    const snapshot = { orderItems: [] };
    loadProductionBatch.mockResolvedValue(snapshot);
    tagProductionBatchInShipStation.mockResolvedValue(result);
    await expect(autoTagProductionBatchRemovals({ batchId: "batch-1", workspaceId: "workspace-1" })).resolves.toEqual({ status: "success", ...result });
    expect(tagProductionBatchInShipStation).toHaveBeenCalledWith({ snapshot, removalsOnly: true });
    tagProductionBatchInShipStation.mockRejectedValue(new Error("secret"));
    const warning = await autoTagProductionBatchRemovals({ batchId: "batch-1", workspaceId: "workspace-1" });
    expect(warning.message).toMatch(/removed.*Tag Batch in ShipStation/);
    expect(warning.message).not.toMatch(/added|secret/);
  });
  it("loads authenticated saved membership and reports a successful reconciliation", async () => {
    const snapshot = { batch: { id: "batch-1" }, orderItems: [{ id: "saved" }] };
    loadProductionBatch.mockResolvedValue(snapshot);
    tagProductionBatchInShipStation.mockResolvedValue(result);
    await expect(autoTagProductionBatchAdditions({ batchId: "batch-1", workspaceId: "workspace-1" })).resolves.toEqual({ status: "success", ...result });
    expect(loadProductionBatch).toHaveBeenCalledWith({ batchId: "batch-1", workspaceId: "workspace-1" });
    expect(tagProductionBatchInShipStation).toHaveBeenCalledExactlyOnceWith({ snapshot });
  });
  it.each([
    { unmatchedOrders: ["123"] },
    { failures: [{ orderNumber: "123", message: "Unable to apply the batch tag." }] },
  ])("reports partial reconciliation as a warning without dropping safe details", async partial => {
    loadProductionBatch.mockResolvedValue({ orderItems: [{ id: "saved" }] });
    tagProductionBatchInShipStation.mockResolvedValue({ ...result, ...partial });
    await expect(autoTagProductionBatchAdditions({ batchId: "batch-1", workspaceId: "workspace-1" })).resolves.toEqual({ status: "warning", ...result, ...partial });
  });
  it.each(["load", "tag", "missing"])("turns %s errors into a fixed safe warning after membership has been saved", async stage => {
    loadProductionBatch.mockResolvedValue(stage === "missing" ? null : { orderItems: [] });
    if (stage === "load") loadProductionBatch.mockRejectedValue(new Error("private customer / API secret"));
    if (stage === "tag") tagProductionBatchInShipStation.mockRejectedValue(new Error("upstream secret"));
    const warning = await autoTagProductionBatchAdditions({ batchId: "batch-1", workspaceId: "workspace-1" });
    expect(warning).toMatchObject({ status: "warning", tagName: result.tagName, taggedOrders: 0, removedTags: 0, unmatchedOrders: [], failures: [] });
    expect(warning.message).toContain("Tag Batch in ShipStation");
    expect(JSON.stringify(warning)).not.toMatch(/private|secret|upstream/);
  });
});
