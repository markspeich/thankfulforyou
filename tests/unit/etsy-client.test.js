import { describe, expect, it, vi } from "vitest";
import { createEtsyClient } from "../../api/_lib/etsy-client.js";

const env = { ETSY_API_KEY_KEYSTRING: "key", ETSY_API_SHARED_SECRET: "secret" };
const response = (payload, status = 200, headers = new Headers()) => ({ ok: status >= 200 && status < 300, status, headers, json: async () => payload });

describe("Etsy client", () => {
  it("paginates receipts preserving filters and auth headers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ count: 101, results: Array.from({ length: 100 }, (_, i) => ({ receipt_id: i })) }))
      .mockResolvedValueOnce(response({ count: 101, results: [{ receipt_id: 100 }] }));
    const signal = {};
    const client = createEtsyClient({ fetchImpl, getAccessToken: async () => "secret-token", env, createTimeoutSignal: () => signal });
    expect(await client.listReceipts({ shopId: 12, min_created: 123 })).toHaveLength(101);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("min_created=123"); expect(url).toContain("limit=100");
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=100");
    expect(options.headers).toMatchObject({ Authorization: "Bearer secret-token", "x-api-key": "key:secret" });
    expect(options.signal).toBe(signal);
  });

  it("retrieves transactions and listing enrichment", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ results: [{ transaction_id: 1 }] }))
      .mockResolvedValueOnce(response({ listing_id: 2 }))
      .mockResolvedValueOnce(response({ results: [{ url_75x75: "image" }] }));
    const client = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", env });
    expect(await client.listReceiptTransactions({ shopId: 3, receiptId: 4 })).toHaveLength(1);
    expect(await client.getListing({ listingId: 2 })).toMatchObject({ listing_id: 2 });
    expect(await client.getListingImages({ listingId: 2 })).toHaveLength(1);
  });

  it("retries a 429 once and never retries authorization failures", async () => {
    const sleep = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "2" }))).mockResolvedValueOnce(response({ listing_id: 2 }));
    await createEtsyClient({ fetchImpl, getAccessToken: async () => "token", sleep, env }).getListing({ listingId: 2 });
    expect(sleep).toHaveBeenCalledWith(2000); expect(fetchImpl).toHaveBeenCalledTimes(2);
    fetchImpl.mockReset().mockResolvedValue(response({}, 401));
    await expect(createEtsyClient({ fetchImpl, getAccessToken: async () => "token", env }).getListing({ listingId: 2 })).rejects.toMatchObject({ code: "reauthorize", message: "Unable to retrieve Etsy orders." });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("categorizes invalid JSON, shapes, and network failures without leaking secrets", async () => {
    const badJson = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("secret-token"); } });
    await expect(createEtsyClient({ fetchImpl: badJson, getAccessToken: async () => "secret-token", env }).getListing({ listingId: 1 })).rejects.toMatchObject({ code: "invalid_response", message: "Unable to retrieve Etsy orders." });
    const badShape = vi.fn().mockResolvedValue(response({ results: {} }));
    await expect(createEtsyClient({ fetchImpl: badShape, getAccessToken: async () => "token", env }).getListingImages({ listingId: 1 })).rejects.toMatchObject({ code: "invalid_response" });
    const network = vi.fn().mockRejectedValue(new Error("token"));
    await expect(createEtsyClient({ fetchImpl: network, getAccessToken: async () => "token", env }).getListing({ listingId: 1 })).rejects.toMatchObject({ code: "temporary" });
    expect(network).toHaveBeenCalledTimes(2);
  });
});
