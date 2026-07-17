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
    const bytes = new TextEncoder().encode('{"type":"progress","message":"Jos?"}\r\n\r\n{"type":"complete","imported":1}');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      bytes.slice(0, 37), bytes.slice(37, 39), bytes.slice(39),
    ]))));
    const events = [];
    await importEtsyOrders({ accessToken: "token", onEvent: async (event) => events.push(event) });
    expect(events).toEqual([
      { type: "progress", message: "Jos?" },
      { type: "complete", imported: 1 },
    ]);
  });

  it("awaits async event handlers in order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream([
      '{"type":"progress","processed":1}\n{"type":"complete"}\n',
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
});
