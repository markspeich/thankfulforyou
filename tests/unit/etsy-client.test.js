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
    const client = createEtsyClient({ fetchImpl, getAccessToken: async () => "secret-token", env, createTimeoutSignal: (milliseconds) => { expect(milliseconds).toBe(15000); return signal; } });
    expect(await client.listReceipts({ shopId: 12, min_created: 123 })).toHaveLength(101);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("min_created=123"); expect(url).toContain("limit=100");
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=100");
    expect(options.headers).toMatchObject({ Authorization: "Bearer secret-token", "x-api-key": "key:secret" });
    expect(options.signal).toBe(signal);
  });

  it("retrieves transactions and listing enrichment", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ results: [{ transaction_id: 1, listing_id: 2, quantity: 1, variations: [] }] }))
      .mockResolvedValueOnce(response({ listing_id: 2, title: "Badge" }))
      .mockResolvedValueOnce(response({ results: [{ url_75x75: "https://image.test/75" }] }));
    const client = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", env });
    expect(await client.listReceiptTransactions({ shopId: 3, receiptId: 4 })).toHaveLength(1);
    expect(await client.getListing({ listingId: 2 })).toMatchObject({ listing_id: 2, title: "Badge" });
    expect(await client.getListingImages({ listingId: 2 })).toHaveLength(1);
  });

  it("retries a 429 once and never retries authorization failures", async () => {
    const sleep = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "2" }))).mockResolvedValueOnce(response({ listing_id: 2, title: "Badge" }));
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

  it("uses fresh 15-second timeout signals on retries and bounds Retry-After", async () => {
    const signals = [{ id: 1 }, { id: 2 }];
    const createTimeoutSignal = vi.fn((milliseconds) => { expect(milliseconds).toBe(15000); return signals.shift(); });
    const sleep = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "999" }))).mockResolvedValueOnce(response({ listing_id: 2, title: "Badge" }));
    await createEtsyClient({ fetchImpl, getAccessToken: async () => "token", createTimeoutSignal, sleep, env }).getListing({ listingId: 2 });
    expect(createTimeoutSignal).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].signal).not.toBe(fetchImpl.mock.calls[1][1].signal);
    expect(sleep).toHaveBeenCalledWith(30000);

    const dateSleep = vi.fn();
    const dateFetch = vi.fn().mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "Thu, 16 Jul 2026 20:00:10 GMT" }))).mockResolvedValueOnce(response({ listing_id: 2, title: "Badge" }));
    await createEtsyClient({ fetchImpl: dateFetch, getAccessToken: async () => "token", sleep: dateSleep, now: () => Date.parse("2026-07-16T20:00:00Z"), env }).getListing({ listingId: 2 });
    expect(dateSleep).toHaveBeenCalledWith(10000);
  });

  it("reports exhausted rate limits, does not retry 403, and rejects malformed elements", async () => {
    const limited = vi.fn().mockResolvedValue(response({}, 429, new Headers({ "Retry-After": "1" })));
    await expect(createEtsyClient({ fetchImpl: limited, getAccessToken: async () => "token", sleep: vi.fn(), env }).getListing({ listingId: 2 })).rejects.toMatchObject({ code: "rate_limited" });
    expect(limited).toHaveBeenCalledTimes(2);
    const forbidden = vi.fn().mockResolvedValue(response({}, 403));
    await expect(createEtsyClient({ fetchImpl: forbidden, getAccessToken: async () => "token", env }).getListing({ listingId: 2 })).rejects.toMatchObject({ code: "reauthorize" });
    expect(forbidden).toHaveBeenCalledOnce();
    for (const [method, args, payload] of [
      ["listReceipts", { shopId: 1 }, { results: [{}] }],
      ["listReceiptTransactions", { shopId: 1, receiptId: 2 }, { results: [{ transaction_id: 1 }] }],
      ["getListing", { listingId: 2 }, { listing_id: 2 }],
      ["getListingImages", { listingId: 2 }, { results: [{}] }],
    ]) {
      const client = createEtsyClient({ fetchImpl: vi.fn().mockResolvedValue(response(payload)), getAccessToken: async () => "token", env });
      await expect(client[method](args)).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("does not retain raw failures as causes or enumerable secrets", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("secret-token key:secret"));
    let caught;
    try { await createEtsyClient({ fetchImpl, getAccessToken: async () => "secret-token", env }).getListing({ listingId: 1 }); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(caught.cause).toBeUndefined();
    expect(JSON.stringify(caught)).not.toMatch(/secret-token|key:secret/);
    expect(Object.values(caught).join(" ")).not.toMatch(/secret-token|key:secret/);
  });

  it("terminates repeated and capped receipt pagination without unbounded accumulation", async () => {
    const repeated = Array.from({ length: 100 }, (_, index) => ({ receipt_id: index + 1 }));
    const repeatedFetch = vi.fn().mockResolvedValue(response({ count: "invalid", results: repeated }));
    await expect(createEtsyClient({ fetchImpl: repeatedFetch, getAccessToken: async () => "token", env }).listReceipts({ shopId: 1 })).rejects.toMatchObject({ code: "invalid_response" });
    expect(repeatedFetch).toHaveBeenCalledTimes(2);

    let page = 0;
    const distinctFetch = vi.fn().mockImplementation(() => {
      const start = page++ * 100;
      return Promise.resolve(response({ results: Array.from({ length: 100 }, (_, index) => ({ receipt_id: start + index + 1 })) }));
    });
    await expect(createEtsyClient({ fetchImpl: distinctFetch, getAccessToken: async () => "token", maxReceiptPages: 2, env }).listReceipts({ shopId: 1 })).rejects.toMatchObject({ code: "invalid_response" });
    expect(distinctFetch).toHaveBeenCalledTimes(2);
  });

  it("honors caller abort during fetch without retry and removes combined-signal listeners", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetchImpl = vi.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("secret", "AbortError")), { once: true });
    }));
    const pending = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", env }).getListing({ listingId: 1, signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    const error = await pending.catch((caught) => caught);
    expect(error).toMatchObject({ code: "temporary" });
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("aborts Retry-After waiting, removes its listener, and never retries", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const sleep = vi.fn(() => new Promise(() => {}));
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 429, new Headers({ "Retry-After": "30" })));
    const pending = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", sleep, env }).getListing({ listingId: 1, signal: controller.signal });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "temporary" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
  });

  it("keeps caller cancellation active while the response body is pending", async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    let requestSignal;
    const fetchImpl = vi.fn((url, options) => {
      requestSignal = options.signal;
      return Promise.resolve({ ok: true, status: 200, json: () => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("body cancelled", "AbortError")), { once: true });
      }) });
    });
    const pending = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", env }).getListing({ listingId: 1, signal: caller.signal });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: "temporary" });
    expect(requestSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
  });

  it("keeps the per-attempt timeout active while the response body is pending", async () => {
    const timeout = new AbortController();
    const fetchImpl = vi.fn((url, options) => Promise.resolve({ ok: true, status: 200, json: () => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    }) }));
    const pending = createEtsyClient({ fetchImpl, getAccessToken: async () => "token", createTimeoutSignal: () => timeout.signal, env }).getListing({ listingId: 1 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    timeout.abort();
    await expect(pending).rejects.toMatchObject({ code: "temporary" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
