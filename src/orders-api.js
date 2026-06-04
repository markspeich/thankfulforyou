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

function buildOrdersUrl(batchId) {
  const normalizedBatchId = normalizeString(batchId);
  return normalizedBatchId
    ? `/api/orders?batchId=${encodeURIComponent(normalizedBatchId)}`
    : "/api/orders";
}

async function readOrdersResponse(response, fallbackError) {
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || fallbackError);
  }

  return payload;
}

export async function fetchWorkspaceOrders({ batchId = null, accessToken = null } = {}) {
  const response = await fetch(buildOrdersUrl(batchId), {
    headers: buildAuthHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return readOrdersResponse(response, "Unable to load workspace orders.");
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
    }),
  });

  return readOrdersResponse(response, "Unable to add the order item to the production batch.");
}

export async function addOrdersToProductionBatch({
  batchId,
  orderIds,
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
    }),
  });

  return readOrdersResponse(response, "Unable to add orders to the production batch.");
}
