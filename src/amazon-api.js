const IMPORT_ERROR = "Unable to import Amazon orders.";
const MAX_NDJSON_RECORD_LENGTH = 256 * 1024;
const COMPLETE_KEYS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "importedItems",
  "processedShipments",
  "type",
];
const PROGRESS_KEYS = ["processed", "stage", "total", "type"];
const ERROR_KEYS = ["code", "message", "type"];

function publicImportError(code = "") {
  const error = new Error(IMPORT_ERROR);
  if (/^[a-z0-9_:-]{1,64}$/i.test(code)) error.code = code;
  return error;
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === keys.join("\0");
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0 && Number.isFinite(value);
}

function parseEvent(record) {
  let event;
  try {
    event = JSON.parse(record);
  } catch {
    throw publicImportError();
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw publicImportError();
  }

  if (event.type === "progress" && hasExactKeys(event, PROGRESS_KEYS)) {
    if (event.stage === "fetching_shipments"
      && event.processed === 0
      && event.total === null) {
      return {
        type: "progress",
        stage: "fetching_shipments",
        processed: 0,
        total: null,
      };
    }
    if (event.stage === "processing_shipments"
      && isCount(event.processed)
      && isCount(event.total)
      && event.processed <= event.total) {
      return {
        type: "progress",
        stage: "processing_shipments",
        processed: event.processed,
        total: event.total,
      };
    }
    throw publicImportError();
  }

  if (event.type === "complete" && hasExactKeys(event, COMPLETE_KEYS)) {
    if (!COMPLETE_KEYS.slice(0, -1).every((key) => isCount(event[key]))) {
      throw publicImportError();
    }
    return {
      type: "complete",
      processedShipments: event.processedShipments,
      importedItems: event.importedItems,
      existingItems: event.existingItems,
      alreadyProcessedShipments: event.alreadyProcessedShipments,
      customizationNeeded: event.customizationNeeded,
      failed: event.failed,
    };
  }

  if (event.type === "error" && hasExactKeys(event, ERROR_KEYS)
    && typeof event.code === "string"
    && typeof event.message === "string") {
    throw publicImportError(event.code.trim());
  }

  throw publicImportError();
}

function appendBytes(left, right) {
  if (left.length === 0) return right;
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function toPublicError(error) {
  if (error?.name === "AbortError") return error;
  if (error instanceof Error && error.message === IMPORT_ERROR) return error;
  return publicImportError(error?.code);
}

export async function importAmazonOrders({
  accessToken = null,
  signal,
  onEvent = () => {},
} = {}) {
  let response;
  try {
    response = await fetch("/api/amazon-import", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal,
    });
  } catch (error) {
    throw toPublicError(error);
  }

  if (!response.ok || !response.body?.getReader) throw publicImportError();

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = new Uint8Array();
  let terminalSeen = false;
  let terminalEvent = null;
  let completed = false;

  const notify = async (bytes) => {
    if (bytes.length > MAX_NDJSON_RECORD_LENGTH) {
      throw publicImportError();
    }
    const content = bytes.at(-1) === 13 ? bytes.slice(0, -1) : bytes;
    let record;
    try {
      record = decoder.decode(content);
    } catch {
      throw publicImportError();
    }
    if (!record.trim()) return;
    if (terminalSeen) throw publicImportError();
    const event = parseEvent(record);
    if (event.type === "complete") {
      terminalSeen = true;
      terminalEvent = event;
      return;
    }
    await onEvent(event);
  };

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw publicImportError();
      pending = appendBytes(pending, value);

      let start = 0;
      for (let index = 0; index < pending.length; index += 1) {
        if (pending[index] !== 10) continue;
        await notify(pending.slice(start, index));
        start = index + 1;
      }
      pending = pending.slice(start);
      if (pending.length > MAX_NDJSON_RECORD_LENGTH) throw publicImportError();
    }

    if (pending.length) await notify(pending);
    if (!terminalSeen || !terminalEvent) throw publicImportError();
    await onEvent(terminalEvent);
    completed = true;
  } catch (error) {
    throw toPublicError(error);
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Keep the original stream failure.
      }
    }
    reader.releaseLock();
  }
}
