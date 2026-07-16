import { randomUUID as uuid } from "node:crypto";
export class EtsyImportError extends Error {
  constructor(code, message, statusCode = 500) { super(message); this.code = code; this.statusCode = statusCode; }
}
const OVERLAP = 300000;
const INITIAL = 90 * 86400000;
const reauth = (error) => error?.category === "reauthorize" || error?.code === "reauthorize";
const eligible = (r) => { const s = String(r?.status || "").toLowerCase(); return r?.is_paid === true && r?.is_shipped === false && r?.was_canceled !== true && r?.was_cancelled !== true && !["canceled", "cancelled"].includes(s); };
export function createEtsyImportService({ store, refreshAccess, createClient, normalizeTransaction, getPresetIdForListingId = () => null, clock = () => new Date(), randomUUID = uuid }) {
  async function prepare({ workspaceId, userId, signal, onProgress = () => {} }) {
    const started = clock();
    let connection = await store.getEtsyConnectionCredentials({ workspaceId });
    if (!connection || connection.status !== "connected") throw new EtsyImportError("etsy_not_connected", "Connect Etsy before importing orders.", 409);
    let token = connection.accessToken;
    if (Date.parse(connection.accessTokenExpiresAt) <= started.getTime() + OVERLAP) {
      try { token = (await refreshAccess({ workspaceId, refreshToken: connection.refreshToken, now: started })).accessToken; }
      catch (error) { if (reauth(error)) await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
    }
    const lockToken = randomUUID();
    if (!await store.acquireEtsyImportLock({ workspaceId, now: started, lockToken })) throw new EtsyImportError("import_in_progress", "An Etsy import is already in progress.", 409);
    const client = createClient({ getAccessToken: async () => token });
    let released = false;
    const release = async () => { if (!released) { released = true; await store.releaseEtsyImportLock({ workspaceId, lockToken }); } };
    const run = async () => {
      try {
        onProgress({ type: "progress", stage: "fetching_receipts", processed: 0, total: null });
        const filters = connection.lastSyncedAt ? { min_last_modified: Math.floor((Date.parse(connection.lastSyncedAt) - OVERLAP) / 1000) } : { min_created: Math.floor((started.getTime() - INITIAL) / 1000) };
        let receipts;
        try { receipts = await client.listReceipts({ shopId: connection.etsyShopId, signal, ...filters }); }
        catch (error) { if (reauth(error)) await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
        const work = []; let failed = 0;
        for (const receipt of receipts.filter(eligible)) {
          try {
            const transactions = await client.listReceiptTransactions({ shopId: connection.etsyShopId, receiptId: receipt.receipt_id, signal });
            work.push(...transactions.map((transaction) => ({ receipt, transaction })));
          } catch (error) {
            if (reauth(error)) { await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
            failed += 1;
          }
        }
        onProgress({ type: "progress", stage: "importing", processed: 0, total: work.length });
        let imported = 0, existing = 0, customizationNeeded = 0, processed = 0;
        for (const { receipt, transaction } of work) {
          try {
            let listing = {}, image = {};
            try { listing = await client.getListing({ listingId: transaction.listing_id, signal }); } catch {}
            try { image = (await client.getListingImages({ listingId: transaction.listing_id, signal }))[0] || {}; } catch {}
            const item = normalizeTransaction({ receipt, transaction, listing, image, getPresetIdForListingId });
            const result = await store.importWorkspaceOrderItems({ workspaceId, userId, items: [item], target: "orders", batchId: null });
            const count = Number(result?.importedCount ?? result?.importedOrderItemIds?.length ?? 0);
            imported += count; existing += Math.max(0, 1 - count);
            if (item?.source?.customizationNeeded) customizationNeeded += 1;
          } catch (error) {
            if (reauth(error)) { await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
            failed += 1;
          }
          processed += 1;
          onProgress({ type: "progress", stage: "importing", processed, total: work.length });
        }
        await store.updateEtsySyncCursor({ workspaceId, lastSyncedAt: started.toISOString() });
        const result = { type: "complete", imported, existing, customizationNeeded, failed };
        onProgress(result); return result;
      } finally { await release(); }
    };
    return { run, release, lockToken };
  }
  return { prepare };
}
