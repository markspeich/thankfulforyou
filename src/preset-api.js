export async function savePresetDefinition({ preset, previousId = null }) {
  const method = previousId ? "PUT" : "POST";
  const response = await fetch("/api/presets", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, previousId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save preset.");
  }

  return response.json();
}
