import { randomUUID as uuid } from "node:crypto";
import { buildAmazonNoteBlock } from "./amazon-customization-normalizer.js";
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

export function createAmazonImportService({
  store,
  createShipStationClient,
  fetchCustomizationJson,
  normalizeItem,
  appendNoteBlocks,
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
      if (runState !== "prepared" || releaseState !== "held") throw inactiveError();
      hasRun = true;
      runState = "running";
      startHeartbeat();
      let primaryError = null;
      try {
        await awaitActive(() => onProgress({
          type: "progress",
          stage: "fetching_shipments",
          processed: 0,
          total: null,
        }));

        const shipments = [];
        const shipmentIterator = client.iteratePendingShipments({
          storeId: amazonStoreId,
          signal,
        })[Symbol.asyncIterator]();
        while (true) {
          const next = await awaitActive(() => shipmentIterator.next());
          if (next.done) break;
          shipments.push(next.value);
        }
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
          await ensureActive();
          if (isProcessed(shipment)) {
            alreadyProcessedShipments += 1;
          } else {
            try {
              const normalizedItems = [];
              const noteBlocks = [];
              for (const item of shipment.items) {
                await ensureActive();
                const url = customizationUrl(item);
                let customization = {};
                if (url) {
                  customization = await awaitActive(
                    () => fetchCustomizationJson({ url, signal }),
                  );
                }
                const normalized = normalizeItem({ shipment, item, customization });
                normalizedItems.push(normalized);
                if (url) {
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

              const existingNotes = shipment.notes_to_buyer ?? "";
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

              const persistence = await awaitActive(
                () => store.importAmazonOrderItemsTransactional({
                  workspaceId,
                  userId,
                  items: normalizedItems,
                }),
              );
              importedItems += persistence.importedOrderItemIds.length;
              existingItems += persistence.existingOrderItemIds.length;
              customizationNeeded += normalizedItems.filter(
                (item) => item?.source?.customizationNeeded,
              ).length;

              await awaitActive(() => client.addShipmentTag({
                shipmentId: shipment.shipment_id,
                tagName: PROCESSED_TAG,
                signal,
              }));
              processedShipments += 1;
            } catch (error) {
              if (isGlobalFailure(error, signal)) throw error;
              failed += 1;
            }
          }

          await awaitActive(() => onProgress({
            type: "progress",
            stage: "processing_shipments",
            processed: index + 1,
            total: shipments.length,
          }));
        }

        await ensureActive();
        const result = {
          type: "complete",
          processedShipments,
          importedItems,
          existingItems,
          alreadyProcessedShipments,
          customizationNeeded,
          failed,
        };
        await awaitActive(() => onProgress(result));
        return result;
      } catch (error) {
        primaryError = error;
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
            throw releaseError;
          }
        }
      }
    };

    return {
      run,
      release,
      lockToken,
      stageForError(error) {
        return hasPrimaryReleaseError && error === primaryReleaseError ? "release" : null;
      },
    };
  }

  return { prepare };
}
