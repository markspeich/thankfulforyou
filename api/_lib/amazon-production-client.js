import { isIP } from "node:net";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const PRODUCTION_NA_URL = "https://sellingpartnerapi-na.amazon.com";
const LISTINGS_PATH = "/listings/2021-08-01/items";

const US_MARKETPLACE_ID = "ATVPDKIKX0DER";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ISSUES = 50;
const MAX_SAFE_TEXT_LENGTH = 512;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONFIG_KEYS = ["AMAZON_PRODUCTION_CLIENT_ID", "AMAZON_PRODUCTION_CLIENT_SECRET", "AMAZON_PRODUCTION_REFRESH_TOKEN", "AMAZON_PRODUCTION_SELLER_ID"];

function configuredValue(env, key) {
  return typeof env?.[key] === "string" ? env[key].trim() : "";
}

export function hasAmazonProductionConfig(env = process.env) {
  return CONFIG_KEYS.every((key) => Boolean(configuredValue(env, key)));
}

export class AmazonProductionError extends Error {
  constructor({ statusCode = 502, uncertain = false, message } = {}) {
    super(message || (uncertain ? "Amazon submission outcome is uncertain. Check listing status before submitting again." : "Amazon production request failed. Check production credentials, permissions, and connection before trying again."));
    this.name = "AmazonProductionError";
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

function listingUrl(sellerId, sku, { preview = false, get = false } = {}) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({ marketplaceIds: US_MARKETPLACE_ID, issueLocale: "en_US" });
  if (preview) {
    query.set("mode", "VALIDATION_PREVIEW");
    query.set("includedData", "identifiers,issues");
  } else if (get) {
    query.set("includedData", "summaries,issues,attributes");
  } else {
    query.set("includedData", "issues");
  }
  return `${PRODUCTION_NA_URL}${LISTINGS_PATH}/${encodeURIComponent(sellerId)}/${encodedSku}?${query}`;
}

function assertRequest({ sku, payload, method }) {
  if (typeof sku !== "string" || !sku.trim() || sku.length > 40 || !/^[A-Za-z0-9._-]+$/.test(sku)) {
    throw new AmazonProductionError({ statusCode: 422 });
  }
  if (method === "PUT" && (!payload || typeof payload !== "object" || Array.isArray(payload)
    || payload.productType !== "BADGE_HOLDER" || payload.requirements !== "LISTING_PRODUCT_ONLY"
    || !payload.attributes || typeof payload.attributes !== "object" || Array.isArray(payload.attributes)
    || Object.keys(payload).some((key) => !["productType", "requirements", "attributes"].includes(key))
    || Object.keys(payload.attributes).some((key) => /offer|fulfillment|inventory|quantity|price|availability|condition_type|merchant_shipping_group|list_price/i.test(key))
    || Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_RESPONSE_BYTES)) {
    throw new AmazonProductionError({ statusCode: 422 });
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
  if (payload.attributes && typeof payload.attributes === "object" && !Array.isArray(payload.attributes)) result.attributes = payload.attributes;
  return result;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function definitionSchemaUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || isIP(host) || !host.includes(".") || /(^|\.)(localhost|local|internal|test|ts\.net)$/.test(host)) return null;
    return url.toString();
  } catch { return null; }
}

function definitionAttributeNames(schema) {
  const names = schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? Object.keys(schema.properties) : null;
  if (!names || names.length > 500 || names.some(name => !/^[a-z][a-z0-9_]{0,127}$/.test(name))) return null;
  return names;
}

export function createAmazonProductionClient({ env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  if (!hasAmazonProductionConfig(env) || typeof fetchImpl !== "function") throw new AmazonProductionError({ statusCode: 503 });
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
          client_id: configuredValue(env, "AMAZON_PRODUCTION_CLIENT_ID"),
          client_secret: configuredValue(env, "AMAZON_PRODUCTION_CLIENT_SECRET"),
          refresh_token: configuredValue(env, "AMAZON_PRODUCTION_REFRESH_TOKEN"),
        }),
      });
    } catch {
      throw new AmazonProductionError({ statusCode: 502 });
    }
    const payload = await boundedJson(response);
    if (!response?.ok || !payload || !safeText(payload.access_token, 8192) || !Number.isFinite(payload.expires_in)) {
      throw new AmazonProductionError({ statusCode: response?.status === 429 ? 429 : 502 });
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
        response = await fetchImpl(listingUrl(configuredValue(env, "AMAZON_PRODUCTION_SELLER_ID"), sku, { preview, get }), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { "x-amz-access-token": currentToken, Accept: "application/json", ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) },
          ...(method === "PUT" ? { body: JSON.stringify(payload) } : {}),
        });
      } catch {
        throw new AmazonProductionError({ statusCode: 502, uncertain: submission });
      }
      if (!response || typeof response.status !== "number" || typeof response.ok !== "boolean") {
        throw new AmazonProductionError({ statusCode: 502, uncertain: submission });
      }
      if (response.status === 401 && !refreshed && !submission) {
        token = null;
        tokenExpiresAt = 0;
        refreshed = true;
        continue;
      }
      if (response.status === 429 && !rateRetry && !submission) {
        rateRetry = true;
        await sleep(retryDelay(response));
        continue;
      }
      if (get && response.status === 404) return null;
      const body = await boundedJson(response);
      if (!response.ok) {
        const codes = (Array.isArray(body?.errors) ? body.errors : []).map(error => error?.code).filter(code => typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code)).slice(0,5);
        const operation = get ? 'SKU lookup' : preview ? 'validation' : 'submission';
        const uncertain = submission && response.status >= 500;
        const nextStep = uncertain ? 'Check listing status before submitting again.' : response.status === 403 || response.status === 401 ? 'Check the production app authorization and Product Listing role.' : response.status === 429 ? 'Wait briefly before trying again.' : 'Review the request and Amazon requirements before trying again.';
        throw new AmazonProductionError({ statusCode: response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status, uncertain, message: `Amazon ${operation} failed (HTTP ${response.status}${codes.length ? '; '+codes.join(', ') : ''}). ${nextStep}` });
      }
      const result = get ? normalizeGet(body, response, sku) : normalizePut(body, response, sku);
      if (!result) throw new AmazonProductionError({ statusCode: 502, uncertain: submission });
      return result;
    }
  }

  async function definitions() {
    const query = new URLSearchParams({ marketplaceIds: US_MARKETPLACE_ID, sellerId: configuredValue(env, "AMAZON_PRODUCTION_SELLER_ID"), requirements: "LISTING_PRODUCT_ONLY", requirementsEnforced: "ENFORCED", productTypeVersion: "LATEST", locale: "en_US" });
    const currentToken = await accessToken();
    let response;
    try {
      response = await fetchImpl(`${PRODUCTION_NA_URL}/definitions/2020-09-01/productTypes/BADGE_HOLDER?${query}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "x-amz-access-token": currentToken, Accept: "application/json" },
      });
    } catch { throw new AmazonProductionError(); }
    const body = await boundedJson(response);
    const schemaUrl = definitionSchemaUrl(body?.schema?.link?.resource);
    if (!response?.ok || !body || body.productType !== "BADGE_HOLDER" || body.requirements !== "LISTING_PRODUCT_ONLY" || !schemaUrl) throw new AmazonProductionError({ statusCode: response?.status === 429 ? 429 : 502 });
    let schemaResponse;
    try {
      schemaResponse = await fetchImpl(schemaUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
    } catch { throw new AmazonProductionError(); }
    const schema = await boundedJson(schemaResponse);
    const attributeNames = definitionAttributeNames(schema);
    if (!schemaResponse?.ok || !attributeNames) throw new AmazonProductionError({ statusCode: schemaResponse?.status === 429 ? 429 : 502 });
    return { productType: body.productType, requirements: body.requirements, attributeNames };
  }

  return Object.freeze({
    definitions,
    preview: ({ sku, payload }) => listingsRequest({ sku, payload, method: "PUT", preview: true }),
    submit: ({ sku, payload }) => listingsRequest({ sku, payload, method: "PUT", submission: true }),
    get: ({ sku }) => listingsRequest({ sku, method: "GET", get: true }),
  });
}

export const AMAZON_PRODUCTION_ENDPOINTS = Object.freeze({ LWA_TOKEN_URL, PRODUCTION_NA_URL, US_MARKETPLACE_ID });
