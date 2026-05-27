export class SharedQueueConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SharedQueueConflictError";
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

export async function fetchSharedSession() {
  const response = await fetch("/api/shared-session", {
    headers: {
      Accept: "application/json",
    },
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the shared queue session.");
  }

  return payload;
}

export async function fetchSharedQueueSnapshot(queueId) {
  const response = await fetch(`/api/shared-queue?queueId=${encodeURIComponent(queueId)}`, {
    headers: {
      Accept: "application/json",
    },
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the shared queue.");
  }

  return payload;
}

export async function saveSharedQueueSnapshot(snapshot, options = {}) {
  const { keepalive = false } = options;
  const response = await fetch("/api/shared-queue", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    keepalive,
    body: JSON.stringify({ snapshot }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (response.status === 409) {
    throw new SharedQueueConflictError(payload.error || "Revision conflict", payload.details || null);
  }

  if (!response.ok) {
    throw new Error(payload.error || "Unable to save the shared queue.");
  }

  return payload;
}
