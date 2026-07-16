const BASE_URL = "https://openapi.etsy.com/v3/application";
const TIMEOUT_MS = 15000;
const MAX_RETRY_AFTER_MS = 30000;

export class EtsyApiError extends Error {
  constructor(code) {
    super("Unable to retrieve Etsy orders.");
    this.name = "EtsyApiError";
    this.code = code;
    this.category = code;
  }
}

function retryDelay(value, now) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(date - now(), 0), MAX_RETRY_AFTER_MS) : 0;
}

function apiKey(env) {
  const key = env.ETSY_API_KEY_KEYSTRING;
  const secret = env.ETSY_API_SHARED_SECRET;
  if (!key || !secret) throw new EtsyApiError("invalid_response");
  return `${key}:${secret}`;
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EtsyApiError("invalid_response");
  return value;
}

function usableId(value) { return (typeof value === "string" || typeof value === "number") && String(value).trim() !== ""; }
function optionalType(object, key, type) { return object[key] == null || typeof object[key] === type; }
function assertReceipt(value) { assertObject(value); if (!usableId(value.receipt_id) || !["is_paid", "is_shipped", "is_gift"].every((key) => optionalType(value, key, "boolean")) || !optionalType(value, "status", "string")) throw new EtsyApiError("invalid_response"); return value; }
function assertTransaction(value) { assertObject(value); if (!usableId(value.transaction_id) || !usableId(value.listing_id) || !usableId(value.quantity) || !Array.isArray(value.variations) || value.variations.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new EtsyApiError("invalid_response"); return value; }
function assertListing(value) { assertObject(value); if (!usableId(value.listing_id) || typeof value.title !== "string") throw new EtsyApiError("invalid_response"); return value; }
function assertImage(value) { assertObject(value); if (!["url_75x75", "url_170x135", "url_570xN", "url_fullxfull"].some((key) => typeof value[key] === "string" && value[key].trim())) throw new EtsyApiError("invalid_response"); return value; }
export function createEtsyClient({
  fetchImpl = fetch,
  getAccessToken,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env = process.env,
  baseUrl = BASE_URL,
  createTimeoutSignal = () => AbortSignal.timeout(TIMEOUT_MS),
  now = () => Date.now(),
} = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");

  async function request(path, validate, attempt = 0) {
    let response;
    try {
      const token = await getAccessToken();
      response = await fetchImpl(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey(env), Accept: "application/json" },
        signal: createTimeoutSignal(TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === 0) return request(path, validate, 1);
      throw new EtsyApiError("temporary");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new EtsyApiError("reauthorize");
      if (response.status === 429) {
        if (attempt === 0) {
          await sleep(retryDelay(response.headers?.get?.("retry-after"), now));
          return request(path, validate, 1);
        }
        throw new EtsyApiError("rate_limited");
      }
      if (response.status >= 500 && attempt === 0) {
        await sleep(0);
        return request(path, validate, 1);
      }
      throw new EtsyApiError(response.status >= 500 ? "temporary" : "invalid_response");
    }
    let payload;
    try { payload = await response.json(); } catch (error) { throw new EtsyApiError("invalid_response"); }
    try { return validate(payload); } catch (error) {
      if (error instanceof EtsyApiError) throw error;
      throw new EtsyApiError("invalid_response");
    }
  }

  async function listReceipts({ shopId, ...filters }) {
    const results = [];
    let offset = 0;
    do {
      const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value != null)), limit: "100", offset: String(offset) });
      const page = await request(`/shops/${encodeURIComponent(shopId)}/receipts?${query}`, (payload) => {
        assertObject(payload);
        if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response");
        payload.results.forEach(assertReceipt);
        return payload;
      });
      results.push(...page.results);
      offset += page.results.length;
      if (page.results.length < 100 || (Number.isFinite(Number(page.count)) && offset >= Number(page.count))) break;
    } while (true);
    return results;
  }

  const listReceiptTransactions = ({ shopId, receiptId }) => request(
    `/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}/transactions`,
    (payload) => { assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); payload.results.forEach(assertTransaction); return payload.results; },
  );
  const getListing = ({ listingId }) => request(`/listings/${encodeURIComponent(listingId)}`, assertListing);
  const getListingImages = ({ listingId }) => request(`/listings/${encodeURIComponent(listingId)}/images`, (payload) => {
    assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); payload.results.forEach(assertImage); return payload.results;
  });

  return Object.freeze({ listReceipts, listReceiptTransactions, getListing, getListingImages });
}
