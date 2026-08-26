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
const identifier = (value) => value == null ? null : String(value);
const serializable = (value) => {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  } catch {
    return undefined;
  }
};
const errorDetails = (error) => {
  const details = {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: typeof error?.message === "string" ? error.message : "Unknown import error.",
  };
  for (const key of ["code", "details", "hint", "statusCode"]) {
    const value = serializable(error?.[key]);
    if (value !== undefined) details[key] = value;
  }
  return details;
};
export function createEtsyImportService({ store, refreshAccess, createClient, normalizeTransaction, enrichItem = (item) => item, getPresetIdForListingId = () => null, clock = () => new Date(), randomUUID = uuid, maxImportItems = DEFAULT_MAX_IMPORT_ITEMS, logError = console.error }) {
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
    const runId = randomUUID();
    const appendAttempt = async (attempt) => {
      if (typeof store.appendEtsyImportAttempt !== "function") return;
      try {
        await store.appendEtsyImportAttempt({ runId, workspaceId, initiatedBy: userId || null, ...attempt });
      } catch (error) {
        try {
          logError({
            event: "etsy_import_attempt_audit_failed",
            runId,
            receiptId: identifier(attempt.rawReceipt?.receipt_id),
            transactionId: identifier(attempt.transactionId),
          });
        } catch {}
      }
    };
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
                eligibleReceipts.push(receipt);
              }
            }
          } else {
            const receipts = await client.listReceipts({ shopId: connection.etsyShopId, signal, ...filters });
            for (const receipt of receipts) if (eligible(receipt)) eligibleReceipts.push(receipt);
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
          let listing = {}, listingImages = [], image = {}, normalizedItem = null, item = null, stage = "fetching_listing";
          const fetchErrors = {};
          try {
            await renewIfDue();
            try { listing = await client.getListing({ listingId: transaction.listing_id, signal }); } catch (error) {
              if (aborted(error, signal)) throw error;
              if (reauth(error)) throw error;
              fetchErrors.fetching_listing = errorDetails(error);
            }
            stage = "fetching_image";
            await renewIfDue();
            try {
              const response = await client.getListingImages({ listingId: transaction.listing_id, signal });
              listingImages = Array.isArray(response) ? response : [];
              image = listingImages[0] || {};
            } catch (error) {
              if (aborted(error, signal)) throw error;
              if (reauth(error)) throw error;
              fetchErrors.fetching_images = errorDetails(error);
            }
            stage = "normalizing";
            await renewIfDue();
            normalizedItem = normalizeTransaction({ receipt, transaction, listing, image, getPresetIdForListingId });
            let enrichmentSummary = null;
            item = await enrichItem(normalizedItem, {
              onEnriched(summary) { enrichmentSummary = summary; },
            });
            if (item?.etsyImportDiagnostics && enrichmentSummary && typeof enrichmentSummary === "object") {
              item.etsyImportDiagnostics = { ...item.etsyImportDiagnostics, fontResolution: enrichmentSummary };
            }
            stage = "persisting";
            const result = await store.importWorkspaceOrderItems({ workspaceId, userId, items: [item], target: "orders", batchId: null, includePersistenceAudit: true });
            const count = Number(result?.importedCount ?? result?.importedOrderItemIds?.length ?? 0);
            imported += count; existing += Math.max(0, 1 - count);
            if (item?.source?.customizationNeeded) customizationNeeded += 1;
            const stored = Array.isArray(result?.persistenceAudit) ? result.persistenceAudit[0] : null;
            const outcome = stored?.importDecision === "existing" || count === 0 ? "existing" : "imported";
            await appendAttempt({
              orderNumber: identifier(item?.source?.orderNumber ?? receipt?.receipt_id),
              transactionId: identifier(item?.source?.transactionId ?? transaction?.transaction_id),
              listingId: identifier(item?.source?.listingId ?? transaction?.listing_id),
              outcome,
              stage: "persisted",
              rawReceipt: receipt,
              rawTransaction: transaction,
              rawListing: listing,
              rawImage: listingImages,
              normalizedItem,
              persistence: {
                outcome,
                importDecision: stored?.importDecision || (outcome === "imported" ? "new" : "existing"),
                importedCount: count,
                existingCount: Math.max(0, 1 - count),
                item,
                storedBefore: stored?.storedBefore ?? null,
                storedAfter: stored?.storedAfter ?? null,
              },
              fetchErrors: Object.keys(fetchErrors).length ? fetchErrors : null,
            });
          } catch (error) {
            await appendAttempt({
              orderNumber: identifier(item?.source?.orderNumber ?? normalizedItem?.source?.orderNumber ?? receipt?.receipt_id),
              transactionId: identifier(item?.source?.transactionId ?? normalizedItem?.source?.transactionId ?? transaction?.transaction_id),
              listingId: identifier(item?.source?.listingId ?? normalizedItem?.source?.listingId ?? transaction?.listing_id),
              outcome: "failed",
              stage,
              rawReceipt: receipt,
              rawTransaction: transaction,
              rawListing: listing,
              rawImage: listingImages,
              normalizedItem,
              persistence: {
                outcome: "failed",
                importDecision: "failed",
                item,
              },
              fetchErrors: Object.keys(fetchErrors).length ? fetchErrors : null,
              error: errorDetails(error),
            });
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
    return { run, release, lockToken, runId };
  }
  return { prepare };
}
