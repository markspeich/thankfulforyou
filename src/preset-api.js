export const REMOTE_PRESET_WORKSPACE_KEY = "primary";

export async function fetchRemotePresetSnapshot() {
  const response = await fetch(`/api/preset-snapshot?workspaceKey=${encodeURIComponent(REMOTE_PRESET_WORKSPACE_KEY)}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to load the saved preset snapshot.");
  }

  const payload = await response.json();
  return payload?.snapshot ?? null;
}

export async function savePresetSnapshot(snapshot) {
  const response = await fetch("/api/preset-snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceKey: REMOTE_PRESET_WORKSPACE_KEY,
      snapshot,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save preset snapshot.");
  }

  return response.json();
}
