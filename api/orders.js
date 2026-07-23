import { createServerTiming } from "./_lib/server-timing.js";
import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import {
  addOrderGroupsToProductionBatch,
  addOrderItemsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrders,
  updateOrderGroupStatus,
  updateOrderGroupsStatus,
  updateOrderItemStatus,
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

function normalizeStatusFilter(value) {
  const normalized = normalizeString(value);
  return ["open", "skipped", "complete", "all"].includes(normalized) ? normalized : "open";
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

async function loadOrdersResponse({ workspaceId, batchId, statusFilter = "open" }) {
  return listWorkspaceOrders({
    workspaceId,
    activeBatchId: batchId || null,
    statusFilter,
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
  const ordersPayload = Array.isArray(mutationResult?.orders)
    ? { orders: mutationResult.orders }
    : await loadOrdersResponse({
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
  const skippedOrderItemCount = Math.max(0, items.length - importedOrderItemCount);

  res.status(200).json({
    importedOrderItemCount,
    addedOrderItemCount: target === "productionBatch" ? addedOrderItemCount : 0,
    skippedOrderItemCount,
    ...ordersPayload,
  });
}

async function handleAddOrderItemToProductionBatch({ res, auth, body }) {
  const batchId = normalizeString(body.batchId);
  const orderItemId = normalizeString(body.orderItemId);
  const statusFilter = normalizeStatusFilter(body.statusFilter);

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
  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: countIds(mutationResult?.addedOrderItemIds),
    addedOrderItemIds: mutationResult?.addedOrderItemIds || [],
  });
}

async function handleAddOrdersToProductionBatch({ res, auth, body }) {
  const batchId = normalizeString(body.batchId);
  const orderIds = normalizeStringArray(body.orderIds);
  const statusFilter = normalizeStatusFilter(body.statusFilter);

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
  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: countIds(mutationResult?.addedOrderItemIds),
    addedOrderItemIds: mutationResult?.addedOrderItemIds || [],
  });
}

async function handleUpdateOrderItemStatus({ res, auth, body, status, responseStatusFilter }) {
  const batchId = normalizeString(body.batchId);
  const orderItemId = normalizeString(body.orderItemId);

  if (!orderItemId) {
    sendBadRequest(res, "orderItemId is required.");
    return;
  }

  await updateOrderItemStatus({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    orderItemId,
    status,
  });
  const ordersPayload = await loadOrdersResponse({
    workspaceId: auth.workspaceId,
    batchId: batchId || null,
    statusFilter: responseStatusFilter,
  });

  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: 0,
    ...ordersPayload,
  });
}

async function handleUpdateOrderGroupStatus({ res, auth, body, status, responseStatusFilter }) {
  const batchId = normalizeString(body.batchId);
  const orderId = normalizeString(body.orderId);

  if (!orderId) {
    sendBadRequest(res, "orderId is required.");
    return;
  }

  await updateOrderGroupStatus({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    orderId,
    status,
  });
  const ordersPayload = await loadOrdersResponse({
    workspaceId: auth.workspaceId,
    batchId: batchId || null,
    statusFilter: responseStatusFilter,
  });

  res.status(200).json({
    importedOrderItemCount: 0,
    addedOrderItemCount: 0,
    ...ordersPayload,
  });
}

async function handleUpdateOrderGroupsStatus({ res, auth, body, status }) {
  const orderIds = normalizeStringArray(body.orderIds);

  if (!orderIds.length) {
    sendBadRequest(res, "orderIds must include at least one order id.");
    return;
  }

  const mutationResult = await updateOrderGroupsStatus({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    orderIds,
    status,
  });

  res.status(200).json(mutationResult);
}

export default async function handler(req, res) {
  const timing = createServerTiming(res, "orders");
  try {
    const auth = await resolveProductionBatchAuth(req);
    timing.mark("auth");
    req.auth = auth;

    if (req.method === "GET") {
      const batchId = normalizeString(req.query?.batchId);
      const statusFilter = normalizeStatusFilter(req.query?.status);
      const ordersPayload = await loadOrdersResponse({
        workspaceId: auth.workspaceId,
        batchId,
        statusFilter,
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

      if (action === "skipOrderItem") {
        await handleUpdateOrderItemStatus({
          res,
          auth,
          body,
          status: "skipped",
          responseStatusFilter: "skipped",
        });
        return;
      }

      if (action === "reopenOrderItem") {
        await handleUpdateOrderItemStatus({
          res,
          auth,
          body,
          status: "open",
          responseStatusFilter: "open",
        });
        return;
      }

      if (action === "skipOrder") {
        await handleUpdateOrderGroupStatus({
          res,
          auth,
          body,
          status: "skipped",
          responseStatusFilter: "skipped",
        });
        return;
      }

      if (action === "reopenOrder") {
        await handleUpdateOrderGroupStatus({
          res,
          auth,
          body,
          status: "open",
          responseStatusFilter: "open",
        });
        return;
      }

      if (action === "skipOrders") {
        await handleUpdateOrderGroupsStatus({
          res,
          auth,
          body,
          status: "skipped",
          responseStatusFilter: "skipped",
        });
        return;
      }

      if (action === "reopenOrders") {
        await handleUpdateOrderGroupsStatus({
          res,
          auth,
          body,
          status: "open",
          responseStatusFilter: "open",
        });
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
  } finally {
    timing.finish();
  }
}

