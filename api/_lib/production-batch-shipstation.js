import { createShipStationClient } from "./shipstation-client.js";

const TAG_NAME = "Current Production Batch";
// Assumption: a batch order with a purchased label was created within this window.
export const LABEL_PURCHASED_LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const publicError = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose: true });

function orderNumbers(shipment) {
  return [...new Set([shipment.amazon_order_id, shipment.shipment_number, shipment.external_order_id,
    shipment.order_number, shipment.external_shipment_id].map(text).filter(Boolean))];
}

function hasBatchTag(shipment) {
  return shipment.tags?.some(tag => (typeof tag === "string" ? tag : tag?.name) === TAG_NAME);
}

/** Clear the app-owned tag before completion; collect every page before writes. */
export async function removeProductionBatchShipStationTags({ client, env = process.env } = {}) {
  if (!client) {
    const apiKey = text(env.SHIPSTATION_API_KEY);
    if (!apiKey) throw publicError(503, "ShipStation is not configured. The batch is still open. Configure the ShipStation API key and retry completion.");
    client = createShipStationClient({ apiKey });
  }
  const shipments = new Set();
  try {
    for await (const shipment of client.iterateShipments({ tag: TAG_NAME })) {
      if (hasBatchTag(shipment)) shipments.add(shipment.shipment_id);
    }
  } catch {
    throw publicError(502, "Unable to read ShipStation batch tags. The batch is still open and no tags were changed. Check the connection and retry completion.");
  }
  let removedTags = 0;
  for (const shipmentId of shipments) {
    try {
      await client.removeShipmentTag({ shipmentId, tagName: TAG_NAME });
      removedTags += 1;
    } catch {
      throw publicError(502, "Unable to remove all ShipStation batch tags. The batch is still open; some tags may already be removed. Check the connection and retry completion.");
    }
  }
  return { removedTags };
}

/**
 * After a removal, only stale tags can need changing, so read just the tagged
 * shipments. A tag is kept whenever it could still belong to a batch order.
 */
async function removeDepartedTags({ client, groups }) {
  const tagged = [];
  try {
    for await (const shipment of client.iterateShipments({ tag: TAG_NAME })) {
      if (hasBatchTag(shipment)) tagged.push(shipment);
    }
  } catch {
    throw publicError(502, "Unable to read ShipStation orders. No tags were changed. Check the ShipStation connection and try again.");
  }
  const result = { tagName: TAG_NAME, taggedOrders: 0, removedTags: 0, unmatchedOrders: [], failures: [] };
  const belongs = shipment => [...groups.values()].some(group => group.shipmentIds.has(shipment.shipment_id)
    || orderNumbers(shipment).includes(group.number));
  for (const group of groups.values()) {
    if (tagged.some(shipment => group.shipmentIds.has(shipment.shipment_id) || orderNumbers(shipment).includes(group.number))) {
      result.taggedOrders += 1;
    }
  }
  const seen = new Set();
  for (const shipment of tagged) {
    if (seen.has(shipment.shipment_id) || belongs(shipment)) continue;
    seen.add(shipment.shipment_id);
    try {
      await client.removeShipmentTag({ shipmentId: shipment.shipment_id, tagName: TAG_NAME });
      result.removedTags += 1;
    } catch {
      result.failures.push({ orderNumber: orderNumbers(shipment)[0] || shipment.shipment_id, message: "Unable to remove an old batch tag. Retry before printing packing slips." });
    }
  }
  return result;
}

/**
 * Reconcile only the app-owned tag; discovery completes before any writes.
 * `removalsOnly` skips order discovery and only clears tags of departed orders.
 */
export async function tagProductionBatchInShipStation({ snapshot, client, env = process.env, removalsOnly = false, now = Date.now } = {}) {
  if (!Array.isArray(snapshot?.orderItems)) {
    throw publicError(400, "A valid saved production batch is required to update ShipStation tags.");
  }
  if (!client) {
    const apiKey = text(env.SHIPSTATION_API_KEY);
    if (!apiKey) throw publicError(503, "ShipStation is not configured. Configure the ShipStation API key and try again.");
    client = createShipStationClient({ apiKey });
  }

  const groups = new Map();
  for (const item of snapshot.orderItems) {
    const number = text(item.source?.orderNumber);
    const shipmentId = text(item.source?.shipStationShipmentId);
    const key = number || shipmentId || `Item ${text(item.id) || groups.size + 1}`;
    if (!groups.has(key)) groups.set(key, { number: number || key, shipmentIds: new Set() });
    if (shipmentId) groups.get(key).shipmentIds.add(shipmentId);
  }

  const available = new Map();
  const tagged = new Map();
  // Shipments found only through the label-purchased fallback. Active
  // (pending/processing/tagged) matches always win over these.
  const historyIds = new Set();
  const addAvailable = (shipment, { history = false } = {}) => {
    if (shipment.shipment_status === "cancelled") return;
    if (history && available.has(shipment.shipment_id)) return;
    available.set(shipment.shipment_id, shipment);
    if (history) historyIds.add(shipment.shipment_id);
  };
  const hasUnresolvedOrders = () => [...groups.values()].some(group => group.shipmentIds.size
    ? [...group.shipmentIds].some(id => !available.has(id))
    : ![...available.values()].some(shipment => orderNumbers(shipment).includes(group.number)));
  const hasNumberOnlyOrders = [...groups.values()].some(group => !group.shipmentIds.size);

  if (removalsOnly) return removeDepartedTags({ client, groups });

  try {
    if (groups.size) {
      for await (const shipment of client.iterateShipments({ shipmentStatus: "pending" })) addAvailable(shipment);
    }
    for await (const shipment of client.iterateShipments({ tag: TAG_NAME })) {
      if (hasBatchTag(shipment)) {
        tagged.set(shipment.shipment_id, shipment);
        addAvailable(shipment);
      }
    }
    // Number-only matching inspects every active status to detect ambiguity.
    // Exact-ID batches can stop as soon as all IDs are found.
    if (hasNumberOnlyOrders || hasUnresolvedOrders()) {
      for await (const shipment of client.iterateShipments({ shipmentStatus: "processing" })) addAvailable(shipment);
    }
    // Label-purchased is the whole shipping history, so only read it as a
    // bounded fallback when an order is still missing from active shipments.
    if (hasUnresolvedOrders()) {
      const createdAtStart = new Date(now() - LABEL_PURCHASED_LOOKBACK_DAYS * DAY_MS).toISOString();
      for await (const shipment of client.iterateShipments({ shipmentStatus: "label_purchased", createdAtStart })) {
        addAvailable(shipment, { history: true });
      }
    }
  } catch {
    throw publicError(502, "Unable to read ShipStation orders. No tags were changed. Check the ShipStation connection and try again.");
  }

  const desired = new Set();
  const protectedIds = new Set();
  const matches = [];
  const result = { tagName: TAG_NAME, taggedOrders: 0, removedTags: 0, unmatchedOrders: [], failures: [] };
  for (const group of groups.values()) {
    const allCandidates = [...available.values()].filter(shipment => orderNumbers(shipment).includes(group.number));
    const activeCandidates = allCandidates.filter(shipment => !historyIds.has(shipment.shipment_id));
    const candidates = activeCandidates.length ? activeCandidates : allCandidates;
    let ids;
    if (group.shipmentIds.size) {
      ids = [...group.shipmentIds].filter(id => available.has(id));
      if (ids.length !== group.shipmentIds.size) ids = [];
    } else if (candidates.length === 1) {
      ids = [candidates[0].shipment_id];
    } else {
      ids = [];
    }
    if (!ids.length) {
      result.unmatchedOrders.push(group.number);
      // Do not remove an existing tag when this order cannot be resolved safely.
      for (const shipment of [...candidates, ...tagged.values()]) {
        if (group.shipmentIds.has(shipment.shipment_id) || orderNumbers(shipment).includes(group.number)) protectedIds.add(shipment.shipment_id);
      }
      continue;
    }
    ids.forEach(id => desired.add(id));
    matches.push({ ...group, ids });
  }

  const successfullyTagged = new Set();
  for (const match of matches) {
    let complete = true;
    for (const shipmentId of match.ids) {
      if (successfullyTagged.has(shipmentId)) continue;
      try {
        if (!hasBatchTag(available.get(shipmentId))) await client.addShipmentTag({ shipmentId, tagName: TAG_NAME });
        successfullyTagged.add(shipmentId);
      } catch {
        complete = false;
        result.failures.push({ orderNumber: match.number, message: "Unable to apply the batch tag. Retry before printing packing slips." });
      }
    }
    if (complete) result.taggedOrders += 1;
  }

  for (const [shipmentId, shipment] of tagged) {
    if (desired.has(shipmentId) || protectedIds.has(shipmentId)) continue;
    try {
      await client.removeShipmentTag({ shipmentId, tagName: TAG_NAME });
      result.removedTags += 1;
    } catch {
      result.failures.push({ orderNumber: orderNumbers(shipment)[0] || shipmentId, message: "Unable to remove an old batch tag. Retry before printing packing slips." });
    }
  }
  return result;
}
