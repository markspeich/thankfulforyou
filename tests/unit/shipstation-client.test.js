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
  text: async () => JSON.stringify(payload),
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

  it("preserves a ShipStation request ID alongside the server-only raw error body", async () => {
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(response({
        request_id: "req-safe",
        errors: [{ message: "secret body" }],
      }, 401)),
    });

    const error = await client.iteratePendingShipments({ storeId: "se-4461867" }).next().catch((caught) => caught);

    expect(error).toMatchObject({
      code: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: "req-safe",
    });
    expect(String(error)).not.toContain("secret body");
    expect(error.rawResponseBody).toContain("secret body");
  });

  it("preserves the exact terminal JSON error body after reading it once", async () => {
    const body = '{\n  "request_id": "req-exact",\n  "errors": []\n}';
    const text = vi.fn().mockResolvedValue(body);
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text }),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({ requestId: "req-exact", rawResponseBody: body });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("preserves a plain-text terminal 400 response", async () => {
    const body = "ShipStation rejected this shipment.";
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text: async () => body }),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({ requestId: null, validation: null, rawResponseBody: body });
  });

  it("truncates terminal response bodies beyond 16384 characters", async () => {
    const body = "x".repeat(16385);
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text: async () => body }),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error.rawResponseBody).toBe(`${"x".repeat(16384)}\n[truncated after 16384 characters]`);
  });

  it("extracts existing error metadata from the raw JSON text", async () => {
    const body = JSON.stringify({
      request_id: "req-raw-json",
      errors: [{ error_code: "field_value_required", field_name: "packages[0].weight" }],
    });
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text: async () => body }),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({
      requestId: "req-raw-json",
      validation: { reasonCode: "required_field", field: "package_weight", summary: "Package weight is required." },
      rawResponseBody: body,
    });
  });

  it("uses a marker when a terminal response body cannot be read", async () => {
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text: async () => { throw new Error("unreadable"); } }),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({
      requestId: null,
      validation: null,
      rawResponseBody: "[ShipStation response body could not be read]",
    });
  });

  it("retains only bounded request IDs matching the safe identifier allowlist", async () => {
    const cases = [
      { requestId: "req-safe_123.abc", expected: "req-safe_123.abc" },
      { requestId: "req unsafe buyer@example.test", expected: null },
      { requestId: "https://example.test/private-request", expected: null },
      { requestId: "r".repeat(129), expected: null },
    ];

    for (const { requestId, expected } of cases) {
      const client = createShipStationClient({
        apiKey: "secret",
        fetchImpl: vi.fn().mockResolvedValue(response({ request_id: requestId, errors: [] }, 400)),
      });
      const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);
      expect(error.requestId).toBe(expected);
      expect(error.rawResponseBody).toContain(requestId);
    }
  });

  it("extracts an allowlisted required package weight validation alongside the raw response body", async () => {
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(response({
        request_id: "req-package-weight",
        errors: [{
          error_code: "field_value_required",
          field_name: "packages[0].weight",
          field_value: "buyer-provided-weight",
          message: "PRIVATE UPSTREAM PACKAGE MESSAGE",
        }],
      }, 400)),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({
      code: "request_failed",
      statusCode: 400,
      requestId: "req-package-weight",
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    expect(Object.isFrozen(error.validation)).toBe(true);
    expect(error.rawResponseBody).toContain("buyer-provided-weight");
    expect(error.rawResponseBody).toContain("PRIVATE UPSTREAM PACKAGE MESSAGE");
  });

  it("maps only documented validation combinations and leaves generic 400 errors unclassified", async () => {
    const cases = [
      {
        payload: {
          request_id: "req-service",
          errors: [{
            error_code: "invalid_field_value",
            field_name: "service_code",
            field_value: "buyer-chosen-service",
            message: "PRIVATE UPSTREAM SERVICE MESSAGE",
          }],
        },
        expected: {
          reasonCode: "invalid_field_value",
          field: "shipping_service",
          summary: "The selected shipping service is invalid.",
        },
      },
      {
        payload: {
          request_id: "req-legacy-shape",
          errors: [{
            error_code: "field_value_required",
            fields: [{ field: "packages[0].weight", value: "PRIVATE LEGACY FIELD VALUE" }],
          }],
        },
        expected: null,
      },
      {
        payload: {
          request_id: "req-wrong-pair",
          errors: [{
            error_code: "field_value_required",
            field_name: "service_code",
            field_value: "PRIVATE WRONG-PAIR VALUE",
          }],
        },
        expected: null,
      },
      { payload: { request_id: "req-generic", errors: [] }, expected: null },
    ];

    for (const { payload, expected } of cases) {
      const client = createShipStationClient({ apiKey: "secret", fetchImpl: vi.fn().mockResolvedValue(response(payload, 400)) });
      const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);
      expect(error).toMatchObject({ requestId: payload.request_id, validation: expected });
      expect(error.rawResponseBody).toBe(JSON.stringify(payload));
    }
  });

  it("preserves untrusted error values only in the server-only raw response body", async () => {
    const privateValues = [
      "Buyer Daphne Private",
      "15 Secret Lane, Exampleville",
      "Private note for the seller",
      "https://example.test/customization?credential=private",
      "arbitrary-upstream-message-".repeat(100),
    ];
    const client = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue(response({
        request_id: "req-safe-only",
        errors: [{ error_code: "unknown_code", field_name: "buyer.email", field_value: privateValues[0], message: privateValues[4] }],
        buyer: { name: privateValues[0], address: privateValues[1] },
        notes_to_buyer: privateValues[2],
        customization_url: privateValues[3],
      }, 400)),
    });

    const error = await client.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" }).catch((caught) => caught);

    expect(error).toMatchObject({ requestId: "req-safe-only", validation: null });
    for (const value of privateValues) expect(error.rawResponseBody).toContain(value);

    const malformed = createShipStationClient({
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => { throw new SyntaxError("malformed body"); } }),
    });
    await expect(malformed.updateNotesToBuyer({ shipmentId: "se-1", notesToBuyer: "ok" })).rejects.toMatchObject({
      requestId: null,
      validation: null,
      rawResponseBody: "[ShipStation response body could not be read]",
    });
  });

  it("rejects caller-supplied validation metadata outside the same safe allowlist", () => {
    const error = new ShipStationError("request_failed", {
      validation: {
        reasonCode: "unknown_code",
        field: "buyer_email",
        summary: "Buyer Daphne Private selected https://example.test/customization.",
      },
    });

    expect(error.validation).toBeNull();
    expect(JSON.stringify(error)).not.toContain("Buyer Daphne Private");
  });

  it("keeps the timeout active while parsing a terminal error response", async () => {
    const timeout = new AbortController();
    const fetchImpl = vi.fn((_url, options) => Promise.resolve({
      ok: false,
      status: 401,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("secret body", "AbortError")), { once: true });
      }),
    }));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl, createTimeoutSignal: () => timeout.signal });
    const pending = client.iteratePendingShipments({ storeId: "se-4461867", signal: new AbortController().signal }).next();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    timeout.abort();

    await expect(Promise.race([
      pending,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("request did not respect the timeout")), 50)),
    ])).rejects.toMatchObject({ code: "temporary", retryable: true });
  });

  it("preserves mutable shipping configuration when updating buyer notes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(shipment({ notes_to_buyer: "Existing\nImported" })));
    const client = createShipStationClient({ apiKey: "secret", fetchImpl });

    await expect(client.updateNotesToBuyer({
      shipmentId: "se/1",
      notesToBuyer: "Existing\nImported",
      shipTo: { name: "Buyer" },
      warehouseId: "se-warehouse",
      carrierId: "se-carrier",
      serviceCode: "usps_ground_advantage",
      requestedShipmentService: "USPS Ground Advantage",
      shippingRuleId: "se-rule",
      packages: [{
        shipment_package_id: "se-read-only",
        package_id: "se-3",
        package_code: "package",
        package_name: "Package",
        weight: { value: 1.1, unit: "ounce" },
        dimensions: { unit: "inch", length: 8, width: 6, height: 1 },
        insured_value: { currency: "usd", amount: 0 },
        external_package_id: "external-package",
      }],
    })).resolves.toMatchObject({ shipment_id: "se-1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.shipstation.com/v2/shipments/se%2F1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          notes_to_buyer: "Existing\nImported",
          ship_to: { name: "Buyer" },
          warehouse_id: "se-warehouse",
          carrier_id: "se-carrier",
          service_code: "usps_ground_advantage",
          requested_shipment_service: "USPS Ground Advantage",
          shipping_rule_id: "se-rule",
          packages: [{
            package_id: "se-3",
            package_code: "package",
            weight: { value: 1.1, unit: "ounce" },
            dimensions: { unit: "inch", length: 8, width: 6, height: 1 },
            insured_value: { currency: "usd", amount: 0 },
            external_package_id: "external-package",
          }],
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
