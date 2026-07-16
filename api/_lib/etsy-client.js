const BASE_URL = "https://openapi.etsy.com/v3/application";
const TIMEOUT_MS = 15000;
const MAX_RETRY_AFTER_MS = 30000;

export class EtsyApiError extends Error {
  constructor(code, options = {}) {
    super("Unable to retrieve Etsy orders.", options);
    this.name = "EtsyApiError";
    this.code = code;
    this.category = code;
  }
}

function retryDelay(value) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS) : 0;
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

export function createEtsyClient({
  fetchImpl = fetch,
  getAccessToken,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env = process.env,
  baseUrl = BASE_URL,
  createTimeoutSignal = () => AbortSignal.timeout(TIMEOUT_MS),
} = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");

  async function request(path, validate, attempt = 0) {
    let response;
    try {
      const token = await getAccessToken();
      response = await fetchImpl(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "x-api-key": apiKey(env), Accept: "application/json" },
        signal: createTimeoutSignal(),
      });
    } catch (error) {
      if (attempt === 0) return request(path, validate, 1);
      throw new EtsyApiError("temporary", { cause: error });
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new EtsyApiError("reauthorize");
      if (response.status === 429) {
        if (attempt === 0) {
          await sleep(retryDelay(response.headers?.get?.("retry-after")));
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
    try { payload = await response.json(); } catch (error) { throw new EtsyApiError("invalid_response", { cause: error }); }
    try { return validate(payload); } catch (error) {
      if (error instanceof EtsyApiError) throw error;
      throw new EtsyApiError("invalid_response", { cause: error });
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
    (payload) => { assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); return payload.results; },
  );
  const getListing = ({ listingId }) => request(`/listings/${encodeURIComponent(listingId)}`, assertObject);
  const getListingImages = ({ listingId }) => request(`/listings/${encodeURIComponent(listingId)}/images`, (payload) => {
    assertObject(payload); if (!Array.isArray(payload.results)) throw new EtsyApiError("invalid_response"); return payload.results;
  });

  return Object.freeze({ listReceipts, listReceiptTransactions, getListing, getListingImages });
}
