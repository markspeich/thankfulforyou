const CONNECTION_ERROR = "Unable to load Etsy connection.";
const AUTHORIZATION_ERROR = "Unable to connect Etsy shop.";
const IMPORT_ERROR = "Unable to import Etsy orders.";
const MAX_NDJSON_RECORD_LENGTH = 256 * 1024;
function authHeaders(accessToken, headers = {}) {
  return { ...headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}
async function jsonOr(response, fallback = {}) {
  try { return await response.json(); } catch { return fallback; }
}
function safeError(payload, fallback, status = null) {
  const message = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
  const error = new Error(message);
  if (typeof payload?.code === "string" && payload.code.trim()) error.code = payload.code.trim();
  if (Number.isInteger(status)) error.status = status;
  return error;
}
export async function fetchEtsyConnection({ accessToken = null, signal } = {}) {
  const response = await fetch("/api/etsy-connection", {
    headers: authHeaders(accessToken, { Accept: "application/json" }), signal,
  });
  const payload = await jsonOr(response);
  if (!response.ok) throw safeError(payload, CONNECTION_ERROR, response.status);
  return payload;
}
export async function beginEtsyAuthorization({ accessToken = null, signal } = {}) {
  const response = await fetch("/api/etsy-connection", {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ action: "beginAuthorization" }), signal,
  });
  const payload = await jsonOr(response);
  if (!response.ok) throw safeError(payload, AUTHORIZATION_ERROR, response.status);
  let url;
  try { url = new URL(payload?.authorizeUrl); } catch { throw new Error(AUTHORIZATION_ERROR); }
  if (url.origin !== "https://www.etsy.com"
    || url.pathname !== "/oauth/connect"
    || url.username
    || url.password
    || url.port) {
    throw new Error(AUTHORIZATION_ERROR);
  }
  return url.href;
}
function isCount(value) {
  return Number.isInteger(value) && value >= 0 && Number.isFinite(value);
}
function parseEvent(line) {
  let event;
  try { event = JSON.parse(line); } catch { throw new Error(IMPORT_ERROR); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error(IMPORT_ERROR);
  if (event.type === "progress") {
    if (event.stage === "fetching_receipts") {
      if (!isCount(event.processed) || event.total !== null) throw new Error(IMPORT_ERROR);
      return event;
    }
    if (event.stage === "importing_items") {
      if (!isCount(event.processed) || !isCount(event.total) || event.processed > event.total) {
        throw new Error(IMPORT_ERROR);
      }
      return event;
    }
    throw new Error(IMPORT_ERROR);
  }
  if (event.type === "complete") {
    if (!["imported", "existing", "customizationNeeded", "failed"].every((key) => isCount(event[key]))) {
      throw new Error(IMPORT_ERROR);
    }
    return event;
  }
  if (event.type === "error") {
    if (typeof event.code !== "string" || !event.code.trim()
      || typeof event.message !== "string" || !event.message.trim()) {
      throw new Error(IMPORT_ERROR);
    }
    const error = new Error(event.message.trim());
    error.code = event.code.trim();
    throw error;
  }
  throw new Error(IMPORT_ERROR);
}
export async function importEtsyOrders({ accessToken = null, signal, onEvent = () => {} } = {}) {
  const response = await fetch("/api/etsy-import", {
    method: "POST", headers: authHeaders(accessToken, { Accept: "application/x-ndjson" }), signal,
  });
  if (!response.ok) throw safeError(await jsonOr(response), IMPORT_ERROR, response.status);
  if (!response.body?.getReader) throw new Error(IMPORT_ERROR);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  let terminalSeen = false;
  const notify = async (line) => {
    if (terminalSeen) throw new Error(IMPORT_ERROR);
    const event = parseEvent(line);
    if (event.type === "complete") terminalSeen = true;
    await onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = pending.indexOf("\n")) !== -1) {
        const rawLine = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        if (rawLine.length > MAX_NDJSON_RECORD_LENGTH) throw new Error(IMPORT_ERROR);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.trim()) await notify(line);
      }
      if (pending.length > MAX_NDJSON_RECORD_LENGTH) throw new Error(IMPORT_ERROR);
    }
    pending += decoder.decode();
    if (pending.length > MAX_NDJSON_RECORD_LENGTH) throw new Error(IMPORT_ERROR);
    if (pending.trim()) {
      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      await notify(line);
    }
    if (!terminalSeen) throw new Error(IMPORT_ERROR);
    completed = true;
  } finally {
    if (!completed) {
      try { await reader.cancel(); } catch { /* keep the original error */ }
    }
    reader.releaseLock();
  }
}
