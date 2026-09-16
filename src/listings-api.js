function headers(accessToken, extra = {}) {
  return { Accept: "application/json", ...extra, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || fallback), { status: response.status });
  return payload;
}

export async function fetchListings({ id = null, accessToken = null } = {}) {
  const response = await fetch(id ? `/api/listings?id=${encodeURIComponent(id)}` : "/api/listings", { headers: headers(accessToken) });
  return responseJson(response, "Unable to load listing drafts.");
}

export async function importEtsyListing({ source, accessToken = null }) {
  const response = await fetch("/api/listings", { method: "POST", headers: headers(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ action: "import", source }) });
  return responseJson(response, "Unable to import the Etsy listing.");
}

export async function saveListingDraft({ id, revision, changes, accessToken = null }) {
  const response = await fetch("/api/listings", { method: "PATCH", headers: headers(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ id, revision, changes }) });
  return responseJson(response, "Unable to save the listing draft.");
}

export async function runListingAction({ action, id, revision, accessToken = null, ...values }) {
  const response = await fetch("/api/listings", { method: "POST", headers: headers(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ action, id, revision, ...values }) });
  return responseJson(response, "Unable to update the listing draft.");
}

export async function fetchListingCopyPrompt({ accessToken = null } = {}) {
  return responseJson(await fetch("/api/listings?setting=copyPrompt", { headers: headers(accessToken) }), "Unable to load the copy prompt.");
}
export async function saveListingCopyPrompt({ prompt, accessToken = null }) {
  return responseJson(await fetch("/api/listings", { method: "POST", headers: headers(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ action: "saveCopyPrompt", prompt }) }), "Unable to save the copy prompt.");
}
