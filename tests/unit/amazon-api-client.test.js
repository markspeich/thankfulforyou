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
