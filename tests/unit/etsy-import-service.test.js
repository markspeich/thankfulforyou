import { describe, expect, it, vi } from "vitest";
import { createEtsyImportService, EtsyImportError } from "../../api/_lib/etsy-import-service.js";
function fixture(overrides = {}) {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const store = {
    getEtsyConnectionCredentials: vi.fn().mockResolvedValue({ status: "connected", etsyShopId: "shop", accessToken: "token", refreshToken: "refresh", accessTokenExpiresAt: "2026-07-16T13:00:00.000Z", lastSyncedAt: null }),
    acquireEtsyImportLock: vi.fn().mockResolvedValue(true), releaseEtsyImportLock: vi.fn(),
    updateEtsySyncCursor: vi.fn(), importWorkspaceOrderItems: vi.fn().mockResolvedValue({ importedCount: 1 }),
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
    expect(f.events).toEqual([{ type: "progress", stage: "fetching_receipts", processed: 0, total: null }, { type: "progress", stage: "importing", processed: 0, total: 1 }, { type: "progress", stage: "importing", processed: 1, total: 1 }, { type: "complete", imported: 1, existing: 0, customizationNeeded: 1, failed: 0 }]);
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
});
