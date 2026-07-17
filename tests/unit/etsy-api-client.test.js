import { afterEach, describe, expect, it, vi } from "vitest";
import { beginEtsyAuthorization, fetchEtsyConnection, importEtsyOrders } from "../../src/etsy-api.js";

afterEach(() => vi.unstubAllGlobals());

function stream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });
}

describe("Etsy API browser client", () => {
  it("loads connection with auth and handles safe errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "connected" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchEtsyConnection({ accessToken: "token" })).resolves.toEqual({ status: "connected" });
    expect(fetch).toHaveBeenCalledWith("/api/etsy-connection", expect.objectContaining({
      headers: { Accept: "application/json", Authorization: "Bearer token" },
    }));
    fetch.mockResolvedValue(new Response("not json", { status: 500 }));
    await expect(fetchEtsyConnection()).rejects.toThrow("Unable to load Etsy connection.");
  });

  it("begins authorization without navigating and validates an Etsy HTTPS URL", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authorizeUrl: "https://www.etsy.com/oauth/connect" })));
    vi.stubGlobal("fetch", fetch);
    await expect(beginEtsyAuthorization({ accessToken: "token" })).resolves.toBe("https://www.etsy.com/oauth/connect");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ action: "beginAuthorization" }),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer token" },
    });
    fetch.mockResolvedValue(new Response(JSON.stringify({ authorizeUrl: "http://etsy.com/nope" })));
    await expect(beginEtsyAuthorization()).rejects.toThrow("Unable to connect Etsy shop.");
  });

  it("parses chunked CRLF NDJSON, unicode splits, blank and final lines", async () => {
    const bytes = new TextEncoder().encode('{"type":"progress","stage":"fetching_receipts","processed":0,"total":null,"message":"José"}\r\n\r\n{"type":"complete","imported":1,"existing":0,"customizationNeeded":0,"failed":0}');
    const accentedByte = bytes.indexOf(0xc3);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      bytes.slice(0, accentedByte + 1), bytes.slice(accentedByte + 1),
    ]))));
    const events = [];
    await importEtsyOrders({ accessToken: "token", onEvent: async (event) => events.push(event) });
    expect(events).toEqual([
      { type: "progress", stage: "fetching_receipts", processed: 0, total: null, message: "José" },
      { type: "complete", imported: 1, existing: 0, customizationNeeded: 0, failed: 0 },
    ]);
  });

  it("awaits async event handlers in order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      '{"type":"progress","stage":"importing_items","processed":1,"total":1}\n{"type":"complete","imported":1,"existing":0,"customizationNeeded":0,"failed":0}\n',
    ]))));
    const order = [];
    await importEtsyOrders({ onEvent: async (event) => {
      order.push(`start:${event.type}`);
      await Promise.resolve();
      order.push(`end:${event.type}`);
    } });
    expect(order).toEqual(["start:progress", "end:progress", "start:complete", "end:complete"]);
  });

  it("handles HTTP, malformed stream, and safe in-stream errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Try later", code: "busy" }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(importEtsyOrders()).rejects.toMatchObject({ message: "Try later", code: "busy" });
    fetch.mockResolvedValue(new Response(stream(["not-json\n"])));
    await expect(importEtsyOrders()).rejects.toThrow("Unable to import Etsy orders.");
    fetch.mockResolvedValue(new Response(stream(['{"type":"error","code":"etsy_expired","message":"Reconnect Etsy"}\n'])));
    await expect(importEtsyOrders()).rejects.toMatchObject({ message: "Reconnect Etsy", code: "etsy_expired" });
  });

  it("rejects authorization URLs outside the exact Etsy OAuth endpoint", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const authorizeUrl of [
      "https://shop.etsy.com/oauth/connect",
      "https://www.etsy.com:444/oauth/connect",
      "https://user@www.etsy.com/oauth/connect",
      "https://www.etsy.com/oauth/authorize",
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ authorizeUrl })));
      await expect(beginEtsyAuthorization()).rejects.toThrow("Unable to connect Etsy shop.");
    }
  });

  it("rejects unknown and malformed event schemas before notifying listeners", async () => {
    const invalidEvents = [
      { type: "unknown" },
      { type: "progress", stage: "other", processed: 0, total: null },
      { type: "progress", stage: "fetching_receipts", processed: -1, total: null },
      { type: "progress", stage: "fetching_receipts", processed: 0, total: 0 },
      { type: "progress", stage: "importing_items", processed: 2, total: 1 },
      { type: "progress", stage: "importing_items", processed: 0.5, total: 1 },
      { type: "complete", imported: 1, existing: 0, customizationNeeded: 0 },
      { type: "complete", imported: 1, existing: 0, customizationNeeded: 0, failed: -1 },
      { type: "error", code: "", message: "Reconnect" },
      { type: "error", code: "expired", message: 42 },
    ];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const event of invalidEvents) {
      fetch.mockResolvedValueOnce(new Response(stream([`${JSON.stringify(event)}\n`])));
      const onEvent = vi.fn();
      await expect(importEtsyOrders({ onEvent })).rejects.toThrow("Unable to import Etsy orders.");
      expect(onEvent).not.toHaveBeenCalled();
    }
  });

  it("rejects oversized unterminated records and cleans up the reader", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn().mockResolvedValueOnce({
      value: new TextEncoder().encode("x".repeat((256 * 1024) + 1)),
      done: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    }));
    const onEvent = vi.fn();
    await expect(importEtsyOrders({ onEvent })).rejects.toThrow("Unable to import Etsy orders.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("aborts a pending stream, cancels it, releases its lock, and emits no events", async () => {
    const controller = new AbortController();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi.fn(() => {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      return new Promise((resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    }));
    const onEvent = vi.fn();
    const importing = importEtsyOrders({ signal: controller.signal, onEvent });
    controller.abort(new DOMException("Stopped", "AbortError"));
    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("releases the reader lock after normal completion and parse errors", async () => {
    const makeResponse = (values) => {
      const releaseLock = vi.fn();
      const cancel = vi.fn().mockResolvedValue(undefined);
      const read = vi.fn();
      for (const value of values) read.mockResolvedValueOnce(value);
      return {
        response: { ok: true, body: { getReader: () => ({ read, cancel, releaseLock }) } },
        releaseLock,
        cancel,
      };
    };

    const normal = makeResponse([
      { value: new TextEncoder().encode('{"type":"complete","imported":1,"existing":0,"customizationNeeded":0,"failed":0}\n'), done: false },
      { value: undefined, done: true },
    ]);
    const fetch = vi.fn().mockResolvedValue(normal.response);
    vi.stubGlobal("fetch", fetch);
    await importEtsyOrders({});
    expect(normal.releaseLock).toHaveBeenCalledOnce();
    expect(normal.cancel).not.toHaveBeenCalled();

    const malformed = makeResponse([
      { value: new TextEncoder().encode("bad\n"), done: false },
    ]);
    fetch.mockResolvedValue(malformed.response);
    await expect(importEtsyOrders()).rejects.toThrow("Unable to import Etsy orders.");
    expect(malformed.cancel).toHaveBeenCalledOnce();
    expect(malformed.releaseLock).toHaveBeenCalledOnce();
  });
});
