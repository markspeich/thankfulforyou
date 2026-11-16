import { describe, expect, it, vi } from "vitest";
import { tagProductionBatchInShipStation, removeProductionBatchShipStationTags } from "../../api/_lib/production-batch-shipstation.js";

const tagName = "Current Production Batch";
const shipment = (id, order, tags = []) => ({ shipment_id: id, shipment_number: order, tags: tags.map(name => ({ name })) });
function client(pending = [], tagged = []) {
  return {
    async *iterateShipments({ tag } = {}) { yield* tag ? tagged : pending; },
    addShipmentTag: vi.fn().mockResolvedValue(undefined),
    removeShipmentTag: vi.fn().mockResolvedValue(undefined),
  };
}
const snapshot = (...sources) => ({ orderItems: sources.map((source, i) => ({ id: `item-${i}`, source })) });

describe("remove production batch ShipStation tags", () => {
  it("removes only the batch tag across statuses and deduplicates shipments", async () => {
    const tagged = shipment("se-1", "100", [tagName, "Other"]);
    const api = client([], [tagged, tagged, { ...shipment("se-2", "200", [tagName]), shipment_status: "label_purchased" }, shipment("se-other", "300", ["Other"])]);
    expect(await removeProductionBatchShipStationTags({ client: api })).toEqual({ removedTags: 2 });
    expect(api.removeShipmentTag.mock.calls.map(([args]) => args)).toEqual([{ shipmentId: "se-1", tagName }, { shipmentId: "se-2", tagName }]);
    expect(api.addShipmentTag).not.toHaveBeenCalled();
  });

  it("succeeds without writes for an already clean tag set", async () => {
    const api = client();
    expect(await removeProductionBatchShipStationTags({ client: api })).toEqual({ removedTags: 0 });
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("finishes discovery before removal and exposes a safe retry error", async () => {
    const api = client();
    api.iterateShipments = async function* () { yield shipment("se-1", "100", [tagName]); throw new Error("private provider body"); };
    await expect(removeProductionBatchShipStationTags({ client: api })).rejects.toMatchObject({ expose: true, statusCode: 502, message: expect.stringMatching(/batch is still open.*retry/i) });
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("reports partial cleanup failure safely and supports an idempotent retry", async () => {
    let records = [shipment("se-1", "100", [tagName]), shipment("se-2", "200", [tagName])];
    const api = client();
    api.iterateShipments = async function* () { yield* records; };
    api.removeShipmentTag.mockImplementation(async ({ shipmentId }) => {
      if (shipmentId === "se-2") throw new Error("secret");
      records = records.filter(record => record.shipment_id !== shipmentId);
    });
    await expect(removeProductionBatchShipStationTags({ client: api })).rejects.toMatchObject({ expose: true, statusCode: 502, message: expect.stringMatching(/some tags may already.*retry/i) });
    api.removeShipmentTag.mockImplementation(async ({ shipmentId }) => { records = records.filter(record => record.shipment_id !== shipmentId); });
    expect(await removeProductionBatchShipStationTags({ client: api })).toEqual({ removedTags: 1 });
  });

  it("requires credentials before pretending cleanup succeeded", async () => {
    await expect(removeProductionBatchShipStationTags({ env: {} })).rejects.toMatchObject({ expose: true, statusCode: 503, message: expect.stringMatching(/not configured.*batch is still open/i) });
  });
});

describe("tag production batch in ShipStation", () => {
  it("retains the whole-order tag for a remaining sibling and removes only the departed order tag", async () => {
    const sibling = shipment("se-sibling", "100", [tagName, "Urgent"]);
    const departed = shipment("se-departed", "200", [tagName, "Other"]);
    const api = client([sibling], [sibling, departed]);
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100", shipStationShipmentId: "se-sibling" }), client: api });
    expect(result).toEqual({ tagName, taggedOrders: 1, removedTags: 1, unmatchedOrders: [], failures: [] });
    expect(api.removeShipmentTag).toHaveBeenCalledExactlyOnceWith({ shipmentId: "se-departed", tagName });
    expect(api.addShipmentTag).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { orderItems: null }, { orderItems: {} }])("rejects malformed snapshots without allowing empty cleanup", async invalid => {
    const api = client([], [shipment("se-1", "100", [tagName])]);
    api.iterateShipments = vi.fn(api.iterateShipments);
    await expect(tagProductionBatchInShipStation({ snapshot: invalid, client: api })).rejects.toMatchObject({ statusCode: 400 });
    expect(api.iterateShipments).not.toHaveBeenCalled();
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });
  it("never guesses between identical order numbers in different shipment statuses", async () => {
    const api = client();
    api.iterateShipments = async function* ({ shipmentStatus }) {
      if (shipmentStatus === "pending") yield { ...shipment("se-pending", "100"), shipment_status: "pending" };
      if (shipmentStatus === "processing") yield { ...shipment("se-processing", "100"), shipment_status: "processing" };
    };
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }), client: api });
    expect(result.unmatchedOrders).toEqual(["100"]);
    expect(result.taggedOrders).toBe(0);
    expect(api.addShipmentTag).not.toHaveBeenCalled();
  });

  it("matches processing and label-purchased current orders across statuses and excludes cancelled matches", async () => {
    const records = [
      { ...shipment("se-processing", "100"), shipment_status: "processing" },
      { ...shipment("se-purchased", "200"), shipment_status: "label_purchased" },
      { ...shipment("se-cancelled", "100"), shipment_status: "cancelled" },
      { ...shipment("se-cancelled-only", "300"), shipment_status: "cancelled" },
    ];
    const api = client();
    api.iterateShipments = async function* ({ tag, shipmentStatus } = {}) {
      if (tag) return;
      yield* records.filter(record => !shipmentStatus || record.shipment_status === shipmentStatus);
    };
    const result = await tagProductionBatchInShipStation({
      snapshot: snapshot({ orderNumber: "100" }, { orderNumber: "200", shipStationShipmentId: "se-purchased" }, { orderNumber: "300" }), client: api,
    });
    expect(result.taggedOrders).toBe(2);
    expect(result.unmatchedOrders).toEqual(["300"]);
    expect(api.addShipmentTag.mock.calls.map(([args]) => args.shipmentId)).toEqual(["se-processing", "se-purchased"]);
  });

  it("matches Etsy order numbers and Amazon shipment IDs, deduplicates items and removes stale tags", async () => {
    const api = client([shipment("se-1", "100"), shipment("se-2", "amazon")], [shipment("se-old", "old", [tagName, "Other"])]);
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }, { orderNumber: "100" }, { orderNumber: "amazon", shipStationShipmentId: "se-2" }), client: api });
    expect(result).toEqual({ tagName, taggedOrders: 2, removedTags: 1, unmatchedOrders: [], failures: [] });
    expect(api.addShipmentTag.mock.calls.map(([args]) => args)).toEqual([{ shipmentId: "se-1", tagName }, { shipmentId: "se-2", tagName }]);
    expect(api.removeShipmentTag).toHaveBeenCalledExactlyOnceWith({ shipmentId: "se-old", tagName });
  });

  it("reports missing or ambiguous orders without guessing or stripping their existing tags", async () => {
    const ambiguous = shipment("se-b", "same", [tagName]);
    const api = client([shipment("se-a", "same"), ambiguous], [ambiguous]);
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "same" }, { orderNumber: "missing" }), client: api });
    expect(result.unmatchedOrders).toEqual(["same", "missing"]);
    expect(api.addShipmentTag).not.toHaveBeenCalled();
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("counts already tagged orders and does not change unrelated tags", async () => {
    const current = shipment("se-1", "100", [tagName, "Urgent"]);
    const api = client([current], [current]);
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }), client: api });
    expect(result.taggedOrders).toBe(1);
    expect(api.addShipmentTag).not.toHaveBeenCalled();
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("avoids history scans when stored shipment IDs and already tagged non-pending orders satisfy the batch", async () => {
    const current = { ...shipment("se-purchased", "200", [tagName]), shipment_status: "label_purchased" };
    const api = client([shipment("se-pending", "100")], [current]);
    api.iterateShipments = vi.fn(api.iterateShipments);
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100", shipStationShipmentId: "se-pending" }, { orderNumber: "200", shipStationShipmentId: "se-purchased" }), client: api });
    expect(result.taggedOrders).toBe(2);
    expect(result.unmatchedOrders).toEqual([]);
    expect(api.iterateShipments.mock.calls.map(([options]) => options)).toEqual([{ shipmentStatus: "pending" }, { tag: tagName }]);
    expect(api.addShipmentTag).toHaveBeenCalledExactlyOnceWith({ shipmentId: "se-pending", tagName });
  });

  it("makes no writes when a fallback history page cannot be read", async () => {
    const api = client();
    api.iterateShipments = async function* ({ shipmentStatus }) {
      if (shipmentStatus === "pending") yield shipment("se-1", "100");
      if (shipmentStatus === "label_purchased") throw new Error("pagination cap");
    };
    await expect(tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }, { orderNumber: "200" }), client: api })).rejects.toMatchObject({ statusCode: 502, expose: true });
    expect(api.addShipmentTag).not.toHaveBeenCalled();
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("reports sanitized partial addition and cleanup failures", async () => {
    const api = client([shipment("se-1", "100"), shipment("se-2", "200")], [shipment("se-old", "old", [tagName])]);
    api.addShipmentTag.mockRejectedValueOnce(new Error("secret key"));
    api.removeShipmentTag.mockRejectedValueOnce(new Error("private body"));
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }, { orderNumber: "200" }), client: api });
    expect(result.taggedOrders).toBe(1);
    expect(result.failures).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/secret key|private body/);
    expect(result.failures.map(f => f.orderNumber)).toEqual(["100", "old"]);
  });

  it("rejects invalid snapshots before contacting ShipStation", async () => {
    const api = client();
    await expect(tagProductionBatchInShipStation({ snapshot: {}, client: api })).rejects.toMatchObject({ statusCode: 400, expose: true });
    expect(api.removeShipmentTag).not.toHaveBeenCalled();
  });

  it("clears only app-owned tags for an empty saved batch", async () => {
    const api = client([], [shipment("old", "100", [tagName, "Other"])]);
    await expect(tagProductionBatchInShipStation({ snapshot: snapshot(), client: api })).resolves.toEqual({ tagName, taggedOrders: 0, removedTags: 1, unmatchedOrders: [], failures: [] });
    expect(api.removeShipmentTag).toHaveBeenCalledExactlyOnceWith({ shipmentId: "old", tagName });
    expect(api.addShipmentTag).not.toHaveBeenCalled();
  });

  it("uses context-neutral safe errors for failed empty-batch recovery", async () => {
    const api = client();
    api.iterateShipments = async function* () { throw new Error("secret provider body"); };
    await expect(tagProductionBatchInShipStation({ snapshot: snapshot(), client: api })).rejects.toMatchObject({ expose: true, statusCode: 502, message: expect.not.stringMatching(/completion|still open|secret/) });
  });

  it("preserves successful cleanup counts and safe per-order failures for an empty saved batch", async () => {
    const api = client([], [shipment("se-1", "100", [tagName]), shipment("se-2", "200", [tagName])]);
    api.iterateShipments = vi.fn(api.iterateShipments);
    api.removeShipmentTag.mockRejectedValueOnce(new Error("secret upstream payload"));
    const result = await tagProductionBatchInShipStation({ snapshot: snapshot(), client: api });
    expect(result.removedTags).toBe(1);
    expect(result.failures).toEqual([{ orderNumber: "100", message: expect.stringMatching(/Unable to remove/) }]);
    expect(JSON.stringify(result)).not.toMatch(/secret|upstream/);
    expect(api.iterateShipments).toHaveBeenCalledExactlyOnceWith({ tag: tagName });
  });

  it("finishes discovery before mutating tags, so a later page failure makes no changes", async () => {
    const api = client([shipment("se-1", "100")]);
    api.iterateShipments = async function* ({ tag }) { if (tag) throw new Error("page failed"); yield shipment("se-1", "100"); };
    await expect(tagProductionBatchInShipStation({ snapshot: snapshot({ orderNumber: "100" }), client: api })).rejects.toMatchObject({ statusCode: 502, expose: true });
    expect(api.addShipmentTag).not.toHaveBeenCalled();
  });
});
