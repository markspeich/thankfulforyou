async function readJsonOrFallback(response, fallback) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

function buildAuthHeaders(accessToken, headers) {
  return {
    ...headers,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildOrdersUrl(batchId, statusFilter = null, {
  view = null,
  orderId = null,
  batchFilter = null,
  searchTerm = null,
  limit = null,
  cursor = null,
} = {}) {
  const normalizedBatchId = normalizeString(batchId);
  const normalizedStatusFilter = normalizeString(statusFilter);
  const params = new URLSearchParams();
  if (normalizedBatchId) {
    params.set("batchId", normalizedBatchId);
  }
  if (normalizedStatusFilter) {
    params.set("status", normalizedStatusFilter);
  }
  if (normalizeString(view)) {
    params.set("view", normalizeString(view));
  }
  if (normalizeString(orderId)) {
    params.set("orderId", normalizeString(orderId));
  }
  if (normalizeString(batchFilter)) {
    params.set("batch", normalizeString(batchFilter));
  }
  if (normalizeString(searchTerm)) {
    params.set("search", normalizeString(searchTerm));
  }
  if (Number.isInteger(limit)) {
    params.set("limit", String(limit));
  }
  if (normalizeString(cursor)) {
    params.set("cursor", normalizeString(cursor));
  }
  const query = params.toString();
  return query ? `/api/orders?${query}` : "/api/orders";
}

async function readOrdersResponse(response, fallbackError) {
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw Object.assign(new Error(payload.error || fallbackError), { status: response.status });
  }

  return payload;
}

export async function fetchWorkspaceOrders({ batchId = null, statusFilter = null, accessToken = null } = {}) {
  const response = await fetch(buildOrdersUrl(batchId, statusFilter), {
    headers: buildAuthHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return readOrdersResponse(response, "Unable to load workspace orders.");
}

export async function fetchWorkspaceOrderSummaries({
  batchId = null,
  statusFilter = null,
  batchFilter = null,
  searchTerm = null,
  limit = null,
  cursor = null,
  accessToken = null,
  signal = null,
} = {}) {
  const response = await fetch(buildOrdersUrl(batchId, statusFilter, {
    view: "compact",
    batchFilter,
    searchTerm,
    limit,
    cursor,
  }), {
    headers: buildAuthHeaders(accessToken, { Accept: "application/json" }),
    ...(signal ? { signal } : {}),
  });
  return readOrdersResponse(response, "Unable to load workspace order summaries.");
}

export async function fetchWorkspaceOrderDetail({ orderId, batchId = null, accessToken = null } = {}) {
  const response = await fetch(buildOrdersUrl(batchId, null, { view: "detail", orderId }), {
    headers: buildAuthHeaders(accessToken, { Accept: "application/json" }),
  });
  return readOrdersResponse(response, "Unable to load workspace order detail.");
}

export async function importWorkspaceOrders({
  target,
  items,
  batchId = null,
  accessToken = null,
}) {
  const normalizedBatchId = normalizeString(batchId);
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      action: "importClipboardItems",
      target,
      items,
      ...(normalizedBatchId ? { batchId: normalizedBatchId } : {}),
    }),
  });

  return readOrdersResponse(response, "Unable to import workspace orders.");
}

export async function addOrderItemToProductionBatch({
  batchId,
  orderItemId,
  statusFilter = null,
  accessToken = null,
}) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      action: "addOrderItemToProductionBatch",
      batchId,
      orderItemId,
      ...(normalizeString(statusFilter) ? { statusFilter: normalizeString(statusFilter) } : {}),
    }),
  });

  return readOrdersResponse(response, "Unable to add the order item to the production batch.");
}

export async function addOrdersToProductionBatch({
  batchId,
  orderIds,
  statusFilter = null,
  accessToken = null,
}) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      action: "addOrdersToProductionBatch",
      batchId,
      orderIds,
      ...(normalizeString(statusFilter) ? { statusFilter: normalizeString(statusFilter) } : {}),
    }),
  });

  return readOrdersResponse(response, "Unable to add orders to the production batch.");
}

export async function updateOrderItemLifecycleStatus({
  action,
  batchId = null,
  orderItemId,
  orderId,
  orderIds,
  accessToken = null,
}) {
  const normalizedBatchId = normalizeString(batchId);
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      action,
      ...(orderItemId ? { orderItemId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(Array.isArray(orderIds) ? { orderIds } : {}),
      ...(normalizedBatchId ? { batchId: normalizedBatchId } : {}),
    }),
  });

  return readOrdersResponse(response, "Unable to update the order status.");
}

