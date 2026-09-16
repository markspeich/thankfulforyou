import { describe, expect, it, vi } from "vitest";
import { AmazonSandboxError, createAmazonSandboxClient, hasAmazonSandboxConfig } from "../../api/_lib/amazon-sandbox-client.js";

const env = {
  AMAZON_SP_API_ENVIRONMENT: "sandbox",
  AMAZON_SP_API_CLIENT_ID: "client-id",
  AMAZON_SP_API_CLIENT_SECRET: "client-secret",
  AMAZON_SP_API_REFRESH_TOKEN: "refresh-token",
};

const response = (payload, status = 200, headers = new Headers()) => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  text: async () => JSON.stringify(payload),
});

describe("Amazon SP-API sandbox listings client", () => {
  it("only accepts the explicitly configured sandbox credentials", () => {
    expect(hasAmazonSandboxConfig(env)).toBe(true);
    expect(hasAmazonSandboxConfig({ ...env, AMAZON_SP_API_ENVIRONMENT: "production" })).toBe(false);
    expect(hasAmazonSandboxConfig({ ...env, AMAZON_SP_API_CLIENT_SECRET: "" })).toBe(false);
    expect(() => createAmazonSandboxClient({ env: { ...env, AMAZON_SP_API_ENVIRONMENT: "production" } })).toThrow(AmazonSandboxError);
  });

  it("uses the fixed sandbox Listings Items endpoints and preview query", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ status: "ACCEPTED", submissionId: "submission-1", issues: [] }, 202, new Headers({ "x-amzn-RequestId": "request-1" })));
    const client = createAmazonSandboxClient({ env, fetchImpl });

    await expect(client.preview({ sku: "TFY-SANDBOX-VALID", payload: { productType: "PRODUCT", requirements: "LISTING_PRODUCT_ONLY", attributes: {} } })).resolves.toEqual({
      status: "ACCEPTED", sku: "TFY-SANDBOX-VALID", submissionId: "submission-1", issues: [], requestId: "request-1",
    });

    const request = fetchImpl.mock.calls[1];
    expect(request[0]).toBe("https://sandbox.sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/TEST_SELLER_ID/TFY-SANDBOX-VALID?marketplaceIds=ATVPDKIKX0DER&issueLocale=en_US&mode=VALIDATION_PREVIEW&includedData=identifiers%2Cissues");
    expect(request[1]).toMatchObject({ method: "PUT", headers: expect.objectContaining({ "x-amz-access-token": "access-token" }) });
    expect(request[1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("caches a token and refreshes it once after a 401", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "first-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ access_token: "second-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ status: "ACCEPTED", issues: [] }, 202));
    const client = createAmazonSandboxClient({ env, fetchImpl });

    await expect(client.submit({ sku: "TFY-SANDBOX-SUBMIT", payload: { productType: "PRODUCT", attributes: {} } })).resolves.toMatchObject({ status: "ACCEPTED", sku: "TFY-SANDBOX-SUBMIT" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[3][1].headers["x-amz-access-token"]).toBe("second-token");
  });

  it("waits at most two seconds and retries a rate-limited request once", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({}, 429, new Headers({ "retry-after": "99" })))
      .mockResolvedValueOnce(response({ status: "ACCEPTED", issues: [] }, 202));
    const client = createAmazonSandboxClient({ env, fetchImpl, sleep });

    await client.preview({ sku: "TFY-SANDBOX-RATE", payload: { productType: "PRODUCT", attributes: {} } });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not expose malformed upstream responses and marks malformed submission uncertain", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers(), text: async () => "not-json" });
    const error = await createAmazonSandboxClient({ env, fetchImpl })
      .submit({ sku: "TFY-SANDBOX-BAD", payload: { productType: "PRODUCT", attributes: {} } })
      .catch((caught) => caught);

    expect(error).toMatchObject({ statusCode: 502, expose: true, uncertain: true });
    expect(String(error)).not.toContain("not-json");
  });

  it("never replays a PUT after an uncertain transport failure", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-token", expires_in: 3600 }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const error = await createAmazonSandboxClient({ env, fetchImpl })
      .submit({ sku: "TFY-SANDBOX-UNKNOWN", payload: { productType: "PRODUCT", attributes: {} } })
      .catch((caught) => caught);

    expect(error).toMatchObject({ statusCode: 502, expose: true, uncertain: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps a static sandbox GET SKU when it differs from the requested SKU", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ sku: "TEST_CASE_STATIC", summaries: [{ marketplaceId: "ATVPDKIKX0DER", status: ["DISCOVERABLE"] }], issues: [] }));
    const result = await createAmazonSandboxClient({ env, fetchImpl }).get({ sku: "TFY-SANDBOX-UNKNOWN" });

    expect(result).toMatchObject({ sku: "TEST_CASE_STATIC", status: null, submissionId: null, issues: [] });
    expect(result.summaries).toHaveLength(1);
  });
});
