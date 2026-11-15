import { createShipStationClient } from "./shipstation-client.js";

const TAG_NAME = "Current Production Batch";
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

/** Reconcile only the app-owned tag; discovery completes before any writes. */
export async function tagProductionBatchInShipStation({ snapshot, client, env = process.env } = {}) {
  if (!Array.isArray(snapshot?.orderItems) || !snapshot.orderItems.length) {
    throw publicError(400, "The production batch is empty. Add orders before tagging ShipStation.");
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
  const addAvailable = shipment => {
    if (shipment.shipment_status !== "cancelled") available.set(shipment.shipment_id, shipment);
  };
  const hasUnresolvedOrders = () => [...groups.values()].some(group => group.shipmentIds.size
    ? [...group.shipmentIds].some(id => !available.has(id))
    : ![...available.values()].some(shipment => orderNumbers(shipment).includes(group.number)));
  const hasNumberOnlyOrders = [...groups.values()].some(group => !group.shipmentIds.size);
  try {
    for await (const shipment of client.iterateShipments({ shipmentStatus: "pending" })) addAvailable(shipment);
    for await (const shipment of client.iterateShipments({ tag: TAG_NAME })) {
      if (hasBatchTag(shipment)) {
        tagged.set(shipment.shipment_id, shipment);
        addAvailable(shipment);
      }
    }
    // Number-only matching must inspect every non-cancelled status to detect
    // ambiguity consistently. Exact-ID batches can stop when all IDs are found.
    for (const shipmentStatus of ["processing", "label_purchased"]) {
      if (!hasNumberOnlyOrders && !hasUnresolvedOrders()) break;
      for await (const shipment of client.iterateShipments({ shipmentStatus })) addAvailable(shipment);
    }
  } catch {
    throw publicError(502, "Unable to read ShipStation orders. No tags were changed. Check the ShipStation connection and try again.");
  }

  const desired = new Set();
  const protectedIds = new Set();
  const matches = [];
  const result = { tagName: TAG_NAME, taggedOrders: 0, removedTags: 0, unmatchedOrders: [], failures: [] };
  for (const group of groups.values()) {
    const candidates = [...available.values()].filter(shipment => orderNumbers(shipment).includes(group.number));
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
