import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import * as amazonImportStore from "./_lib/amazon-import-store.js";
import { createShipStationClient } from "./_lib/shipstation-client.js";
import { fetchAmazonCustomizationJson } from "./_lib/amazon-customization-archive.js";
import { appendAmazonNoteBlocks, normalizeShipStationItem } from "./_lib/amazon-customization-normalizer.js";
import { AmazonImportError, createAmazonImportService } from "./_lib/amazon-import-service.js";
import { isResponseWritable, writeNdjson } from "./_lib/ndjson-writer.js";

const FALLBACK_ERROR = "Unable to import Amazon orders.";
const SAFE_AMAZON_ERROR_MESSAGES = Object.freeze({
  import_in_progress: "An Amazon import is already in progress.",
  import_lock_lost: "The Amazon import lease was lost. Please retry.",
  import_not_active: "The Amazon import is no longer active.",
  import_already_started: "This Amazon import run has already started.",
});
const SAFE_AUTH_ERROR_MESSAGES = Object.freeze({
  401: "Authentication required.",
  403: "Shared workspace access denied.",
  503: "Unable to reach Supabase auth from this dev server process.",
});

const PROGRESS_STAGES = new Set(["fetching_shipments", "processing_shipments"]);

function safeProgressFrame(event) {
  const numericFields = event?.type === "progress"
    ? ["processed", "total"]
    : event?.type === "complete"
      ? ["processedShipments", "importedItems", "existingItems", "alreadyProcessedShipments", "customizationNeeded", "failed"]
      : [];
  if (!numericFields.length) return {};

  const frame = { type: event.type };
  if (event.type === "progress" && PROGRESS_STAGES.has(event.stage)) frame.stage = event.stage;
  for (const field of numericFields) {
    const value = event[field];
    if (typeof value === "number" || value === null) frame[field] = value;
  }
  return frame;
}

function publicError(error) {
  const message = error instanceof AmazonImportError ? SAFE_AMAZON_ERROR_MESSAGES[error.code] : null;
  if (message) {
    return { statusCode: 409, body: { error: message, code: error.code } };
  }
  const authMessage = error?.expose && Number.isInteger(error.statusCode)
    ? SAFE_AUTH_ERROR_MESSAGES[error.statusCode]
    : null;
  if (authMessage) {
    return { statusCode: error.statusCode, body: { error: authMessage } };
  }
  return { statusCode: 500, body: { error: FALLBACK_ERROR } };
}

function streamedErrorFrame(error) {
  return {
    type: "error",
    code: error instanceof AmazonImportError && SAFE_AMAZON_ERROR_MESSAGES[error.code] ? error.code : "import_failed",
    message: FALLBACK_ERROR,
  };
}

export function createAmazonImportHandler({
  resolveAuth = resolveProductionBatchAuth,
  serviceFactory = createAmazonImportService,
  dependencies = {},
} = {}) {
  return async (req, res) => {
    let prepared;
    let streaming = false;
    let transportFailed = false;
    let releasePromise;
    const release = () => {
      if (!prepared) return Promise.resolve();
      if (!releasePromise) releasePromise = Promise.resolve().then(() => prepared.release());
      return releasePromise;
    };

    try {
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "Method not allowed." });
        return;
      }

      const auth = await resolveAuth(req);
      const service = serviceFactory({
        store: dependencies.store || amazonImportStore,
        createShipStationClient: dependencies.createShipStationClient || createShipStationClient,
        fetchCustomizationJson: dependencies.fetchCustomizationJson || fetchAmazonCustomizationJson,
        normalizeItem: dependencies.normalizeItem || normalizeShipStationItem,
        appendNoteBlocks: dependencies.appendNoteBlocks || appendAmazonNoteBlocks,
      });
      prepared = await service.prepare({
        ...auth,
        signal: req.signal,
        async onProgress(event) {
          if (!streaming) return;
          try {
            await writeNdjson(res, safeProgressFrame(event), { signal: req.signal });
          } catch (error) {
            transportFailed = true;
            throw error;
          }
        },
      });

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.flushHeaders?.();
      streaming = true;
      await prepared.run();
      await release();
      if (isResponseWritable(res)) res.end();
    } catch (error) {
      try { await release(); } catch { /* The original run or response failure remains primary. */ }
      if (!streaming) {
        const response = publicError(error);
        res.status(response.statusCode).json(response.body);
        return;
      }
      if (transportFailed || !isResponseWritable(res)) return;
      try {
        await writeNdjson(res, streamedErrorFrame(error), { signal: req.signal });
        if (isResponseWritable(res)) res.end();
      } catch {
        // The connection is no longer writable.
      }
    }
  };
}

export default createAmazonImportHandler();
