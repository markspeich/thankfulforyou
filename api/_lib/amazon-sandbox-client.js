const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SANDBOX_NA_URL = "https://sandbox.sellingpartnerapi-na.amazon.com";
const LISTINGS_PATH = "/listings/2021-08-01/items";
const TEST_SELLER_ID = "TEST_SELLER_ID";
const US_MARKETPLACE_ID = "ATVPDKIKX0DER";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ISSUES = 50;
const MAX_SAFE_TEXT_LENGTH = 512;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONFIG_KEYS = ["AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN"];

function configuredValue(env, key) {
  return typeof env?.[key] === "string" ? env[key].trim() : "";
}

export function hasAmazonSandboxConfig(env = process.env) {
  return env?.AMAZON_SP_API_ENVIRONMENT === "sandbox" && CONFIG_KEYS.every((key) => Boolean(configuredValue(env, key)));
}

export class AmazonSandboxError extends Error {
  constructor({ statusCode = 502, uncertain = false } = {}) {
    super("Amazon sandbox request could not be completed.");
    this.name = "AmazonSandboxError";
    this.statusCode = statusCode;
    this.expose = true;
    this.uncertain = Boolean(uncertain);
  }
}

function safeText(value, maximum = MAX_SAFE_TEXT_LENGTH) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function requestId(response, payload) {
  const headerValue = response?.headers?.get?.("x-amzn-requestid") || response?.headers?.get?.("x-amzn-RequestId");
  const value = headerValue || payload?.requestId || payload?.request_id;
  return typeof value === "string" && SAFE_REQUEST_ID.test(value) ? value : null;
}

async function boundedJson(response) {
  let source = "";
  const reader = response?.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return null;
    }
    source = Buffer.concat(chunks).toString("utf8");
  } else {
    try { source = await response.text(); } catch { return null; }
    if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > MAX_RESPONSE_BYTES) return null;
  }
  try {
    const value = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizedIssues(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ISSUES) return null;
  const issues = [];
  for (const issue of value) {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return null;
    const code = safeText(issue.code);
    const message = safeText(issue.message);
    const severity = safeText(issue.severity);
    const attributeNames = issue.attributeNames === undefined ? [] : issue.attributeNames;
    if (!code || !message || !severity || !Array.isArray(attributeNames)
      || attributeNames.some((name) => !safeText(name, 128))) return null;
    issues.push({ code, message, severity, attributeNames: [...attributeNames] });
  }
  return issues;
}

function retryDelay(response) {
  const parsed = Number(response?.headers?.get?.("retry-after"));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.ceil(parsed * 1000), 0), 2000);
}

function listingUrl(sku, { preview = false, get = false } = {}) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({ marketplaceIds: US_MARKETPLACE_ID, issueLocale: "en_US" });
  if (preview) {
    query.set("mode", "VALIDATION_PREVIEW");
    query.set("includedData", "identifiers,issues");
  } else if (get) {
    query.set("includedData", "summaries,issues");
  } else {
    query.set("includedData", "identifiers,issues");
  }
  return `${SANDBOX_NA_URL}${LISTINGS_PATH}/${TEST_SELLER_ID}/${encodedSku}?${query}`;
}

function assertRequest({ sku, payload, method }) {
  if (typeof sku !== "string" || !sku.trim() || sku.length > 40 || !/^[A-Za-z0-9._-]+$/.test(sku)) {
    throw new AmazonSandboxError({ statusCode: 422 });
  }
  if (method === "PUT" && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
    throw new AmazonSandboxError({ statusCode: 422 });
  }
}

function normalizePut(payload, response, sku) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const issues = normalizedIssues(payload.issues);
  if (typeof payload.status !== "string" || !safeText(payload.status) || issues === null
    || (payload.submissionId !== undefined && !safeText(payload.submissionId))) return null;
  return {
    status: payload.status,
    sku,
    submissionId: typeof payload.submissionId === "string" ? payload.submissionId : null,
    issues,
    requestId: requestId(response, payload),
  };
}

function normalizeGet(payload, response, requestedSku) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const issues = normalizedIssues(payload.issues);
  if (issues === null || (payload.sku !== undefined && !safeText(payload.sku))) return null;
  const result = {
    status: typeof payload.status === "string" && safeText(payload.status) ? payload.status : null,
    sku: typeof payload.sku === "string" ? payload.sku : requestedSku,
    submissionId: typeof payload.submissionId === "string" && safeText(payload.submissionId) ? payload.submissionId : null,
    issues,
    requestId: requestId(response, payload),
  };
  if (Array.isArray(payload.summaries)) result.summaries = payload.summaries;
  return result;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createAmazonSandboxClient({ env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  if (!hasAmazonSandboxConfig(env) || typeof fetchImpl !== "function") throw new AmazonSandboxError({ statusCode: 503 });
  let token = null;
  let tokenExpiresAt = 0;

  async function accessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && token && Date.now() < tokenExpiresAt) return token;
    let response;
    try {
      response = await fetchImpl(LWA_TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: configuredValue(env, "AMAZON_SP_API_CLIENT_ID"),
          client_secret: configuredValue(env, "AMAZON_SP_API_CLIENT_SECRET"),
          refresh_token: configuredValue(env, "AMAZON_SP_API_REFRESH_TOKEN"),
        }),
      });
    } catch {
      throw new AmazonSandboxError({ statusCode: 502 });
    }
    const payload = await boundedJson(response);
    if (!response?.ok || !payload || !safeText(payload.access_token) || !Number.isFinite(payload.expires_in)) {
      throw new AmazonSandboxError({ statusCode: response?.status === 429 ? 429 : 502 });
    }
    token = payload.access_token;
    tokenExpiresAt = Date.now() + Math.max(0, payload.expires_in * 1000 - 30_000);
    return token;
  }

  async function listingsRequest({ sku, payload, method, preview = false, get = false, submission = false }) {
    assertRequest({ sku, payload, method });
    let refreshed = false;
    let rateRetry = false;
    while (true) {
      const currentToken = await accessToken({ forceRefresh: refreshed });
      let response;
      try {
        response = await fetchImpl(listingUrl(sku, { preview, get }), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { "x-amz-access-token": currentToken, Accept: "application/json", ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) },
          ...(method === "PUT" ? { body: JSON.stringify(payload) } : {}),
        });
      } catch {
        throw new AmazonSandboxError({ statusCode: 502, uncertain: submission });
      }
      if (!response || typeof response.status !== "number" || typeof response.ok !== "boolean") {
        throw new AmazonSandboxError({ statusCode: 502, uncertain: submission });
      }
      if (response.status === 401 && !refreshed) {
        token = null;
        tokenExpiresAt = 0;
        refreshed = true;
        continue;
      }
      if (response.status === 429 && !rateRetry) {
        rateRetry = true;
        await sleep(retryDelay(response));
        continue;
      }
      const body = await boundedJson(response);
      if (!response.ok) {
        throw new AmazonSandboxError({ statusCode: response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status, uncertain: submission && response.status >= 500 });
      }
      const result = get ? normalizeGet(body, response, sku) : normalizePut(body, response, sku);
      if (!result) throw new AmazonSandboxError({ statusCode: 502, uncertain: submission });
      return result;
    }
  }

  return Object.freeze({
    preview: ({ sku, payload }) => listingsRequest({ sku, payload, method: "PUT", preview: true }),
    submit: ({ sku, payload }) => listingsRequest({ sku, payload, method: "PUT", submission: true }),
    get: ({ sku }) => listingsRequest({ sku, method: "GET", get: true }),
  });
}

export const AMAZON_SANDBOX_ENDPOINTS = Object.freeze({ LWA_TOKEN_URL, SANDBOX_NA_URL, TEST_SELLER_ID, US_MARKETPLACE_ID });
