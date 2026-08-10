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

export async function fetchWorkspaceFonts({ accessToken = null, includeArchived = false } = {}) {
  const params = new URLSearchParams();
  if (includeArchived) {
    params.set("includeArchived", "true");
  }
  const response = await fetch(`/api/fonts${params.size ? `?${params}` : ""}`, {
    headers: buildAuthHeaders(accessToken, { Accept: "application/json" }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load fonts.");
  }

  return Array.isArray(payload.fonts) ? payload.fonts : [];
}

export async function createWorkspaceFont(uploadPayload, { accessToken = null } = {}) {
  const response = await fetch("/api/fonts", {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(uploadPayload),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to upload font.");
  }

  return payload.font;
}

export async function replaceWorkspaceFont(fontId, uploadPayload, { accessToken = null } = {}) {
  const response = await fetch(`/api/fonts?fontId=${encodeURIComponent(fontId)}`, {
    method: "PUT",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(uploadPayload),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to replace font.");
  }

  return payload.font;
}

export async function updateWorkspaceFontSettings(fontId, settingsPayload, { accessToken = null } = {}) {
  const response = await fetch(`/api/fonts?fontId=${encodeURIComponent(fontId)}`, {
    method: "PATCH",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(settingsPayload),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to update font settings.");
  }

  return payload.font;
}

export async function archiveWorkspaceFont(fontId, { accessToken = null } = {}) {
  const response = await fetch(`/api/fonts?fontId=${encodeURIComponent(fontId)}`, {
    method: "PATCH",
    headers: buildAuthHeaders(accessToken, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ lifecycle: "archive" }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to archive font.");
  }

  return payload.font;
}

export async function restoreWorkspaceFont(fontId, { accessToken = null } = {}) {
  const response = await fetch(`/api/fonts?fontId=${encodeURIComponent(fontId)}`, {
    method: "PATCH", headers: buildAuthHeaders(accessToken, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ lifecycle: "restore" }),
  });
  const payload = await readJsonOrFallback(response, {});
  if (!response.ok) throw new Error(payload.error || "Unable to restore font.");
  return payload.font;
}
