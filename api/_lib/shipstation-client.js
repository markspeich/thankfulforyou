const BASE_URL = "https://api.shipstation.com/v2";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const RETRY_BACKOFF_MS = 250;

export class ShipStationError extends Error {
  constructor(code, { statusCode = null, retryable = false } = {}) {
    super("Unable to communicate with ShipStation.");
    this.name = "ShipStationError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function readShipStationConfig(env = process.env) {
  const apiKey = typeof env?.SHIPSTATION_API_KEY === "string" ? env.SHIPSTATION_API_KEY.trim() : "";
  const amazonStoreId = typeof env?.SHIPSTATION_AMAZON_STORE_ID === "string" ? env.SHIPSTATION_AMAZON_STORE_ID.trim() : "";
  if (!apiKey || !amazonStoreId) throw new ShipStationError("configuration");
  return { apiKey, amazonStoreId };
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShipStationError("invalid_response");
  return value;
}

function assertShipment(value) {
  const shipment = assertObject(value);
  if (typeof shipment.shipment_id !== "string" || !shipment.shipment_id
    || !Array.isArray(shipment.items)
    || !Array.isArray(shipment.tags)
    || !(typeof shipment.notes_to_buyer === "string" || shipment.notes_to_buyer === null)) {
    throw new ShipStationError("invalid_response");
  }
  return shipment;
}

function assertShipmentPage(value) {
  const page = assertObject(value);
  if (!Array.isArray(page.shipments)
    || !Number.isInteger(page.page) || page.page < 1
    || !Number.isInteger(page.pages) || page.pages < 1 || page.page > page.pages) {
    throw new ShipStationError("invalid_response");
  }
  page.shipments.forEach(assertShipment);
  return page;
}

function retryAfterMilliseconds(value, now) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
  if (!Number.isFinite(delay)) return 0;
  return Math.min(Math.max(Math.round(delay), 0), MAX_RETRY_AFTER_MS);
}

function combineSignals(callerSignal, timeoutSignal) {
  if (!callerSignal) return { signal: timeoutSignal, cleanup() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of [callerSignal, timeoutSignal]) {
    if (signal?.aborted) abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      callerSignal.removeEventListener?.("abort", abort);
      timeoutSignal?.removeEventListener?.("abort", abort);
    },
  };
}

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    }
    function done() { cleanup(); resolve(); }
    function abort() { cleanup(); reject(new ShipStationError("aborted")); }
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function createShipStationClient({
  apiKey,
  fetchImpl = fetch,
  sleep = defaultSleep,
  createTimeoutSignal = () => AbortSignal.timeout(TIMEOUT_MS),
  now = () => Date.now(),
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new ShipStationError("configuration");

  async function wait(milliseconds, signal) {
    if (signal?.aborted) throw new ShipStationError("aborted");
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new ShipStationError("aborted"));
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([Promise.resolve(sleep(milliseconds, signal)), aborted]);
    } catch (error) {
      if (error instanceof ShipStationError) throw error;
      throw new ShipStationError("temporary", { retryable: true });
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
    }
    if (signal?.aborted) throw new ShipStationError("aborted");
  }

  async function request({ path, method = "GET", body, signal, validate, emptyResponse = false }) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw new ShipStationError("aborted");
      const combined = combineSignals(signal, createTimeoutSignal(TIMEOUT_MS));
      let response;
      try {
        response = await fetchImpl(`${BASE_URL}${path}`, {
          ...(method === "GET" ? {} : { method }),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers: { "API-Key": apiKey, Accept: "application/json", "Content-Type": "application/json" },
          signal: combined.signal,
        });
      } catch {
        const wasAborted = signal?.aborted || combined.signal?.aborted;
        combined.cleanup();
        if (wasAborted) throw new ShipStationError(signal?.aborted ? "aborted" : "temporary", { retryable: !signal?.aborted });
        if (attempt < MAX_ATTEMPTS - 1) {
          await wait(RETRY_BACKOFF_MS * (2 ** attempt), signal);
          continue;
        }
        throw new ShipStationError("temporary", { retryable: true });
      }

      if (emptyResponse && response.status === 204) {
        combined.cleanup();
        return undefined;
      }
      if (emptyResponse && response.ok) {
        combined.cleanup();
        throw new ShipStationError("invalid_response");
      }
      if (response.ok && !emptyResponse) {
        try {
          const payload = await response.json();
          if (combined.signal?.aborted) throw new ShipStationError(signal?.aborted ? "aborted" : "temporary", { retryable: !signal?.aborted });
          const result = validate(payload);
          combined.cleanup();
          return result;
        } catch (error) {
          combined.cleanup();
          if (error instanceof ShipStationError) throw error;
          if (signal?.aborted || combined.signal?.aborted) throw new ShipStationError(signal?.aborted ? "aborted" : "temporary", { retryable: !signal?.aborted });
          throw new ShipStationError("invalid_response");
        }
      }

      const statusCode = Number.isInteger(response?.status) ? response.status : null;
      const retryable = statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        combined.cleanup();
        throw new ShipStationError(retryable ? (statusCode === 429 ? "rate_limited" : "temporary") : "request_failed", { statusCode, retryable });
      }
      const delay = statusCode === 429
        ? retryAfterMilliseconds(response.headers?.get?.("retry-after"), now)
        : RETRY_BACKOFF_MS * (2 ** attempt);
      combined.cleanup();
      await wait(delay, signal);
    }
    throw new ShipStationError("temporary", { retryable: true });
  }

  async function* iteratePendingShipments({ storeId, signal } = {}) {
    if (typeof storeId !== "string" || !storeId.trim()) throw new ShipStationError("configuration");
    for (let pageNumber = 1; ; pageNumber += 1) {
      const query = new URLSearchParams({ shipment_status: "pending", store_id: storeId, page_size: "100", page: String(pageNumber) });
      const page = await request({ path: `/shipments?${query}`, signal, validate: assertShipmentPage });
      if (page.page !== pageNumber) throw new ShipStationError("invalid_response");
      for (const current of page.shipments) yield current;
      if (pageNumber === page.pages) return;
    }
  }

  function updateNotesToBuyer({ shipmentId, notesToBuyer, signal } = {}) {
    if (typeof shipmentId !== "string" || !shipmentId || typeof notesToBuyer !== "string") throw new ShipStationError("invalid_response");
    return request({ path: `/shipments/${encodeURIComponent(shipmentId)}`, method: "PUT", body: { notes_to_buyer: notesToBuyer }, signal, validate: assertShipment });
  }

  function addShipmentTag({ shipmentId, tagName, signal } = {}) {
    if (typeof shipmentId !== "string" || !shipmentId || typeof tagName !== "string" || !tagName) throw new ShipStationError("invalid_response");
    return request({ path: `/shipments/${encodeURIComponent(shipmentId)}/tags/${encodeURIComponent(tagName)}`, method: "POST", signal, emptyResponse: true });
  }

  return Object.freeze({ iteratePendingShipments, updateNotesToBuyer, addShipmentTag });
}
