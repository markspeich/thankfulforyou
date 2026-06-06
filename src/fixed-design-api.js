async function readJsonOrFallback(response, fallback) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

function buildAuthHeaders(accessToken, headers = {}) {
  return {
    ...headers,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export async function fetchWorkspaceFixedDesigns({ accessToken = null, includeDeleted = false } = {}) {
  const params = new URLSearchParams();
  if (includeDeleted) {
    params.set("includeDeleted", "true");
  }
  const response = await fetch(`/api/fixed-designs${params.size ? `?${params}` : ""}`, {
    headers: buildAuthHeaders(accessToken, { Accept: "application/json" }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load fixed designs.");
  }

  return Array.isArray(payload.fixedDesigns) ? payload.fixedDesigns : [];
}

export async function createWorkspaceFixedDesign(uploadPayload, { accessToken = null } = {}) {
  const response = await fetch("/api/fixed-designs", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(uploadPayload),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to upload fixed design.");
  }

  return payload.fixedDesign;
}

export async function replaceWorkspaceFixedDesign(fixedDesignId, uploadPayload, { accessToken = null } = {}) {
  const response = await fetch(`/api/fixed-designs?fixedDesignId=${encodeURIComponent(fixedDesignId)}`, {
    method: "PUT",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(uploadPayload),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to replace fixed design.");
  }

  return payload.fixedDesign;
}

export async function deleteWorkspaceFixedDesign(fixedDesignId, { accessToken = null } = {}) {
  const response = await fetch(`/api/fixed-designs?fixedDesignId=${encodeURIComponent(fixedDesignId)}`, {
    method: "DELETE",
    headers: buildAuthHeaders(accessToken, { Accept: "application/json" }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to delete fixed design.");
  }

  return payload.fixedDesign;
}
