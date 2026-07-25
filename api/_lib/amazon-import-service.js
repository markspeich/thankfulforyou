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
}) {
  async function prepare({
    workspaceId,
    userId,
    signal,
    onProgress = () => {},
  }) {
    const started = currentDate(clock);
    const lockToken = randomUUID();
    const acquired = await store.acquireAmazonImportLock({
      workspaceId,
      lockToken,
      now: started,
    });
    if (!acquired) {
      throw new AmazonImportError(
        "import_in_progress",
        "An Amazon import is already in progress.",
        409,
      );
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await store.releaseAmazonImportLock({ workspaceId, lockToken });
    };

    let client;
    let amazonStoreId;
    try {
      const config = readShipStationConfig();
      amazonStoreId = config.amazonStoreId;
      client = createShipStationClient({ apiKey: config.apiKey });
    } catch (error) {
      await release();
      throw error;
    }

    let lastRenewedAt = started.getTime();
    const ensureActive = async () => {
      if (signal?.aborted) throw abortError();
      const now = currentDate(clock);
      if (now.getTime() - lastRenewedAt < HEARTBEAT_INTERVAL_MS) return;
      const renewed = await store.renewAmazonImportLock({
        workspaceId,
        lockToken,
        now,
      });
      if (!renewed) {
        throw new AmazonImportError(
          "import_lock_lost",
          "The Amazon import lease was lost. Please retry.",
          409,
        );
      }
      lastRenewedAt = now.getTime();
    };

    const run = async () => {
      try {
        await ensureActive();
        await onProgress({
          type: "progress",
          stage: "fetching_shipments",
          processed: 0,
          total: null,
        });
        await ensureActive();

        const shipments = [];
        for await (const shipment of client.iteratePendingShipments({
          storeId: amazonStoreId,
          signal,
        })) {
          shipments.push(shipment);
          await ensureActive();
        }
        await ensureActive();
        await onProgress({
          type: "progress",
          stage: "processing_shipments",
          processed: 0,
          total: shipments.length,
        });

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
                  customization = await fetchCustomizationJson({ url, signal });
                  await ensureActive();
                }
                const normalized = normalizeItem({ shipment, item, customization });
                normalizedItems.push(normalized);
                if (url) {
                  noteBlocks.push(buildAmazonNoteBlock({
                    productTitle: item.name,
                    orderItemId: item.external_order_item_id,
                    fields: normalized?.source?.personalizationResponses ?? [],
                  }));
                }
              }

              const existingNotes = shipment.notes_to_buyer ?? "";
              const noteResult = appendNoteBlocks({
                existingNotes,
                blocks: noteBlocks,
              });
              if (noteResult.notes !== existingNotes) {
                await ensureActive();
                await client.updateNotesToBuyer({
                  shipmentId: shipment.shipment_id,
                  notesToBuyer: noteResult.notes,
                  signal,
                });
                await ensureActive();
              }

              await ensureActive();
              const persistence = await store.importAmazonOrderItemsTransactional({
                workspaceId,
                userId,
                items: normalizedItems,
              });
              await ensureActive();
              importedItems += persistence.importedOrderItemIds.length;
              existingItems += persistence.existingOrderItemIds.length;
              customizationNeeded += normalizedItems.filter(
                (item) => item?.source?.customizationNeeded,
              ).length;

              await client.addShipmentTag({
                shipmentId: shipment.shipment_id,
                tagName: PROCESSED_TAG,
                signal,
              });
              await ensureActive();
              processedShipments += 1;
            } catch (error) {
              if (isGlobalFailure(error, signal)) throw error;
              failed += 1;
            }
          }

          await onProgress({
            type: "progress",
            stage: "processing_shipments",
            processed: index + 1,
            total: shipments.length,
          });
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
        await onProgress(result);
        return result;
      } finally {
        await release();
      }
    };

    return { run, release, lockToken };
  }

  return { prepare };
}
