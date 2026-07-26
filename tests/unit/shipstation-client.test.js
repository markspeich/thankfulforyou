import { describe, expect, it, vi } from "vitest";
import { ShipStationError, createShipStationClient, readShipStationConfig } from "../../api/_lib/shipstation-client.js";

const shipment = (overrides = {}) => ({
  shipment_id: "se-1",
  items: [],
  tags: [],
  notes_to_buyer: null,
  ...overrides,
});

const response = (payload, status = 200, headers = new Headers()) => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  json: async () => payload,
});

describe("ShipStation V2 client", () => {
  it("rejects a missing API key or Amazon store ID without disclosing configured values", () => {
    for (const env of [
      { SHIPSTATION_AMAZON_STORE_ID: "se-secret-store" },
      { SHIPSTATION_API_KEY: "secret-api-key" },
    ]) {
      let caught;
      try { readShipStationConfig(env); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ShipStationError);
      expect(caught).toMatchObject({ code: "configuration", statusCode: null, retryable: false });
      expect(String(caught)).not.toMatch(/secret-api-key|se-secret-store/);
      expect(JSON.stringify(caught)).not.toMatch(/secret-api-key|se-secret-store/);
    }
  });

  it("uses the fixed V2 endpoint and pages pending shipments in API order", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ shipments: [shipment({ shipment_id: "se-1" })], page: 1, pages: 2 }))
      .mockResolvedValueOnce(response({ shipments: [shipment({ shipment_id: "se-2" })], page: 2, pages: 2 }));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl });

    const received = [];
    for await (const current of client.iteratePendingShipments({ storeId: "se-4461867" })) received.push(current.shipment_id);

    expect(received).toEqual(["se-1", "se-2"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.shipstation.com/v2/shipments?"),
      expect.objectContaining({ headers: expect.objectContaining({ "API-Key": "secret" }) }),
    );
    const firstUrl = new URL(fetchImpl.mock.calls[0][0]);
    const secondUrl = new URL(fetchImpl.mock.calls[1][0]);
    expect(Object.fromEntries(firstUrl.searchParams)).toMatchObject({ shipment_status: "pending", store_id: "se-4461867", page_size: "100", page: "1" });
    expect(Object.fromEntries(secondUrl.searchParams)).toMatchObject({ shipment_status: "pending", store_id: "se-4461867", page_size: "100", page: "2" });
  });

  it("rejects malformed shipment pages and shipment records", async () => {
    for (const payload of [
      { shipments: [], page: 1 },
      { shipments: {}, page: 1, pages: 1 },
      { shipments: [shipment({ items: {} })], page: 1, pages: 1 },
    ]) {
      const client = createShipStationClient({ apiKey: "secret", fetchImpl: vi.fn().mockResolvedValue(response(payload)) });
      await expect(client.iteratePendingShipments({ storeId: "se-4461867" }).next()).rejects.toMatchObject({ code: "invalid_response", retryable: false });
    }
  });

  it("includes ShipStation's required routing context when updating buyer notes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(shipment({ notes_to_buyer: "Existing\nImported" })));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl });

    await expect(client.updateNotesToBuyer({
      shipmentId: "se/1",
      notesToBuyer: "Existing\nImported",
      shipTo: { name: "Buyer" },
      warehouseId: "se-warehouse",
    })).resolves.toMatchObject({ shipment_id: "se-1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.shipstation.com/v2/shipments/se%2F1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          notes_to_buyer: "Existing\nImported",
          ship_to: { name: "Buyer" },
          warehouse_id: "se-warehouse",
        }),
        headers: expect.objectContaining({ "API-Key": "secret", Accept: "application/json", "Content-Type": "application/json" }),
      }),
    );

    const malformed = createShipStationClient({ apiKey: "secret", fetchImpl: vi.fn().mockResolvedValue(response({ shipment_id: "se-1" })) });
    await expect(malformed.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "x" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("posts an encoded tag path and validates its documented JSON success response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      shipment_id: "se/1",
      tag: { name: "Amazon Customization Imported" },
    }));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl });

    await expect(client.addShipmentTag({ shipmentId: "se/1", tagName: "Amazon Customization Imported" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.shipstation.com/v2/shipments/se%2F1/tags/Amazon%20Customization%20Imported",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "API-Key": "secret" }) }),
    );
  });

  it("rejects tag responses that do not confirm the requested shipment and tag", async () => {
    for (const upstreamResponse of [
      response({ shipment_id: "se-other", tag: { name: "tag" } }),
      response({ shipment_id: "se-1", tag: { name: "other" } }),
      response({ shipment_id: "se-1", tag: {} }),
      response({ status: "partial" }, 207),
      { ok: true, status: 204, headers: new Headers() },
    ]) {
      const client = createShipStationClient({ apiKey: "secret", fetchImpl: vi.fn().mockResolvedValue(upstreamResponse) });
      await expect(client.addShipmentTag({ shipmentId: "se-1", tagName: "tag" })).rejects.toMatchObject({
        code: "invalid_response",
        retryable: false,
      });
    }
  });

  it("honors bounded Retry-After and retries no more than three total attempts", async () => {
    const sleep = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "99" })))
      .mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "99" })))
      .mockResolvedValueOnce(response(shipment()));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl, sleep });

    await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    expect(sleep).toHaveBeenNthCalledWith(1, 10000, undefined);
    expect(sleep).toHaveBeenNthCalledWith(2, 10000, undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("honors future and past HTTP-date Retry-After values with a deterministic clock", async () => {
    const futureSleep = vi.fn();
    const futureFetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "Fri, 25 Jul 2026 22:00:20 GMT" })))
      .mockResolvedValueOnce(response(shipment()));
    await createShipStationClient({
      apiKey: "secret",
      fetchImpl: futureFetch,
      sleep: futureSleep,
      now: () => Date.parse("2026-07-25T22:00:00Z"),
    }).updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    expect(futureSleep).toHaveBeenCalledWith(10000, undefined);

    const pastSleep = vi.fn();
    const pastFetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, new Headers({ "Retry-After": "Fri, 25 Jul 2026 21:59:59 GMT" })))
      .mockResolvedValueOnce(response(shipment()));
    await createShipStationClient({
      apiKey: "secret",
      fetchImpl: pastFetch,
      sleep: pastSleep,
      now: () => Date.parse("2026-07-25T22:00:00Z"),
    }).updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    expect(pastSleep).toHaveBeenCalledWith(0, undefined);
  });
  it("uses bounded exponential backoff for 5xx responses and never retries a 4xx", async () => {
    const sleep = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 502))
      .mockResolvedValueOnce(response(shipment()));
    await createShipStationClient({ apiKey: "secret", fetchImpl, sleep }).updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    expect(sleep).toHaveBeenNthCalledWith(1, 250, undefined);
    expect(sleep).toHaveBeenNthCalledWith(2, 500, undefined);

    const forbidden = vi.fn().mockResolvedValue(response({ raw: "secret body" }, 403));
    await expect(createShipStationClient({ apiKey: "secret", fetchImpl: forbidden }).addShipmentTag({ shipmentId: "se-1", tagName: "tag" })).rejects.toMatchObject({ code: "request_failed", statusCode: 403, retryable: false });
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it("cancels an active request without retrying and retains no secret error details", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("secret body", "AbortError")), { once: true });
    }));
    const client = createShipStationClient({ apiKey: "secret-api-key", fetchImpl });
    const pending = client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok", signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    const error = await pending.catch((caught) => caught);
    expect(error).toMatchObject({ code: "aborted", statusCode: null, retryable: false });
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toMatch(/secret-api-key|secret body/);
    expect(JSON.stringify(error)).not.toMatch(/secret-api-key|secret body/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses fresh 15-second timeout signals for every retry", async () => {
    const timeoutSignals = [new AbortController().signal, new AbortController().signal];
    const createTimeoutSignal = vi.fn((milliseconds) => {
      expect(milliseconds).toBe(15000);
      return timeoutSignals.shift();
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(shipment()));
    await createShipStationClient({ apiKey: "secret", fetchImpl, createTimeoutSignal, sleep: vi.fn() })
      .updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    expect(createTimeoutSignal).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].signal).not.toBe(fetchImpl.mock.calls[1][1].signal);
  });

  it("keeps a request timeout active while its response body is pending", async () => {
    const timeout = new AbortController();
    const fetchImpl = vi.fn((_url, options) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("secret body", "AbortError")), { once: true });
      }),
    }));
    const pending = createShipStationClient({
      apiKey: "secret-api-key",
      fetchImpl,
      createTimeoutSignal: () => timeout.signal,
    }).updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    timeout.abort();
    await expect(pending).rejects.toMatchObject({ code: "temporary", retryable: true });
  });
});
