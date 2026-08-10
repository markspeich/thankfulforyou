import { afterEach, describe, expect, it, vi } from "vitest";

import { importAmazonOrders } from "../../src/amazon-api.js";

afterEach(() => vi.unstubAllGlobals());

function stream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

const complete = {
  type: "complete",
  processedShipments: 3,
  importedItems: 4,
  existingItems: 2,
  alreadyProcessedShipments: 1,
  customizationNeeded: 2,
  warnings: 0,
  failed: 0,
};

describe("Amazon API browser client", () => {
  it("preserves unauthorized response status for session recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const { importAmazonOrders } = await import("../../src/amazon-api.js");

    await expect(importAmazonOrders({ accessToken: "expired-token" }))
      .rejects.toMatchObject({ message: "Authentication required.", status: 401 });
  });

  it("posts once with bearer authentication and an NDJSON accept header", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(stream([
      `${JSON.stringify(complete)}\n`,
    ])));
    vi.stubGlobal("fetch", fetch);

    await importAmazonOrders({ accessToken: "operator-token" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/amazon-import", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        Authorization: "Bearer operator-token",
      },
      signal: undefined,
    });
  });

  it("parses chunked CRLF records and awaits sanitized progress events in order", async () => {
    const body = new TextEncoder().encode([
      JSON.stringify({ type: "progress", stage: "fetching_shipments", processed: 0, total: null }),
      JSON.stringify({ type: "progress", stage: "processing_shipments", processed: 2, total: 3 }),
      JSON.stringify(complete),
    ].join("\r\n") + "\r\n\r\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      body.slice(0, 19),
      body.slice(19, 93),
      body.slice(93),
    ]))));
    const seen = [];

    await importAmazonOrders({
      onEvent: async (event) => {
        seen.push(`start:${event.type}:${event.stage || ""}`);
        await Promise.resolve();
        seen.push(`end:${event.type}:${event.stage || ""}`);
      },
    });

    expect(seen).toEqual([
      "start:progress:fetching_shipments",
      "end:progress:fetching_shipments",
      "start:progress:processing_shipments",
      "end:progress:processing_shipments",
      "start:complete:",
      "end:complete:",
    ]);
  });

  it("accepts a safe bounded failure array on an Amazon completion event", async () => {
    // Break caught: the browser client rejects the server's safe failure details before the operation dialog can use them.
    const completion = {
      ...complete,
      failed: 1,
      failures: [{
        orderNumber: "111-0318024-9415409",
        stage: "notes_update",
        reasonCode: "required_field",
        summary: "Package weight is required.",
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      `${JSON.stringify(completion)}\n`,
    ]))));
    const seen = [];

    await importAmazonOrders({ onEvent: (event) => seen.push(event) });

    expect(seen).toEqual([completion]);
  });

  it("delivers every safe completion warning record beyond ten unchanged", async () => {
    // Break caught: the browser parser rejects safe warning context from later shipments in a large batch.
    const warningDetails = Array.from({ length: 11 }, (_, index) => ({
      orderNumber: `114-${String(index + 1).padStart(7, "0")}-${String(index + 1).padStart(7, "0")}`,
      stage: index % 2 === 0 ? "notes_update" : "tag_update",
      summary: "ShipStation synchronization could not be completed.",
    }));
    const warningCompletion = { type: "complete", processedShipments: 0, importedItems: 11, existingItems: 0, alreadyProcessedShipments: 0, customizationNeeded: 0, warnings: 11, failed: 0, warningDetails };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      `${JSON.stringify(warningCompletion)}\n`,
    ]))));
    const seen = [];

    await importAmazonOrders({ onEvent: (event) => seen.push(event) });

    expect(seen).toEqual([warningCompletion]);
  });

  it("rejects malformed, unsafe, or raw completion warning details", async () => {
    // Break caught: customer data or provider errors cross the browser parsing boundary.
    const safeWarning = {
      orderNumber: "114-7445306-8228220",
      stage: "notes_update",
      summary: "ShipStation Notes to Buyer is too long to update.",
    };
    const invalidCompletions = [
      { ...complete, warnings: 1, warningDetails: "not-an-array" },
      { ...complete, warnings: 1, warningDetails: [{ ...safeWarning, orderNumber: "Buyer Daphne Private" }] },
      { ...complete, warnings: 1, warningDetails: [{ ...safeWarning, stage: "private_stage" }] },
      { ...complete, warnings: 1, warningDetails: [{ ...safeWarning, summary: "PRIVATE PROVIDER ERROR" }] },
      { ...complete, warnings: 1, warningDetails: [{ ...safeWarning, rawShipStationResponse: "PRIVATE SHIPSTATION RESPONSE" }] },
      { ...complete, warnings: 1, warningDetails: [safeWarning], rawShipStationResponse: "PRIVATE SHIPSTATION RESPONSE" },
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    for (const completion of invalidCompletions) {
      fetch.mockResolvedValueOnce(new Response(stream([`${JSON.stringify(completion)}\n`])));
      const onEvent = vi.fn();
      await expect(importAmazonOrders({ onEvent })).rejects.toThrow("Unable to import Amazon orders.");
      expect(onEvent).not.toHaveBeenCalled();
    }
  });

  it("rejects a raw ShipStation response field before notifying browser listeners", async () => {
    // Break caught: a raw server diagnostic field is accepted as part of a public browser completion record.
    const rawResponseBody = '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}';
    const completion = {
      ...complete,
      failed: 1,
      failures: [{
        orderNumber: "111-0318024-9415409",
        stage: "notes_update",
        reasonCode: "required_field",
        summary: "Package weight is required.",
        rawShipStationResponse: rawResponseBody,
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      `${JSON.stringify(completion)}\n`,
    ]))));
    const onEvent = vi.fn();

    let caught;
    try {
      await importAmazonOrders({ onEvent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ message: "Unable to import Amazon orders." });
    expect(JSON.stringify(caught)).not.toContain("PRIVATE SHIPSTATION ERROR");
    expect(JSON.stringify(caught)).not.toContain("PRIVATE VALUE");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed, unsafe, or oversized Amazon completion failure arrays", async () => {
    // Break caught: customer data, upstream text, or an unbounded failure list crosses the browser parsing boundary.
    const safeFailure = {
      orderNumber: "111-0318024-9415409",
      stage: "notes_update",
      reasonCode: "required_field",
      summary: "Package weight is required.",
    };
    const invalidFailureArrays = [
      "not-an-array",
      Array.from({ length: 11 }, () => safeFailure),
      [{ ...safeFailure, orderNumber: "Buyer Daphne Private https://example.test/customization" }],
      [{ ...safeFailure, orderNumber: "Buyer_Daphne_Private" }],
      [{ ...safeFailure, stage: "private_stage" }],
      [{ ...safeFailure, reasonCode: "private_reason" }],
      [{ ...safeFailure, summary: "Package weight is required for Buyer Daphne Private." }],
      [{ ...safeFailure, response: "PRIVATE UPSTREAM RESPONSE" }],
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    for (const failures of invalidFailureArrays) {
      fetch.mockResolvedValueOnce(new Response(stream([
        `${JSON.stringify({ ...complete, failed: 1, failures })}\n`,
      ])));
      const onEvent = vi.fn();
      await expect(importAmazonOrders({ onEvent })).rejects.toThrow("Unable to import Amazon orders.");
      expect(onEvent).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed, unknown, or extra event fields before notifying listeners", async () => {
    const invalidEvents = [
      "not-json",
      JSON.stringify({ type: "unknown" }),
      JSON.stringify({ type: "progress", stage: "other", processed: 0, total: null }),
      JSON.stringify({ type: "progress", stage: "fetching_shipments", processed: 1, total: null }),
      JSON.stringify({ type: "progress", stage: "fetching_shipments", processed: 0, total: 0 }),
      JSON.stringify({ type: "progress", stage: "processing_shipments", processed: 4, total: 3 }),
      JSON.stringify({ type: "progress", stage: "processing_shipments", processed: 0.5, total: 3 }),
      JSON.stringify({ type: "progress", stage: "processing_shipments", processed: 1, total: 3, note: "private" }),
      JSON.stringify({ ...complete, signedUrl: "https://zme-caps.amazon.com/private" }),
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    for (const record of invalidEvents) {
      fetch.mockResolvedValueOnce(new Response(stream([`${record}\n`])));
      const onEvent = vi.fn();
      await expect(importAmazonOrders({ onEvent })).rejects.toThrow("Unable to import Amazon orders.");
      expect(onEvent).not.toHaveBeenCalled();
    }
  });

  it("requires every exact non-negative integer completion count", async () => {
    const invalid = [
      { ...complete, failed: undefined },
      { ...complete, failed: -1 },
      { ...complete, importedItems: 1.5 },
      { ...complete, processedShipments: "3" },
      { ...complete, existingItems: Number.POSITIVE_INFINITY },
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    for (const event of invalid) {
      fetch.mockResolvedValueOnce(new Response(stream([`${JSON.stringify(event)}\n`])));
      await expect(importAmazonOrders()).rejects.toThrow("Unable to import Amazon orders.");
    }
  });

  it("requires exactly one terminal record at the end of the stream", async () => {
    const bodies = [
      "",
      '{"type":"progress","stage":"fetching_shipments","processed":0,"total":null}\n',
      `${JSON.stringify(complete)}\n${JSON.stringify({ type: "progress", stage: "processing_shipments", processed: 1, total: 1 })}\n`,
      `${JSON.stringify(complete)}\n${JSON.stringify(complete)}\n`,
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    for (const body of bodies) {
      fetch.mockResolvedValueOnce(new Response(stream([body])));
      const onEvent = vi.fn();
      await expect(importAmazonOrders({ onEvent })).rejects.toThrow("Unable to import Amazon orders.");
      expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "complete" }));
    }
  });

  it("decodes a streamed error when one UTF-8 codepoint is split across chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      type: "error",
      code: "import_failed",
      message: "Jos\u00e9",
    }) + "\n");
    const accentedByte = bytes.indexOf(0xc3);
    expect(accentedByte).toBeGreaterThan(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      bytes.slice(0, accentedByte + 1),
      bytes.slice(accentedByte + 1),
    ]))));

    await expect(importAmazonOrders()).rejects.toMatchObject({
      message: "Unable to import Amazon orders.",
      code: "import_failed",
    });
  });

  it("uses only the generic public error for HTTP and streamed failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: "API-Key secret-value failed for customer Jane",
      code: "private_upstream_failure",
    }), { status: 500 }));
    vi.stubGlobal("fetch", fetch);

    await expect(importAmazonOrders()).rejects.toMatchObject({
      message: "Unable to import Amazon orders.",
    });

    fetch.mockResolvedValueOnce(new Response(stream([
      `${JSON.stringify({
        type: "error",
        code: "import_failed",
        message: "signed URL and raw note body",
      })}\n`,
    ])));
    await expect(importAmazonOrders()).rejects.toMatchObject({
      message: "Unable to import Amazon orders.",
      code: "import_failed",
    });
  });

  it("identifies an authentication failure so the caller can refresh the session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(importAmazonOrders()).rejects.toMatchObject({
      message: "Authentication required.",
    });
  });

  it("rejects oversized records, cancels the reader, and releases its lock", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({
        value: new TextEncoder().encode("x".repeat(192 * 1024)),
        done: false,
      })
      .mockResolvedValueOnce({
        value: new TextEncoder().encode("x".repeat((64 * 1024) + 1)),
        done: false,
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    }));

    await expect(importAmazonOrders()).rejects.toThrow("Unable to import Amazon orders.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it("propagates abort cancellation while cancelling and releasing the reader", async () => {
    const controller = new AbortController();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn(() => new Promise((resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    }));

    const importing = importAmazonOrders({ signal: controller.signal });
    controller.abort(new DOMException("Stopped", "AbortError"));

    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it("releases the reader lock without cancelling after valid completion", async () => {
    const releaseLock = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn()
      .mockResolvedValueOnce({
        value: new TextEncoder().encode(`${JSON.stringify(complete)}\n`),
        done: false,
      })
      .mockResolvedValueOnce({ value: undefined, done: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    }));

    await importAmazonOrders();

    expect(cancel).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
