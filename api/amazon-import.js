import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import * as amazonImportStore from "./_lib/amazon-import-store.js";
import { createShipStationClient, ShipStationError } from "./_lib/shipstation-client.js";
import { fetchAmazonCustomizationJson } from "./_lib/amazon-customization-archive.js";
import { appendAmazonNoteBlocks, normalizeShipStationItem } from "./_lib/amazon-customization-normalizer.js";
import { AmazonImportError, createAmazonImportService } from "./_lib/amazon-import-service.js";
import { isResponseWritable, writeNdjson } from "./_lib/ndjson-writer.js";
import { loadPresetSnapshot } from "./_lib/preset-store.js";
import { listWorkspaceFonts } from "./_lib/font-store.js";
import { createAmazonItemEnricher } from "./_lib/amazon-import-enrichment.js";

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
const SAFE_SHIPSTATION_ERROR_CODES = new Set(["configuration", "invalid_response", "aborted", "temporary", "rate_limited", "request_failed"]);
const SAFE_SHIPSTATION_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;


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

function errorLogMetadata(error, { stage, streaming }) {
  const isAmazonImportError = error instanceof AmazonImportError;
  const isShipStationError = error instanceof ShipStationError;
  return {
    stage,
    errorName: isAmazonImportError ? "AmazonImportError" : isShipStationError ? "ShipStationError" : null,
    errorCode: isAmazonImportError && SAFE_AMAZON_ERROR_MESSAGES[error.code]
      ? error.code
      : isShipStationError && SAFE_SHIPSTATION_ERROR_CODES.has(error.code) ? error.code : null,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    requestId: isShipStationError && typeof error.requestId === "string" && SAFE_SHIPSTATION_REQUEST_ID.test(error.requestId) ? error.requestId : null,
    streaming,

  };
}

function failureStage(prepared, error, fallback) {
  try {
    return prepared?.stageForError?.(error) === "release" ? "release" : fallback;
  } catch {
    return fallback;
  }
}

function streamedErrorFrame(error) {
  return {
    type: "error",
    code: error instanceof AmazonImportError && SAFE_AMAZON_ERROR_MESSAGES[error.code] ? error.code : "import_failed",
    message: FALLBACK_ERROR,
  };
}

function createRequestCancellation(req, onAbort) {
  const controller = new AbortController();
  const sourceSignal = req?.signal;
  let cleaned = false;
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
      onAbort();
    }
  };
  const onLegacyError = (error) => {
    if (error?.message === "aborted") abort();
  };
  if (sourceSignal) {
    if (sourceSignal.aborted) abort();
    else sourceSignal.addEventListener?.("abort", abort, { once: true });
  }
  req?.on?.("error", onLegacyError);
  return {
    signal: controller.signal,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      sourceSignal?.removeEventListener?.("abort", abort);
      req?.off?.("error", onLegacyError);
    },
  };

}
export function createAmazonImportHandler({
  resolveAuth = resolveProductionBatchAuth,
  serviceFactory = createAmazonImportService,
  dependencies = {},
  waitUntil = vercelWaitUntil,
} = {}) {
  return async (req, res) => {
    let prepared;
    let preparePromise;
    let streaming = false;
    let transportFailed = false;
    let requestCancellation;
    let releasePromise;
    let signal;
    let stage = "auth";
    const protectLifecycle = (promise) => {
      try {
        waitUntil(Promise.resolve(promise).catch(() => {}));
      } catch {
        // Local development has no Vercel request lifecycle context.
      }
    };
    const release = () => {
      if (!prepared) return Promise.resolve();
      if (!releasePromise) {
        releasePromise = Promise.resolve().then(() => prepared.release());
        protectLifecycle(releasePromise);
      }
      return releasePromise;
    };

    try {
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "Method not allowed." });
        return;
      }

      requestCancellation = createRequestCancellation(req, () => {
        if (prepared) void release().catch(() => {});
        else if (preparePromise) protectLifecycle(preparePromise);
      });
      signal = requestCancellation.signal;

      const auth = await resolveAuth(req);
      const needsWorkspaceContext = serviceFactory === createAmazonImportService
        || dependencies.loadPresetSnapshot
        || dependencies.listWorkspaceFonts;
      let enrichItem = dependencies.enrichItem;
      if (!enrichItem && needsWorkspaceContext) {
        const [presetSnapshot, fonts] = await Promise.all([
          (dependencies.loadPresetSnapshot || loadPresetSnapshot)(auth.workspaceId),
          (dependencies.listWorkspaceFonts || listWorkspaceFonts)({ workspaceId: auth.workspaceId }),
        ]);
        enrichItem = createAmazonItemEnricher({
          presetSnapshot,
          fontOptions: (fonts || []).map((font) => ({
            id: font?.id,
            displayName: font?.displayName ?? font?.display_name,
            label: font?.label,
          })),
        });
      }
      const service = serviceFactory({
        store: dependencies.store || amazonImportStore,
        createShipStationClient: dependencies.createShipStationClient || createShipStationClient,
        fetchCustomizationJson: dependencies.fetchCustomizationJson || fetchAmazonCustomizationJson,
        normalizeItem: dependencies.normalizeItem || normalizeShipStationItem,
        appendNoteBlocks: dependencies.appendNoteBlocks || appendAmazonNoteBlocks,
        ...(enrichItem ? { enrichItem } : {}),
      });
      stage = "prepare";
      preparePromise = service.prepare({
        ...auth,
        signal,
        async onProgress(event) {
          if (!streaming) return;
          try {
            await writeNdjson(res, safeProgressFrame(event), { signal });
          } catch (error) {
            transportFailed = true;
            throw error;
          }
        },
      });
      prepared = await preparePromise;

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.flushHeaders?.();
      streaming = true;
      stage = "run";
      await prepared.run();
      stage = "release";
      await release();
      if (isResponseWritable(res)) res.end();
    } catch (error) {
      console.error("Amazon import API error", errorLogMetadata(error, { stage: failureStage(prepared, error, stage), streaming }));
      try { await release(); } catch { /* The original run or response failure remains primary. */ }
      if (!streaming) {
        const response = publicError(error);
        res.status(response.statusCode).json(response.body);
        return;
      }
      if (transportFailed || !isResponseWritable(res)) return;
      try {
        await writeNdjson(res, streamedErrorFrame(error), { signal });
        if (isResponseWritable(res)) res.end();
      } catch {
        // The connection is no longer writable.
      }
    } finally {
      requestCancellation?.cleanup();
    }
  };
}

export default createAmazonImportHandler();
