const CONNECTION_ERROR = "Unable to load Etsy connection.";
const AUTHORIZATION_ERROR = "Unable to connect Etsy shop.";
const IMPORT_ERROR = "Unable to import Etsy orders.";
function authHeaders(accessToken, headers = {}) {
  return { ...headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}
async function jsonOr(response, fallback = {}) {
  try { return await response.json(); } catch { return fallback; }
}
function safeError(payload, fallback) {
  const message = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
  const error = new Error(message);
  if (typeof payload?.code === "string" && payload.code.trim()) error.code = payload.code.trim();
  return error;
}
export async function fetchEtsyConnection({ accessToken = null, signal } = {}) {
  const response = await fetch("/api/etsy-connection", {
    headers: authHeaders(accessToken, { Accept: "application/json" }), signal,
  });
  const payload = await jsonOr(response);
  if (!response.ok) throw safeError(payload, CONNECTION_ERROR);
  return payload;
}
export async function beginEtsyAuthorization({ accessToken = null, signal } = {}) {
  const response = await fetch("/api/etsy-connection", {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ action: "beginAuthorization" }), signal,
  });
  const payload = await jsonOr(response);
  if (!response.ok) throw safeError(payload, AUTHORIZATION_ERROR);
  let url;
  try { url = new URL(payload?.authorizeUrl); } catch { throw new Error(AUTHORIZATION_ERROR); }
  if (url.protocol !== "https:" || !(url.hostname === "etsy.com" || url.hostname.endsWith(".etsy.com"))) throw new Error(AUTHORIZATION_ERROR);
  return payload.authorizeUrl;
}
function parseEvent(line) {
  let event;
  try { event = JSON.parse(line); } catch { throw new Error(IMPORT_ERROR); }
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error(IMPORT_ERROR);
  if (event.type === "error") {
    const error = new Error(typeof event.message === "string" && event.message.trim() ? event.message.trim() : IMPORT_ERROR);
    if (typeof event.code === "string" && event.code.trim()) error.code = event.code.trim();
    throw error;
  }
  return event;
}
export async function importEtsyOrders({ accessToken = null, signal, onEvent = () => {} } = {}) {
  const response = await fetch("/api/etsy-import", {
    method: "POST", headers: authHeaders(accessToken, { Accept: "application/x-ndjson" }), signal,
  });
  if (!response.ok) throw safeError(await jsonOr(response), IMPORT_ERROR);
  if (!response.body?.getReader) throw new Error(IMPORT_ERROR);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.trim()) await onEvent(parseEvent(line));
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      await onEvent(parseEvent(line));
    }
    completed = true;
  } finally {
    if (!completed) {
      try { await reader.cancel(); } catch { /* keep the original error */ }
    }
    reader.releaseLock();
  }
}
