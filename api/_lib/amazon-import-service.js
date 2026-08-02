import { randomUUID as uuid } from "node:crypto";
import {
  buildAmazonNoteBlock,
  summarizeAmazonCustomization,
} from "./amazon-customization-normalizer.js";
import { readShipStationConfig } from "./shipstation-client.js";

const PROCESSED_TAG = "Amazon Customization Imported";
const CUSTOMIZED_URL_OPTION = "CustomizedURL";
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export class AmazonImportError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = "AmazonImportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function currentDate(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("clock must return a valid date.");
  }
  return date;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function isAbort(error, signal) {
  return Boolean(
    signal?.aborted
    || error?.name === "AbortError"
    || error?.code === "ABORT_ERR"
    || error?.code === "aborted"
    || error?.code === "customization_download_aborted",
  );
}

function isGlobalFailure(error, signal) {
  if (isAbort(error, signal)) return true;
  if (error instanceof AmazonImportError) return true;
  if (error?.code === "configuration") return true;
  if (["authentication", "authorization", "unauthorized", "forbidden", "reauthorize"].includes(error?.code)) {
    return true;
  }
  return error?.code === "request_failed"
    && (error?.statusCode === 401 || error?.statusCode === 403);
}

function isProcessed(shipment) {
  return shipment?.tags?.some((tag) => (
    tag === PROCESSED_TAG
    || (tag && typeof tag === "object" && tag.name === PROCESSED_TAG)
  )) ?? false;
}

function customizationUrl(item) {
  const option = item?.options?.find((candidate) => (
    candidate
    && typeof candidate === "object"
    && candidate.name === CUSTOMIZED_URL_OPTION
  ));
  return typeof option?.value === "string" ? option.value.trim() : "";
}

function emitDiagnostic(diagnostics, level, event, context) {
  try {
    Promise.resolve(diagnostics?.[level]?.(event, context)).catch(() => {});
  } catch {
    // Diagnostics must not affect imports.
  }
}

function safeCustomizationSummary(customization) {
  try {
    return summarizeAmazonCustomization(customization);
  } catch {
    return {
      format: "unknown",
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 0,
      acceptedTextCount: 0,
      acceptedConfigurationCount: 0,
      acceptedLabels: [],
      rejectedCounts: {},
    };
  }
}

function shipmentDiagnosticContext(shipment) {
  return {
    shipmentId: shipment?.shipment_id,
    orderNumber: shipment?.amazon_order_id
      ?? shipment?.shipment_number
      ?? shipment?.external_shipment_id
      ?? shipment?.external_order_id
      ?? shipment?.order_number,
  };
}

function itemDiagnosticContext(shipment, item) {
  return {
    ...shipmentDiagnosticContext(shipment),
    orderItemId: item?.external_order_item_id,
  };
}

export function createAmazonImportService({
  store,
  createShipStationClient,
  fetchCustomizationJson,
  normalizeItem,
  enrichItem = (item) => item,
  appendNoteBlocks,
  diagnostics,
  clock = () => new Date(),
  randomUUID = uuid,
  setIntervalFn = (callback, milliseconds) => setInterval(callback, milliseconds),
  clearIntervalFn = (handle) => clearInterval(handle),
}) {
  async function prepare({
    workspaceId,
    userId,
    signal,
    onProgress = () => {},
  }) {
    if (signal?.aborted) throw abortError();
    const started = currentDate(clock);
    const lockToken = randomUUID();
    const acquired = await store.acquireAmazonImportLock({
      workspaceId,
      lockToken,
      now: started,
    });
    if (signal?.aborted) {
      if (acquired) {
        try {
          await store.releaseAmazonImportLock({ workspaceId, lockToken });
        } catch {}
      }
      throw abortError();
    }
    if (!acquired) {
      throw new AmazonImportError(
        "import_in_progress",
        "An Amazon import is already in progress.",
        409,
      );
    }

    let runState = "prepared";
    let hasRun = false;
    let releaseState = "held";
    let releasePromise = null;
    let heartbeatHandle = null;
    let renewalPromise = null;
    let lastRenewedAt = started.getTime();
    let activeFailure = null;
    let primaryReleaseError;
    let hasPrimaryReleaseError = false;
    let rejectActiveFailure;
    let abortListener = null;
    const activeFailurePromise = new Promise((_, reject) => {
      rejectActiveFailure = reject;
    });
    activeFailurePromise.catch(() => {});

    const inactiveError = () => new AmazonImportError(
      "import_not_active",
      "The Amazon import is no longer active.",
      409,
    );
    const alreadyStartedError = () => new AmazonImportError(
      "import_already_started",
      "This Amazon import run has already started.",
      409,
    );
    const lostLockError = () => new AmazonImportError(
      "import_lock_lost",
      "The Amazon import lease was lost. Please retry.",
      409,
    );
    const failActive = (error) => {
      if (activeFailure) return activeFailure;
      activeFailure = error;
      rejectActiveFailure(error);
      return error;
    };
    const stopHeartbeat = () => {
      if (heartbeatHandle != null) {
        clearIntervalFn(heartbeatHandle);
        heartbeatHandle = null;
      }
      if (abortListener) {
        signal?.removeEventListener?.("abort", abortListener);
        abortListener = null;
      }
    };
    const checkActive = () => {
      if (activeFailure) throw activeFailure;
      if (signal?.aborted) throw failActive(abortError());
      if (runState !== "running" || releaseState !== "held") {
        throw failActive(inactiveError());
      }
    };
    const renewIfDue = async () => {
      checkActive();
      if (renewalPromise) return renewalPromise;
      const now = currentDate(clock);
      if (now.getTime() - lastRenewedAt < HEARTBEAT_INTERVAL_MS) return;
      const attempt = (async () => {
        if (signal?.aborted) throw abortError();
        const renewed = await store.renewAmazonImportLock({
          workspaceId,
          lockToken,
          now,
        });
        if (signal?.aborted) throw abortError();
        if (!renewed) throw lostLockError();
        lastRenewedAt = now.getTime();
        checkActive();
      })();
      renewalPromise = attempt;
      try {
        return await attempt;
      } catch (error) {
        throw failActive(error);
      } finally {
        if (renewalPromise === attempt) renewalPromise = null;
      }
    };
    const ensureActive = async () => {
      checkActive();
      await renewIfDue();
      checkActive();
    };
    const awaitActive = async (operation) => {
      await ensureActive();
      const pending = operation();
      const result = await Promise.race([pending, activeFailurePromise]);
      await ensureActive();
      return result;
    };
    const startHeartbeat = () => {
      abortListener = () => failActive(abortError());
      signal?.addEventListener?.("abort", abortListener, { once: true });
      if (signal?.aborted) abortListener();
      heartbeatHandle = setIntervalFn(() => {
        void renewIfDue().catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatHandle?.unref?.();
    };

    const release = () => {
      if (releaseState === "released") return Promise.resolve();
      if (releasePromise) return releasePromise;
      if (runState === "prepared" || runState === "running") runState = "finished";
      stopHeartbeat();
      failActive(inactiveError());
      releaseState = "releasing";
      const pendingRenewal = renewalPromise;
      const attempt = (async () => {
        if (pendingRenewal) {
          try {
            await pendingRenewal;
          } catch {}
        }
        await store.releaseAmazonImportLock({ workspaceId, lockToken });
        releaseState = "released";
      })();
      const tracked = attempt.finally(() => {
        if (releaseState !== "released") releaseState = "held";
        if (releasePromise === tracked) releasePromise = null;
      });
      releasePromise = tracked;
      return tracked;
    };

    let client;
    let amazonStoreId;
    try {
      if (signal?.aborted) throw abortError();
      const config = readShipStationConfig();
      amazonStoreId = config.amazonStoreId;
      client = createShipStationClient({ apiKey: config.apiKey });
      if (signal?.aborted) throw abortError();
    } catch (error) {
      try {
        await release();
      } catch {}
      throw error;
    }

    const run = async () => {
      if (hasRun) throw alreadyStartedError();
      if (runState !== "prepared" || releaseState !== "held") {
        const error = inactiveError();
        emitDiagnostic(diagnostics, "error", "run.failed", {
          stage: "preparation",
          error,
        });
        throw error;
      }
      hasRun = true;
      runState = "running";
      startHeartbeat();
      let primaryError = null;
      let result = null;
      let currentStage = null;
      let currentShipmentContext = {};
      let currentFailureContext = {};
      try {
        emitDiagnostic(diagnostics, "info", "run.started");
        currentStage = "progress_delivery";
        await awaitActive(() => onProgress({
          type: "progress",
          stage: "fetching_shipments",
          processed: 0,
          total: null,
        }));

        const shipments = [];
        currentStage = "shipment_fetch";
        const shipmentIterator = client.iteratePendingShipments({
          storeId: amazonStoreId,
          signal,
        })[Symbol.asyncIterator]();
        while (true) {
          const next = await awaitActive(() => shipmentIterator.next());
          if (next.done) break;
          shipments.push(next.value);
        }
        emitDiagnostic(diagnostics, "info", "shipments.fetched", {
          shipmentCount: shipments.length,
        });
        currentStage = "progress_delivery";
        await awaitActive(() => onProgress({
          type: "progress",
          stage: "processing_shipments",
          processed: 0,
          total: shipments.length,
        }));

        let processedShipments = 0;
        let importedItems = 0;
        let existingItems = 0;
        let alreadyProcessedShipments = 0;
        let customizationNeeded = 0;
        let failed = 0;

        for (let index = 0; index < shipments.length; index += 1) {
          const shipment = shipments[index];
          const shipmentContext = shipmentDiagnosticContext(shipment);
          const processedTagPresent = isProcessed(shipment);
          currentShipmentContext = shipmentContext;
          currentStage = null;
          currentFailureContext = {};
          await ensureActive();
          emitDiagnostic(diagnostics, "info", "shipment.started", {
            ...shipmentContext,
            itemCount: Array.isArray(shipment?.items) ? shipment.items.length : 0,
            processedTagPresent,
          });
          if (processedTagPresent) {
            alreadyProcessedShipments += 1;
            emitDiagnostic(diagnostics, "info", "shipment.skipped", {
              ...shipmentContext,
              skipReason: "processed_tag_present",
            });
          } else {
            try {
              const normalizedItems = [];
              const itemRecords = [];
              const noteBlocks = [];
              for (const item of shipment.items) {
                currentStage = "item_start";
                currentFailureContext = itemDiagnosticContext(shipment, item);
                await ensureActive();
                const url = customizationUrl(item);
                const itemContext = currentFailureContext;
                emitDiagnostic(diagnostics, "info", "item.started", {
                  ...itemContext,
                  customizationUrlPresent: Boolean(url),
                });
                let customization = {};
                if (url) {
                  currentStage = "customization_fetch";
                  customization = await awaitActive(
                    () => fetchCustomizationJson({ url, signal }),
                  );
                  emitDiagnostic(diagnostics, "info", "item.customization_fetched", {
                    ...itemContext,
                    summary: safeCustomizationSummary(customization),
                  });
                }
                currentStage = "normalization";
                const normalized = normalizeItem({ shipment, item, customization });
                emitDiagnostic(diagnostics, "info", "item.normalized", {
                  ...itemContext,
                  textLineCount: normalized?.text ? String(normalized.text).split("\n").length : 0,
                  personalizationResponseCount: Array.isArray(normalized?.source?.personalizationResponses)
                    ? normalized.source.personalizationResponses.length
                    : 0,
                  fontSelectionCount: Array.isArray(normalized?.source?.customerFontSelections)
                    ? normalized.source.customerFontSelections.length
                    : 0,
                  customizationNeeded: Boolean(normalized?.source?.customizationNeeded),
                });
                let enrichmentSummary;
                currentStage = "enrichment";
                const enriched = enrichItem.supportsPerCallEnrichmentSummary
                  ? enrichItem(normalized, {
                    onEnriched(summary) { enrichmentSummary = summary; },
                  })
                  : enrichItem(normalized);
                emitDiagnostic(diagnostics, "info", "item.enriched", {
                  ...itemContext,
                  presetId: enrichmentSummary?.presetId ?? enriched?.presetId,
                  designLineCount: enrichmentSummary?.designLineCount
                    ?? (Array.isArray(enriched?.settings?.lines) ? enriched.settings.lines.length : 0),
                  selectionCount: enrichmentSummary?.selectionCount ?? 0,
                  recognizedCount: enrichmentSummary?.recognizedCount ?? 0,
                  unknownCount: enrichmentSummary?.unknownCount ?? 0,
                  effectiveFontIds: enrichmentSummary?.effectiveFontIds ?? [],
                });
                normalizedItems.push(enriched);
                itemRecords.push({ item: enriched, context: itemContext });
                if (url) {
                  currentStage = "notes_build";
                  noteBlocks.push({
                    itemId: item.external_order_item_id,
                    block: buildAmazonNoteBlock({
                      productTitle: item.name,
                      orderItemId: item.external_order_item_id,
                      fields: normalized?.source?.personalizationResponses ?? [],
                    }),
                  });
                }
              }

              currentFailureContext = {};
              const existingNotes = shipment.notes_to_buyer ?? "";
              currentStage = "notes_update";
              const noteResult = appendNoteBlocks({
                existingNotes,
                blocks: noteBlocks,
              });
              if (noteResult.notes !== existingNotes) {
                await awaitActive(() => client.updateNotesToBuyer({
                  shipmentId: shipment.shipment_id,
                  notesToBuyer: noteResult.notes,
                  shipTo: shipment.ship_to,
                  shipFrom: shipment.ship_from,
                  warehouseId: shipment.warehouse_id,
                  signal,
                }));
              }

              currentStage = "persistence";
              const persistence = await awaitActive(
                () => store.importAmazonOrderItemsTransactional({
                  workspaceId,
                  userId,
                  items: normalizedItems,
                }),
              );
              importedItems += persistence.importedOrderItemIds.length;
              existingItems += persistence.existingOrderItemIds.length;
              const importedIds = new Set(persistence.importedOrderItemIds);
              const existingIds = new Set(persistence.existingOrderItemIds);
              for (const record of itemRecords) {
                const persistenceOutcome = importedIds.has(record.item?.id)
                  ? "imported"
                  : existingIds.has(record.item?.id) ? "existing" : null;
                if (persistenceOutcome) {
                  emitDiagnostic(diagnostics, "info", "item.persisted", {
                    ...record.context,
                    persistenceOutcome,
                  });
                }
              }
              customizationNeeded += normalizedItems.filter(
                (item) => item?.source?.customizationNeeded,
              ).length;

              currentStage = "tag_update";
              await awaitActive(() => client.addShipmentTag({
                shipmentId: shipment.shipment_id,
                tagName: PROCESSED_TAG,
                signal,
              }));
              processedShipments += 1;
              emitDiagnostic(diagnostics, "info", "shipment.completed", {
                ...shipmentContext,
                importedItems: persistence.importedOrderItemIds.length,
                existingItems: persistence.existingOrderItemIds.length,
                notesUpdated: noteResult.notes !== existingNotes,
                processedTagUpdated: true,
              });
            } catch (error) {
              if (isGlobalFailure(error, signal)) throw error;
              emitDiagnostic(diagnostics, "error", "shipment.failed", {
                ...shipmentContext,
                ...currentFailureContext,
                stage: currentStage,
                error,
              });
              failed += 1;
            }
          }

          currentStage = null;
          currentFailureContext = {};
          currentStage = "progress_delivery";
          await awaitActive(() => onProgress({
            type: "progress",
            stage: "processing_shipments",
            processed: index + 1,
            total: shipments.length,
          }));
          currentShipmentContext = {};
        }

        currentStage = "progress_delivery";
        currentShipmentContext = {};
        currentFailureContext = {};
        await ensureActive();
        result = {
          type: "complete",
          processedShipments,
          importedItems,
          existingItems,
          alreadyProcessedShipments,
          customizationNeeded,
          failed,
        };
        await awaitActive(() => onProgress(result));
        currentStage = null;
      } catch (error) {
        primaryError = error;
        emitDiagnostic(diagnostics, "error", "run.failed", {
          ...currentShipmentContext,
          ...currentFailureContext,
          stage: currentStage,
          error,
        });
        throw error;
      } finally {
        stopHeartbeat();
        runState = "finished";
        try {
          await release();
        } catch (releaseError) {
          if (!primaryError) {
            primaryReleaseError = releaseError;
            hasPrimaryReleaseError = true;
            emitDiagnostic(diagnostics, "error", "run.failed", {
              stage: "release",
              error: releaseError,
            });
            throw releaseError;
          }
        }
      }
      emitDiagnostic(diagnostics, "info", "run.completed", result);
      return result;
    };

    return {
      run,
      release,
      lockToken,
      reportsRunFailures: true,
      stageForError(error) {
        return hasPrimaryReleaseError && error === primaryReleaseError ? "release" : null;
      },
    };
  }

  return { prepare };
}
