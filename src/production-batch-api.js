export class ProductionBatchConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ProductionBatchConflictError";
    this.details = details;
  }
}

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

function normalizeConflictDetails(details) {
  if (typeof details !== "string") {
    return details || null;
  }

  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchBatchSession(accessToken = null) {
  const response = await fetch("/api/batch-session", {
    headers: buildAuthHeaders(accessToken, {
      Accept: "application/json",
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the production batch session.");
  }

  return payload;
}

export async function fetchProductionBatchSnapshot(batchId, accessToken = null) {
  const response = await fetch(`/api/production-batch?batchId=${encodeURIComponent(batchId)}`, {
    headers: buildAuthHeaders(accessToken, {
      Accept: "application/json",
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the production batch.");
  }

  return payload;
}

export async function saveProductionBatchSnapshot(snapshot, options = {}) {
  const { keepalive = false, accessToken = null, changedOrderItemIds = null } = options;
  const response = await fetch("/api/production-batch", {
    method: "PUT",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    keepalive,
    body: JSON.stringify({
      snapshot,
      ...(Array.isArray(changedOrderItemIds) ? { changedOrderItemIds } : {}),
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (response.status === 409) {
    throw new ProductionBatchConflictError(
      payload.error || "Revision conflict",
      normalizeConflictDetails(payload.details),
    );
  }

  if (!response.ok) {
    throw new Error(payload.error || "Unable to save the production batch.");
  }

  return payload;
}

export async function archiveProductionBatch(batchId, options = {}) {
  const { accessToken = null } = options;
  const response = await fetch("/api/production-batch", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      action: "archive",
      batchId,
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to archive the production batch.");
  }

  return payload;
}
