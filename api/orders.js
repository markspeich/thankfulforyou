import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import {
  addOrderGroupsToProductionBatch,
  addOrderItemsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrders,
} from "./_lib/orders-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw Object.assign(new Error("Invalid JSON request body."), {
        statusCode: 400,
        expose: true,
      });
    }
  }

  return req.body;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isJsonObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => normalizeString(item)).filter(Boolean)
    : [];
}

function normalizeItems(value) {
  return Array.isArray(value) ? value : null;
}

function countIds(value, fallback = 0) {
  return Array.isArray(value) ? value.length : fallback;
}

function normalizeCount(value, fallback = 0) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : fallback;
}

function sendBadRequest(res, error) {
  res.status(400).json({ error });
}

async function loadOrdersResponse({ workspaceId, batchId }) {
  return listWorkspaceOrders({
    workspaceId,
    activeBatchId: batchId || null,
  });
}

async function handleImportClipboardItems({ res, auth, body }) {
  const target = normalizeString(body.target) || "orders";
  const batchId = normalizeString(body.batchId);
  const items = normalizeItems(body.items);

  if (target !== "orders" && target !== "productionBatch") {
    sendBadRequest(res, "target must be orders or productionBatch.");
    return;
  }

  if (!items) {
    sendBadRequest(res, "items must be an array.");
    return;
  }

  if (target === "productionBatch" && !batchId) {
    sendBadRequest(res, "batchId is required when importing to a production batch.");
    return;
  }

  const mutationResult = await importWorkspaceOrderItems({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    items,
    target,
    batchId: batchId || null,
  });
  const ordersPayload = await loadOrdersResponse({
    workspaceId: auth.workspaceId,
    batchId: batchId || null,
  });
  const importedOrderItemCount = normalizeCount(
    mutationResult?.importedCount,
    countIds(mutationResult?.importedOrderItemIds, items.length),
  );
  const addedOrderItemCount = normalizeCount(
    mutationResult?.addedToBatchCount,
    countIds(mutationResult?.addedOrderItemIds),
  );

  res.status(200).json({
    importedOrderItemCount,
    addedOrderItemCount: target === "productionBatch" ? addedOrderItemCount : 0,
    ...ordersPayload,
  });
}

async function handleAddOrderItemToProductionBatch({ res, auth, body }) {
  const batchId = normalizeString(body.batchId);
  const orderItemId = normalizeString(body.orderItemId);

  if (!batchId) {
    sendBadRequest(res, "batchId is required.");
    return;
  }

  if (!orderItemId) {
    sendBadRequest(res, "orderItemId is required.");
    return;
  }

  const mutationResult = await addOrderItemsToProductionBatch({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    batchId,
    orderItemIds: [orderItemId],
  });
  const ordersPayload = await loadOrdersResponse({
    workspaceId: auth.workspaceId,
    batchId,
  });

  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: countIds(mutationResult?.addedOrderItemIds),
    ...ordersPayload,
  });
}

async function handleAddOrdersToProductionBatch({ res, auth, body }) {
  const batchId = normalizeString(body.batchId);
  const orderIds = normalizeStringArray(body.orderIds);

  if (!batchId) {
    sendBadRequest(res, "batchId is required.");
    return;
  }

  if (!orderIds.length) {
    sendBadRequest(res, "orderIds must include at least one order id.");
    return;
  }

  const mutationResult = await addOrderGroupsToProductionBatch({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    batchId,
    orderIds,
  });
  const ordersPayload = await loadOrdersResponse({
    workspaceId: auth.workspaceId,
    batchId,
  });

  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: countIds(mutationResult?.addedOrderItemIds),
    ...ordersPayload,
  });
}

export default async function handler(req, res) {
  try {
    const auth = await resolveProductionBatchAuth(req);
    req.auth = auth;

    if (req.method === "GET") {
      const batchId = normalizeString(req.query?.batchId);
      const ordersPayload = await loadOrdersResponse({
        workspaceId: auth.workspaceId,
        batchId,
      });

      res.status(200).json(ordersPayload);
      return;
    }

    if (req.method === "POST") {
      const body = readJsonBody(req);
      if (!isJsonObject(body)) {
        sendBadRequest(res, "Request body must be a JSON object.");
        return;
      }

      const action = normalizeString(body.action);

      if (action === "importClipboardItems") {
        await handleImportClipboardItems({ res, auth, body });
        return;
      }

      if (action === "addOrderItemToProductionBatch") {
        await handleAddOrderItemToProductionBatch({ res, auth, body });
        return;
      }

      if (action === "addOrdersToProductionBatch") {
        await handleAddOrdersToProductionBatch({ res, auth, body });
        return;
      }

      sendBadRequest(res, "Unsupported orders action.");
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    if (error?.statusCode && error?.expose) {
      res.status(error.statusCode).json({
        error: error.message,
      });
      return;
    }

    console.error("Orders API error", error);
    res.status(500).json({
      error: "Unable to process orders request.",
    });
  }
}
