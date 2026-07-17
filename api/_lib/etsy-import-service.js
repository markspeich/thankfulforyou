import { randomUUID as uuid } from "node:crypto";
export class EtsyImportError extends Error {
  constructor(code, message, statusCode = 500) { super(message); this.code = code; this.statusCode = statusCode; }
}
const OVERLAP = 300000;
const INITIAL = 90 * 86400000;
export const DEFAULT_MAX_IMPORT_ITEMS = 5_000;
const HEARTBEAT_INTERVAL = 300_000;
const reauth = (error) => error?.category === "reauthorize" || error?.code === "reauthorize";
const aborted = (error, signal) => Boolean(signal?.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR");
const eligible = (r) => { const s = String(r?.status || "").toLowerCase(); return r?.is_paid === true && r?.is_shipped === false && r?.was_canceled !== true && r?.was_cancelled !== true && !["canceled", "cancelled"].includes(s); };
const compactReceipt = (r) => ({ receipt_id: r.receipt_id, name: r.name, buyer_name: r.buyer_name, create_timestamp: r.create_timestamp, update_timestamp: r.update_timestamp, paid_timestamp: r.paid_timestamp, transaction_sold_count: r.transaction_sold_count });
export function createEtsyImportService({ store, refreshAccess, createClient, normalizeTransaction, getPresetIdForListingId = () => null, clock = () => new Date(), randomUUID = uuid, maxImportItems = DEFAULT_MAX_IMPORT_ITEMS }) {
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
    let released = false;
    const release = async () => { if (!released) { released = true; await store.releaseEtsyImportLock({ workspaceId, lockToken }); } };
    let client;
    let lastRenewedAt = started.getTime();
    const renewIfDue = async () => {
      const now = clock();
      if (now.getTime() - lastRenewedAt < HEARTBEAT_INTERVAL) return;
      if (!await store.renewEtsyImportLock({ workspaceId, lockToken, now })) {
        throw new EtsyImportError("import_lock_lost", "The Etsy import lease was lost. Please retry.", 409);
      }
      lastRenewedAt = now.getTime();
    };
    try { client = createClient({ getAccessToken: async () => token }); }
    catch (error) { await release(); throw error; }
    const run = async () => {
      try {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await onProgress({ type: "progress", stage: "fetching_receipts", processed: 0, total: null });
        const filters = connection.lastSyncedAt ? { min_last_modified: Math.floor((Date.parse(connection.lastSyncedAt) - OVERLAP) / 1000) } : { min_created: Math.floor((started.getTime() - INITIAL) / 1000) };
        const eligibleReceipts = [];
        try {
          if (typeof client.iterateReceiptPages === "function") {
            for await (const page of client.iterateReceiptPages({ shopId: connection.etsyShopId, signal, ...filters })) {
              for (const receipt of page.results) {
              if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
              await renewIfDue();
                if (!eligible(receipt)) continue;
                if (eligibleReceipts.length >= maxImportItems) throw new EtsyImportError("import_too_large", "This Etsy import is too large. Please retry with a smaller window.", 413);
                eligibleReceipts.push(compactReceipt(receipt));
              }
            }
          } else {
            const receipts = await client.listReceipts({ shopId: connection.etsyShopId, signal, ...filters });
            for (const receipt of receipts) if (eligible(receipt)) eligibleReceipts.push(compactReceipt(receipt));
            if (eligibleReceipts.length > maxImportItems) throw new EtsyImportError("import_too_large", "This Etsy import is too large. Please retry with a smaller window.", 413);
          }
        } catch (error) { if (reauth(error)) await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
        const work = []; let failed = 0, discoveryFailed = false, expectedItems = 0;
        for (let receiptIndex = 0; receiptIndex < eligibleReceipts.length; receiptIndex += 1) {
          const receipt = eligibleReceipts[receiptIndex]; await renewIfDue();
          try {
            const transactions = await client.listReceiptTransactions({ shopId: connection.etsyShopId, receiptId: receipt.receipt_id, signal });
            if (expectedItems + transactions.length > maxImportItems) throw new EtsyImportError("import_too_large", "This Etsy import is too large. Please retry with a smaller window.", 413);
            expectedItems += transactions.length;
            work.push(...transactions.map((transaction) => ({ receiptIndex, transaction })));
          } catch (error) {
            if (aborted(error, signal)) throw error;
            if (reauth(error)) { await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
            if (error instanceof EtsyImportError) throw error;
            discoveryFailed = true;
            const soldCount = Number.isInteger(receipt?.transaction_sold_count) && receipt.transaction_sold_count >= 0 ? receipt.transaction_sold_count : 1;
            if (expectedItems + soldCount > maxImportItems) throw new EtsyImportError("import_too_large", "This Etsy import is too large. Please retry with a smaller window.", 413);
            expectedItems += soldCount;
            failed += soldCount;
          }
        }
        await onProgress({ type: "progress", stage: "importing_items", processed: failed, total: expectedItems });
        let imported = 0, existing = 0, customizationNeeded = 0, processed = failed;
        for (const { receiptIndex, transaction } of work) {
          const receipt = eligibleReceipts[receiptIndex]; await renewIfDue();
          try {
            let listing = {}, image = {};
            await renewIfDue();
            try { listing = await client.getListing({ listingId: transaction.listing_id, signal }); } catch (error) {
              if (aborted(error, signal)) throw error;
              if (reauth(error)) throw error;
            }
            await renewIfDue();
            try { image = (await client.getListingImages({ listingId: transaction.listing_id, signal }))[0] || {}; } catch (error) {
              if (aborted(error, signal)) throw error;
              if (reauth(error)) throw error;
            }
            await renewIfDue();
            const item = normalizeTransaction({ receipt, transaction, listing, image, getPresetIdForListingId });
            const result = await store.importWorkspaceOrderItems({ workspaceId, userId, items: [item], target: "orders", batchId: null });
            const count = Number(result?.importedCount ?? result?.importedOrderItemIds?.length ?? 0);
            imported += count; existing += Math.max(0, 1 - count);
            if (item?.source?.customizationNeeded) customizationNeeded += 1;
          } catch (error) {
            if (aborted(error, signal)) throw error;
            if (reauth(error)) { await store.markEtsyConnectionReconnectRequired({ workspaceId }); throw error; }
            failed += 1;
          }
          processed += 1;
          await onProgress({ type: "progress", stage: "importing_items", processed, total: expectedItems });
        }
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (!discoveryFailed) await store.updateEtsySyncCursor({ workspaceId, lastSyncedAt: started.toISOString() });
        const result = { type: "complete", imported, existing, customizationNeeded, failed };
        await onProgress(result); return result;
      } finally { await release(); }
    };
    return { run, release, lockToken };
  }
  return { prepare };
}
