export async function savePresetDefinition({ preset, previousId = null }) {
  const normalizedPreviousId = typeof previousId === "string" && previousId.trim()
    ? previousId.trim()
    : null;
  const method = normalizedPreviousId ? "PUT" : "POST";
  const response = await fetch("/api/presets", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, previousId: normalizedPreviousId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save preset.");
  }

  return response.json();
}
