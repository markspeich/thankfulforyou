const IMPORT_ERROR = "Unable to import Amazon orders.";
const MAX_NDJSON_RECORD_LENGTH = 256 * 1024;
const COMPLETE_NUMERIC_FIELDS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "importedItems",
  "processedShipments",
  "warnings",
];
const COMPLETE_KEYS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "importedItems",
  "processedShipments",
  "type",
  "warnings",
];
const COMPLETE_WITH_FAILURES_KEYS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "failures",
  "importedItems",
  "processedShipments",
  "type",
  "warnings",
];
const COMPLETE_WITH_WARNING_DETAILS_KEYS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "importedItems",
  "processedShipments",
  "type",
  "warningDetails",
  "warnings",
];
const COMPLETE_WITH_FAILURES_AND_WARNING_DETAILS_KEYS = [
  "alreadyProcessedShipments",
  "customizationNeeded",
  "existingItems",
  "failed",
  "failures",
  "importedItems",
  "processedShipments",
  "type",
  "warningDetails",
  "warnings",
];
const PROGRESS_KEYS = ["processed", "stage", "total", "type"];
const ERROR_KEYS = ["code", "message", "type"];
const FAILURE_KEYS = ["orderNumber", "reasonCode", "stage", "summary"];
const WARNING_KEYS = ["orderNumber", "stage", "summary"];
const MAX_FAILURES = 10;
const MAX_WARNINGS = 10;
const SAFE_ORDER_NUMBER = /^\d{3}-\d{7}-\d{7}$/;
const SAFE_FAILURE_STAGES = new Set([
  "item_start",
  "customization_fetch",
  "normalization",
  "enrichment",
  "notes_build",
  "notes_update",
  "persistence",
  "tag_update",
]);
const SAFE_FAILURE_VALIDATIONS = [
  { reasonCode: "required_field", summary: "Package weight is required." },
  { reasonCode: "invalid_field_value", summary: "The selected shipping service is invalid." },
];
const SAFE_WARNING_STAGES = new Set(["notes_update", "tag_update"]);
const SAFE_WARNING_SUMMARIES = new Set([
  "ShipStation Notes to Buyer is too long to update.",
  "ShipStation synchronization could not be completed.",
]);

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

function parseFailures(value, failed) {
  if (!Array.isArray(value) || value.length > MAX_FAILURES || value.length > failed) return null;
  const failures = [];
  for (const failure of value) {
    if (!failure || typeof failure !== "object" || Array.isArray(failure) || !hasExactKeys(failure, FAILURE_KEYS)) {
      return null;
    }
    const validation = SAFE_FAILURE_VALIDATIONS.find((candidate) => (
      failure.reasonCode === candidate.reasonCode && failure.summary === candidate.summary
    ));
    if (
      typeof failure.orderNumber !== "string"
      || !SAFE_ORDER_NUMBER.test(failure.orderNumber)
      || !SAFE_FAILURE_STAGES.has(failure.stage)
      || !validation
    ) return null;
    failures.push({
      orderNumber: failure.orderNumber,
      stage: failure.stage,
      reasonCode: validation.reasonCode,
      summary: validation.summary,
    });
  }
  return failures;
}

function parseWarningDetails(value, warnings) {
  if (!Array.isArray(value) || value.length > MAX_WARNINGS || value.length > warnings) return null;
  const warningDetails = [];
  for (const warning of value) {
    if (
      !warning
      || typeof warning !== "object"
      || Array.isArray(warning)
      || !hasExactKeys(warning, WARNING_KEYS)
      || typeof warning.orderNumber !== "string"
      || !SAFE_ORDER_NUMBER.test(warning.orderNumber)
      || !SAFE_WARNING_STAGES.has(warning.stage)
      || !SAFE_WARNING_SUMMARIES.has(warning.summary)
    ) return null;
    warningDetails.push({
      orderNumber: warning.orderNumber,
      stage: warning.stage,
      summary: warning.summary,
    });
  }
  return warningDetails;
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

  const hasFailures = event.type === "complete" && (
    hasExactKeys(event, COMPLETE_WITH_FAILURES_KEYS)
    || hasExactKeys(event, COMPLETE_WITH_FAILURES_AND_WARNING_DETAILS_KEYS)
  );
  const hasWarningDetails = event.type === "complete" && (
    hasExactKeys(event, COMPLETE_WITH_WARNING_DETAILS_KEYS)
    || hasExactKeys(event, COMPLETE_WITH_FAILURES_AND_WARNING_DETAILS_KEYS)
  );
  if (event.type === "complete" && (
    hasExactKeys(event, COMPLETE_KEYS)
    || hasFailures
    || hasWarningDetails
  )) {
    if (!COMPLETE_NUMERIC_FIELDS.every((key) => isCount(event[key]))) {
      throw publicImportError();
    }
    const failures = hasFailures ? parseFailures(event.failures, event.failed) : undefined;
    if (hasFailures && !failures) throw publicImportError();
    const warningDetails = hasWarningDetails ? parseWarningDetails(event.warningDetails, event.warnings) : undefined;
    if (hasWarningDetails && !warningDetails) throw publicImportError();
    return {
      type: "complete",
      processedShipments: event.processedShipments,
      importedItems: event.importedItems,
      existingItems: event.existingItems,
      alreadyProcessedShipments: event.alreadyProcessedShipments,
      customizationNeeded: event.customizationNeeded,
      warnings: event.warnings,
      failed: event.failed,
      ...(hasFailures ? { failures } : {}),
      ...(hasWarningDetails ? { warningDetails } : {}),
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

  if (response.status === 401) {
    throw Object.assign(new Error("Authentication required."), { status: 401 });
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
