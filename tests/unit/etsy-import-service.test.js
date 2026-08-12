import { describe, expect, it, vi } from "vitest";
import { createEtsyImportService, EtsyImportError } from "../../api/_lib/etsy-import-service.js";
import { createAmazonItemEnricher } from "../../api/_lib/amazon-import-enrichment.js";
function fixture(overrides = {}) {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const store = {
    getEtsyConnectionCredentials: vi.fn().mockResolvedValue({ status: "connected", etsyShopId: "shop", accessToken: "token", refreshToken: "refresh", accessTokenExpiresAt: "2026-07-16T13:00:00.000Z", lastSyncedAt: null }),
    acquireEtsyImportLock: vi.fn().mockResolvedValue(true), releaseEtsyImportLock: vi.fn(),
    updateEtsySyncCursor: vi.fn(), importWorkspaceOrderItems: vi.fn().mockResolvedValue({ importedCount: 1 }),
    renewEtsyImportLock: vi.fn().mockResolvedValue(true),
    markEtsyConnectionReconnectRequired: vi.fn(),
  };
  const client = {
    listReceipts: vi.fn().mockResolvedValue([{ receipt_id: 1, is_paid: true, is_shipped: false }]),
    listReceiptTransactions: vi.fn().mockResolvedValue([{ transaction_id: 2, listing_id: 3 }]),
    getListing: vi.fn().mockResolvedValue({}), getListingImages: vi.fn().mockResolvedValue([]),
  };
  const events = [];
  const service = createEtsyImportService({ store, createClient: () => client, refreshAccess: vi.fn(), normalizeTransaction: ({ transaction }) => ({ id: `transaction:${transaction.transaction_id}`, source: { customizationNeeded: true } }), clock: () => now, randomUUID: () => "owner", ...overrides });
  return { service, store, client, events, now };
}
describe("Etsy import service", () => {
  it("uses the exact initial window, delegates persistence, streams progress, and releases", async () => {
    const f = fixture(); const prepared = await f.service.prepare({ workspaceId: "w", userId: "u", onProgress: (e) => f.events.push(e) }); await prepared.run();
    expect(f.client.listReceipts).toHaveBeenCalledWith(expect.objectContaining({ min_created: Math.floor((f.now.getTime() - 90 * 86400000) / 1000) }));
    expect(f.store.importWorkspaceOrderItems).toHaveBeenCalledWith(expect.objectContaining({ target: "orders", batchId: null }));
    expect(f.events).toEqual([{ type: "progress", stage: "fetching_receipts", processed: 0, total: null }, { type: "progress", stage: "importing_items", processed: 0, total: 1 }, { type: "progress", stage: "importing_items", processed: 1, total: 1 }, { type: "complete", imported: 1, existing: 0, customizationNeeded: 1, failed: 0 }]);
    expect(f.store.updateEtsySyncCursor).toHaveBeenCalledWith({ workspaceId: "w", lastSyncedAt: f.now.toISOString() });
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });
  it("uses five-minute cursor overlap and filters ineligible receipts", async () => {
    const f = fixture(); f.store.getEtsyConnectionCredentials.mockResolvedValue({ status: "connected", etsyShopId: "shop", accessToken: "t", accessTokenExpiresAt: "2027-01-01", lastSyncedAt: "2026-07-10T00:00:00Z" });
    f.client.listReceipts.mockResolvedValue([{ receipt_id: 1, is_paid: false, is_shipped: false }, { receipt_id: 2, is_paid: true, is_shipped: true }, { receipt_id: 3, is_paid: true, is_shipped: false, status: "canceled" }]);
    await (await f.service.prepare({ workspaceId: "w" })).run();
    expect(f.client.listReceipts).toHaveBeenCalledWith(expect.objectContaining({ min_last_modified: Math.floor((Date.parse("2026-07-10T00:00:00Z") - 300000) / 1000) }));
    expect(f.client.listReceiptTransactions).not.toHaveBeenCalled();
  });
  it("fails lock preflight and releases after global failure without advancing cursor", async () => {
    let f = fixture(); f.store.acquireEtsyImportLock.mockResolvedValue(false);
    await expect(f.service.prepare({ workspaceId: "w" })).rejects.toBeInstanceOf(EtsyImportError);
    f = fixture(); f.client.listReceipts.mockRejectedValue(new Error("page"));
    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toThrow("page");
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalled(); expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
  });
  it("continues enrichment and item failures, advances cursor, and propagates abort signal", async () => {
    const f = fixture(); const signal = new AbortController().signal; f.client.getListing.mockRejectedValue(new Error("listing")); f.store.importWorkspaceOrderItems.mockRejectedValue(new Error("item"));
    const result = await (await f.service.prepare({ workspaceId: "w", signal })).run();
    expect(result.failed).toBe(1); expect(f.client.listReceipts.mock.calls[0][0].signal).toBe(signal); expect(f.store.updateEtsySyncCursor).toHaveBeenCalled();
  });
  it.each([
    ["listing", "getListing"],
    ["image", "getListingImages"],
  ])("stops on %s reauthorization, marks reconnect, preserves cursor, and releases", async (_label, method) => {
    const f = fixture();
    const failure = Object.assign(new Error("reauthorize"), { code: "reauthorize" });
    f.client[method].mockRejectedValue(failure);

    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toBe(failure);

    expect(f.store.markEtsyConnectionReconnectRequired).toHaveBeenCalledTimes(1);
    expect(f.store.markEtsyConnectionReconnectRequired).toHaveBeenCalledWith({ workspaceId: "w" });
    expect(f.store.importWorkspaceOrderItems).not.toHaveBeenCalled();
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });

  it("stops an active abort without cursor advancement and releases the matching owner", async () => {
    const f = fixture(); const controller = new AbortController();
    f.client.listReceiptTransactions.mockImplementation(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); });
    const prepared = await f.service.prepare({ workspaceId: "w", signal: controller.signal });
    await expect(prepared.run()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });
  it("releases the owner when client construction fails", async () => {
    const f = fixture({ createClient: () => { throw new Error("client"); } });
    await expect(f.service.prepare({ workspaceId: "w" })).rejects.toThrow("client");
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });
  it("emits exact empty progress and completion", async () => {
    const f = fixture(); f.client.listReceipts.mockResolvedValue([]);
    await (await f.service.prepare({ workspaceId: "w", onProgress: (e) => f.events.push(e) })).run();
    expect(f.events).toEqual([{ type: "progress", stage: "fetching_receipts", processed: 0, total: null }, { type: "progress", stage: "importing_items", processed: 0, total: 0 }, { type: "complete", imported: 0, existing: 0, customizationNeeded: 0, failed: 0 }]);
  });
  it("refreshes near-expired access and marks reconnect required on reauthorization", async () => {
    const refreshAccess = vi.fn().mockResolvedValue({ accessToken: "new-token" });
    let f = fixture({ refreshAccess });
    f.store.getEtsyConnectionCredentials.mockResolvedValue({ status: "connected", etsyShopId: "shop", accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: "2026-07-16T12:04:59.000Z" });
    await (await f.service.prepare({ workspaceId: "w" })).release();
    expect(refreshAccess).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w", refreshToken: "refresh", now: f.now }));
    const failure = Object.assign(new Error("reauthorize"), { category: "reauthorize" });
    f = fixture({ refreshAccess: vi.fn().mockRejectedValue(failure) });
    f.store.getEtsyConnectionCredentials.mockResolvedValue({ status: "connected", accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: "2026-07-16T12:00:00.000Z" });
    await expect(f.service.prepare({ workspaceId: "w" })).rejects.toBe(failure);
    expect(f.store.markEtsyConnectionReconnectRequired).toHaveBeenCalledWith({ workspaceId: "w" });
  });
  it("imports discovered items but withholds the cursor and counts failed receipt items", async () => {
    const f = fixture();
    f.client.listReceipts.mockResolvedValue([
      { receipt_id: 1, is_paid: true, is_shipped: false, transaction_sold_count: 3 },
      { receipt_id: 2, is_paid: true, is_shipped: false, transaction_sold_count: 1 },
    ]);
    f.client.listReceiptTransactions
      .mockRejectedValueOnce(new Error("old receipt failed"))
      .mockResolvedValueOnce([{ transaction_id: 20, listing_id: 30 }]);
    const events = [];

    const result = await (await f.service.prepare({ workspaceId: "w", onProgress: (event) => events.push(event) })).run();

    expect(result).toMatchObject({ imported: 1, failed: 3 });
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.importWorkspaceOrderItems).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "progress", stage: "importing_items", processed: 3, total: 4 });
    expect(events).toContainEqual({ type: "progress", stage: "importing_items", processed: 4, total: 4 });
    await (await f.service.prepare({ workspaceId: "w" })).run();
    const retriedReceiptCalls = f.client.listReceiptTransactions.mock.calls.filter(([request]) => request.receiptId === 1);
    expect(retriedReceiptCalls).toHaveLength(2);

  });

  it.each([
    [{ transaction_sold_count: -1 }, 1],
    [{ transaction_sold_count: 2.5 }, 1],
    [{ transaction_sold_count: 0 }, 0],
  ])("validates failed receipt transaction counts %#", async (receiptFields, expected) => {
    const f = fixture();
    f.client.listReceipts.mockResolvedValue([{ receipt_id: 1, is_paid: true, is_shipped: false, ...receiptFields }]);
    f.client.listReceiptTransactions.mockRejectedValue(new Error("receipt"));
    const result = await (await f.service.prepare({ workspaceId: "w" })).run();
    expect(result.failed).toBe(expected);
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
  });

  it("renews the owner lease before work after five minutes", async () => {
    let now = new Date("2026-07-16T12:00:00.000Z");
    const f = fixture({ clock: () => now });
    f.client.listReceiptTransactions.mockImplementation(async () => {
      now = new Date("2026-07-16T12:11:00.000Z");
      return [{ transaction_id: 2, listing_id: 3 }];
    });
    await (await f.service.prepare({ workspaceId: "w" })).run();
    expect(f.store.renewEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner", now });
  });

  it("stops without cursor advancement when lease ownership is lost", async () => {
    let now = new Date("2026-07-16T12:00:00.000Z");
    const f = fixture({ clock: () => now });
    f.store.renewEtsyImportLock.mockResolvedValue(false);
    f.client.listReceiptTransactions.mockImplementation(async () => {
      now = new Date("2026-07-16T12:06:00.000Z");
      return [{ transaction_id: 2, listing_id: 3 }];
    });
    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toMatchObject({ code: "import_lock_lost" });
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });

  it("rejects excessive receipt accumulation before transaction discovery", async () => {
    const f = fixture({ maxImportItems: 1 });
    f.client.listReceipts.mockResolvedValue([
      { receipt_id: 1, is_paid: true, is_shipped: false },
      { receipt_id: 2, is_paid: true, is_shipped: false },
    ]);
    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toMatchObject({ code: "import_too_large", statusCode: 413 });
    expect(f.client.listReceiptTransactions).not.toHaveBeenCalled();
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
  });
  it("discards more than 5,000 ineligible paged receipts before retaining one eligible receipt", async () => {
    const f = fixture();
    f.client.iterateReceiptPages = vi.fn(async function* () {
      for (let page = 0; page < 51; page += 1) {
        yield { results: Array.from({ length: 100 }, (_, index) => ({ receipt_id: page * 100 + index, is_paid: false, is_shipped: false })) };
      }
      yield { results: [{ receipt_id: 6_000, is_paid: true, is_shipped: false }] };
    });

    const result = await (await f.service.prepare({ workspaceId: "w" })).run();
    expect(result.imported).toBe(1);
    expect(f.client.listReceipts).not.toHaveBeenCalled();
    expect(f.client.listReceiptTransactions).toHaveBeenCalledTimes(1);
    expect(f.client.listReceiptTransactions).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 6_000 }));
  });

  it("fails after the 5,001st eligible paged receipt without transaction discovery", async () => {
    const f = fixture();
    f.client.iterateReceiptPages = vi.fn(async function* () {
      for (let page = 0; page < 51; page += 1) {
        yield { results: Array.from({ length: 100 }, (_, index) => ({ receipt_id: page * 100 + index, is_paid: true, is_shipped: false })) };
      }
    });

    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toMatchObject({ code: "import_too_large", statusCode: 413 });
    expect(f.client.listReceipts).not.toHaveBeenCalled();
    expect(f.client.listReceiptTransactions).not.toHaveBeenCalled();
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });

  it("renews the owner lease while consuming multi-page receipt discovery", async () => {
    let now = new Date("2026-07-16T12:00:00.000Z");
    const f = fixture({ clock: () => now });
    f.client.iterateReceiptPages = vi.fn(async function* () {
      yield { results: [{ receipt_id: 1, is_paid: false, is_shipped: false }] };
      now = new Date("2026-07-16T12:06:00.000Z");
      yield { results: [{ receipt_id: 2, is_paid: false, is_shipped: false }] };
    });

    await (await f.service.prepare({ workspaceId: "w" })).run();

    expect(f.store.renewEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner", now });
    expect(f.client.listReceiptTransactions).not.toHaveBeenCalled();
  });

  it("stops pagination immediately when lease renewal loses ownership", async () => {
    let now = new Date("2026-07-16T12:00:00.000Z");
    let yieldedPages = 0;
    const f = fixture({ clock: () => now });
    f.store.renewEtsyImportLock.mockResolvedValue(false);
    f.client.iterateReceiptPages = vi.fn(async function* () {
      yieldedPages += 1;
      yield { results: [{ receipt_id: 1, is_paid: false, is_shipped: false }] };
      now = new Date("2026-07-16T12:06:00.000Z");
      yieldedPages += 1;
      yield { results: [{ receipt_id: 2, is_paid: true, is_shipped: false }] };
      yieldedPages += 1;
      yield { results: [{ receipt_id: 3, is_paid: true, is_shipped: false }] };
    });

    await expect((await f.service.prepare({ workspaceId: "w" })).run()).rejects.toMatchObject({ code: "import_lock_lost" });
    expect(yieldedPages).toBe(2);
    expect(f.client.listReceiptTransactions).not.toHaveBeenCalled();
    expect(f.store.updateEtsySyncCursor).not.toHaveBeenCalled();
    expect(f.store.releaseEtsyImportLock).toHaveBeenCalledWith({ workspaceId: "w", lockToken: "owner" });
  });

  it("counts idempotent existing items and passes customization metadata to persistence", async () => {
    const f = fixture(); f.store.importWorkspaceOrderItems.mockResolvedValue({ importedCount: 0 });
    const result = await (await f.service.prepare({ workspaceId: "w", userId: "u" })).run();
    expect(result).toMatchObject({ imported: 0, existing: 1, customizationNeeded: 1 });
    expect(f.store.importWorkspaceOrderItems).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ source: expect.objectContaining({ customizationNeeded: true }) })],
    }));
  });

  it("preserves kind-based remaining and index preset settings when Etsy font selections are unknown", async () => {
    const enrichItem = createAmazonItemEnricher({
      presetSnapshot: {
        defaultPresetId: "preset-1",
        presets: [{
          id: "preset-1",
          lineDefaults: { fontId: "font-candlepin", bridgeMm: 0.7 },
          lineRules: [
            { match: { kind: "remaining" }, settings: { fontId: "font-somekind", horizontalScale: 1.2 } },
            { match: { kind: "index", lineIndex: 2 }, settings: { fontId: "font-candlepin", offsetXMm: 2 } },
          ],
        }],
      },
      fontOptions: [
        { id: "font-candlepin", displayName: "Candlepin" },
        { id: "font-skywalk", displayName: "Skywalk" },
        { id: "font-somekind", displayName: "Somekind" },
      ],
    });
    const f = fixture({
      enrichItem,
      normalizeTransaction: () => ({
        id: "transaction:2",
        text: "CPL EDWARDS\nRN\nBSN",
        source: {
          listingId: "3",
          customerFontSelections: [
            { lineIndex: 0, name: "Skywalk" },
            { lineIndex: 1, name: "Unknown Font" },
            { lineIndex: 2, name: "Unknown Script" },
          ],
        },
      }),
    });

    await (await f.service.prepare({ workspaceId: "w", userId: "u" })).run();

    expect(f.store.importWorkspaceOrderItems).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({
        source: expect.objectContaining({
          customerFontSelections: [
            { lineIndex: 0, name: "Skywalk" },
            { lineIndex: 1, name: "Unknown Font" },
            { lineIndex: 2, name: "Unknown Script" },
          ],
        }),
        settings: expect.objectContaining({
          lines: [
            expect.objectContaining({ fontId: "font-skywalk", bridgeMm: 0.7 }),
            expect.objectContaining({ fontId: "font-somekind", horizontalScale: 1.2 }),
            expect.objectContaining({ fontId: "font-candlepin", horizontalScale: 1.2, offsetXMm: 2 }),
          ],
        }),
      })],
    }));
  });
});
