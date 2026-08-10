import { randomUUID as uuid } from "node:crypto";
import {
  buildAmazonNoteBlock,
  summarizeAmazonCustomization,
} from "./amazon-customization-normalizer.js";
import { readShipStationConfig } from "./shipstation-client.js";
import { safeAmazonImportError } from "./amazon-import-diagnostics.js";

const PROCESSED_TAG = "Amazon Customization Imported";
const CUSTOMIZED_URL_OPTION = "CustomizedURL";
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_PUBLIC_FAILURES = 10;
const MAX_PUBLIC_WARNINGS = 10;
const SAFE_PUBLIC_FAILURE_STAGES = new Set([
  "item_start",
  "customization_fetch",
  "normalization",
  "enrichment",
  "notes_build",
  "notes_update",
  "persistence",
  "tag_update",
]);
const SAFE_ORDER_NUMBER = /^\d{3}-\d{7}-\d{7}$/;
const SAFE_PUBLIC_WARNING_STAGES = new Set(["notes_update", "tag_update"]);
const NOTE_SIZE_WARNING = "ShipStation Notes to Buyer is too long to update.";
const SYNCHRONIZATION_WARNING = "ShipStation synchronization could not be completed.";

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

function isImportLifecycleFailure(error, signal) {
  return isAbort(error, signal) || error instanceof AmazonImportError;
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

function noteFieldsWithFonts(normalized) {
  const fields = normalized?.source?.personalizationResponses ?? [];
  const selections = normalized?.source?.customerFontSelections ?? [];
  const lineCount = normalized?.text ? String(normalized.text).split("\n").length : 0;
  const textFields = fields
    .filter((response) => !/\s+font$/i.test(String(response?.name ?? "")))
    .slice(0, lineCount);
  const existingNames = new Set(fields.map((response) => String(response?.name ?? "").toLowerCase()));
  const fontFieldsByTextField = new Map();
  for (const selection of selections) {
    const label = textFields[selection?.lineIndex]?.name;
    const name = label ? `${label} Font` : "";
    if (name && selection?.name && !existingNames.has(name.toLowerCase())) {
      fontFieldsByTextField.set(textFields[selection.lineIndex], { name, value: selection.name });
    }
  }
  return fields.flatMap((response) => (
    fontFieldsByTextField.has(response)
      ? [response, fontFieldsByTextField.get(response)]
      : [response]
  ));
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

function publicShipmentFailure({ orderNumber, stage, error }) {
  const {
    validationReasonCode: reasonCode,
    validationSummary: summary,
  } = safeAmazonImportError(error);
  if (
    typeof orderNumber !== "string"
    || !SAFE_ORDER_NUMBER.test(orderNumber)
    || !SAFE_PUBLIC_FAILURE_STAGES.has(stage)
    || !reasonCode
    || !summary
  ) return null;
  return {
    orderNumber,
    stage,
    reasonCode,
    summary,
  };
}

function publicShipmentWarning({ orderNumber, stage, error }) {
  if (
    typeof orderNumber !== "string"
    || !SAFE_ORDER_NUMBER.test(orderNumber)
    || !SAFE_PUBLIC_WARNING_STAGES.has(stage)
  ) return null;
  return {
    orderNumber,
    stage,
    summary: stage === "notes_update" && error instanceof RangeError
      ? NOTE_SIZE_WARNING
      : SYNCHRONIZATION_WARNING,
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
        let warnings = 0;
        const warningDetails = [];
        let failed = 0;
        const failures = [];

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
                const persistenceItem = {
                  ...enriched,
                  amazonCustomizationJson: url ? customization : null,
                };
                normalizedItems.push(persistenceItem);
                itemRecords.push({
                  item: persistenceItem,
                  context: itemContext,
                  sourceItem: item,
                  normalized,
                  customizationUrl: url,
                });
              }

              currentFailureContext = {};
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

              try {
                const noteBlocks = [];
                for (const record of itemRecords) {
                  if (!record.customizationUrl) continue;
                  currentStage = "notes_build";
                  currentFailureContext = record.context;
                  noteBlocks.push({
                    itemId: record.sourceItem.external_order_item_id,
                    block: buildAmazonNoteBlock({
                      productTitle: record.sourceItem.name,
                      orderItemId: record.sourceItem.external_order_item_id,
                      fields: noteFieldsWithFonts(record.normalized),
                    }),
                  });
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
                    carrierId: shipment.carrier_id,
                    serviceCode: shipment.service_code,
                    requestedShipmentService: shipment.requested_shipment_service,
                    shippingRuleId: shipment.shipping_rule_id,
                    packages: shipment.packages,
                    items: shipment.items,
                    signal,
                  }));
                }

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
                if (isImportLifecycleFailure(error, signal)) throw error;
                const warningStage = currentStage === "tag_update" ? "tag_update" : "notes_update";
                emitDiagnostic(diagnostics, "error", "shipment.warning", {
                  ...shipmentContext,
                  ...currentFailureContext,
                  stage: currentStage,
                  error,
                });
                warnings += 1;
                const publicWarning = publicShipmentWarning({
                  orderNumber: shipmentContext.orderNumber,
                  stage: warningStage,
                  error,
                });
                if (publicWarning && warningDetails.length < MAX_PUBLIC_WARNINGS) {
                  warningDetails.push(publicWarning);
                }
              }
            } catch (error) {
              if (isGlobalFailure(error, signal)) throw error;
              emitDiagnostic(diagnostics, "error", "shipment.failed", {
                ...shipmentContext,
                ...currentFailureContext,
                stage: currentStage,
                error,
              });
              const publicFailure = publicShipmentFailure({
                orderNumber: shipmentContext.orderNumber,
                stage: currentStage,
                error,
              });
              if (publicFailure && failures.length < MAX_PUBLIC_FAILURES) failures.push(publicFailure);
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
          warnings,
          warningDetails,
          failed,
          failures,
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
