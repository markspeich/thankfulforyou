const BASE_URL = "https://openapi.etsy.com/v3/application";
const TIMEOUT_MS = 15000;
const MAX_RETRY_AFTER_MS = 30000;
const MAX_RECEIPT_PAGES = 1000;

export class EtsyApiError extends Error {
  constructor(code) { super("Unable to retrieve Etsy orders."); this.name = "EtsyApiError"; this.code = code; this.category = code; }
}
function retryDelay(value, now) { if (typeof value !== "string" || !value.trim()) return 0; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS); const date = Date.parse(value); return Number.isFinite(date) ? Math.min(Math.max(date - now(), 0), MAX_RETRY_AFTER_MS) : 0; }
function apiKey(env) { const key = env.ETSY_API_KEY_KEYSTRING, secret = env.ETSY_API_SHARED_SECRET; if (!key || !secret) throw new EtsyApiError("invalid_response"); return `${key}:${secret}`; }
function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new EtsyApiError("invalid_response"); return value; }
function usableId(value) { return (typeof value === "string" || typeof value === "number") && String(value).trim() !== ""; }
function optionalType(object, key, type) { return object[key] == null || typeof object[key] === type; }
function assertReceipt(value) { assertObject(value); if (!usableId(value.receipt_id) || !["is_paid", "is_shipped", "is_gift"].every((key) => optionalType(value, key, "boolean")) || !optionalType(value, "status", "string")) throw new EtsyApiError("invalid_response"); return value; }
function assertTransaction(value) { assertObject(value); if (!usableId(value.transaction_id) || !usableId(value.listing_id) || !usableId(value.quantity) || !Array.isArray(value.variations) || value.variations.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new EtsyApiError("invalid_response"); return value; }
function assertListing(value) { assertObject(value); if (!usableId(value.listing_id) || typeof value.title !== "string") throw new EtsyApiError("invalid_response"); return value; }
function assertImage(value) { assertObject(value); if (!["url_75x75", "url_170x135", "url_570xN", "url_fullxfull"].some((key) => typeof value[key] === "string" && value[key].trim())) throw new EtsyApiError("invalid_response"); return value; }

function combinedSignal(callerSignal, timeoutSignal) {
  if (!callerSignal) return { signal: timeoutSignal, cleanup() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of [callerSignal, timeoutSignal]) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
  return { signal: controller.signal, cleanup() { callerSignal.removeEventListener("abort", abort); timeoutSignal.removeEventListener("abort", abort); } };
}

function defaultSleep(ms, signal) { return new Promise((resolve, reject) => { const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); }; const abort = () => { finish(); reject(new EtsyApiError("temporary")); }; const timer = setTimeout(() => { finish(); resolve(); }, ms); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); }); }

export function createEtsyClient({ fetchImpl = fetch, getAccessToken, sleep = defaultSleep, env = process.env, baseUrl = BASE_URL, createTimeoutSignal = () => AbortSignal.timeout(TIMEOUT_MS), now = () => Date.now(), maxReceiptPages = MAX_RECEIPT_PAGES } = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");
  async function wait(ms, signal) {
    if (signal?.aborted) throw new EtsyApiError("temporary");
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(new EtsyApiError("temporary")); signal?.addEventListener("abort", onAbort, { once: true }); });
    try { await Promise.race([Promise.resolve(signal ? sleep(ms, signal) : sleep(ms)), aborted]); } finally { signal?.removeEventListener("abort", onAbort); }
    if (signal?.aborted) throw new EtsyApiError("temporary");
  }
  async function request(path, validate, callerSignal, attempt = 0) {
    if (callerSignal?.aborted) throw new EtsyApiError("temporary");
    let response;
    const combined = combinedSignal(callerSignal, createTimeoutSignal(TIMEOUT_MS));
    try {
      const token = await getAccessToken();
      if (callerSignal?.aborted) throw new EtsyApiError("temporary");
      response = await fetchImpl(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey(env), Accept: "application/json" }, signal: combined.signal });
    } catch {
      if (!callerSignal?.aborted && attempt === 0) return request(path, validate, callerSignal, 1);
      throw new EtsyApiError("temporary");
    } finally { combined.cleanup(); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new EtsyApiError("reauthorize");
      if (response.status === 429) { if (attempt === 0) { await wait(retryDelay(response.headers?.get?.("retry-after"), now), callerSignal); return request(path, validate, callerSignal, 1); } throw new EtsyApiError("rate_limited"); }
      if (response.status >= 500 && attempt === 0) { await wait(0, callerSignal); return request(path, validate, callerSignal, 1); }
      throw new EtsyApiError(response.status >= 500 ? "temporary" : "invalid_response");
    }
    let payload; try { payload = await response.json(); } catch { throw new EtsyApiError("invalid_response"); }
    try { return validate(payload); } catch (error) { if (error instanceof EtsyApiError) throw error; throw new EtsyApiError("invalid_response"); }
  }
  async function listReceipts({ shopId, signal, ...filters }) {
    const results = [], pageSignatures = new Set(); let offset = 0;
    for (let pageNumber = 0; pageNumber < maxReceiptPages; pageNumber += 1) {
      const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value != null)), limit: "100", offset: String(offset) });
      const page = await request(`/shops/${encodeURIComponent(shopId)}/receipts?${query}`, (payload) => { assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); payload.results.forEach(assertReceipt); return payload; }, signal);
      const signature = page.results.map((receipt) => String(receipt.receipt_id)).join("|");
      if (page.results.length === 100 && pageSignatures.has(signature)) throw new EtsyApiError("invalid_response");
      pageSignatures.add(signature); results.push(...page.results); offset += page.results.length;
      if (page.results.length < 100 || (Number.isFinite(Number(page.count)) && offset >= Number(page.count))) return results;
    }
    throw new EtsyApiError("invalid_response");
  }
  const listReceiptTransactions = ({ shopId, receiptId, signal }) => request(`/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}/transactions`, (payload) => { assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); payload.results.forEach(assertTransaction); return payload.results; }, signal);
  const getListing = ({ listingId, signal }) => request(`/listings/${encodeURIComponent(listingId)}`, assertListing, signal);
  const getListingImages = ({ listingId, signal }) => request(`/listings/${encodeURIComponent(listingId)}/images`, (payload) => { assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); payload.results.forEach(assertImage); return payload.results; }, signal);
  return Object.freeze({ listReceipts, listReceiptTransactions, getListing, getListingImages });
}