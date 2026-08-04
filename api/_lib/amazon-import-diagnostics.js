import { ShipStationError } from "./shipstation-client.js";

const MAX_STRING_LENGTH = 128;
const MAX_LABEL_LENGTH = 80;
const MAX_ARRAY_LENGTH = 40;
const MAX_COUNT = 1_000_000;
const MAX_VALIDATION_SUMMARY_LENGTH = 160;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EVENT = /^[a-z][a-z0-9_.-]{0,79}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "AbortError",
  "AmazonImportError",
  "AmazonCustomizationArchiveError",
  "AmazonImportStoreError",
  "ShipStationError",
]);
const SAFE_ERROR_CODES = new Set([
  "import_in_progress",
  "import_lock_lost",
  "import_not_active",
  "import_already_started",
  "configuration",
  "invalid_response",
  "aborted",
  "temporary",
  "rate_limited",
  "request_failed",
  "untrusted_customization_url",
  "invalid_customization_archive",
  "customization_archive_too_large",
  "customization_download_failed",
  "customization_download_aborted",
  "customization_download_timeout",
  "amazon_import_store_error",
  "ABORT_ERR",
]);
const SAFE_SHIPSTATION_ERROR_CODES = new Set([
  "configuration",
  "invalid_response",
  "aborted",
  "temporary",
  "rate_limited",
  "request_failed",
]);
const SAFE_SHIPSTATION_VALIDATIONS = [
  { reasonCode: "required_field", field: "package_weight", summary: "Package weight is required." },
  { reasonCode: "invalid_field_value", field: "shipping_service", summary: "The selected shipping service is invalid." },
];
const SAFE_STAGES = new Set([
  "preparation",
  "context_loading",
  "shipment_fetch",
  "progress_delivery",
  "release",
  "item_start",
  "customization_fetch",
  "normalization",
  "enrichment",
  "notes_build",
  "notes_update",
  "persistence",
  "tag_update",
]);
const SAFE_SKIP_REASONS = new Set(["processed_tag_present"]);
const SAFE_REJECTION_REASONS = new Set([
  "internal",
  "url",
  "asset",
  "markup",
  "metadata_label",
  "blank",
  "unsupported",
]);
const SAFE_PERSISTENCE_OUTCOMES = new Set([
  "created",
  "updated",
  "unchanged",
  "skipped",
  "failed",
  "persisted",
  "not_persisted",
  "imported",
  "existing",
]);
const SUMMARY_COUNT_KEYS = [
  "surfaceCount",
  "areaCount",
  "candidateNodeCount",
  "acceptedTextCount",
  "acceptedConfigurationCount",
];

function safeString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeIdentifier(value) {
  const normalized = safeString(value);
  return normalized && SAFE_IDENTIFIER.test(normalized) ? normalized : null;
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_COUNT) : null;
}

function safeLabel(value) {
  return safeString(value, MAX_LABEL_LENGTH);
}

function safeStringArray(value, itemSanitizer = safeIdentifier) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_ARRAY_LENGTH).map(itemSanitizer).filter(Boolean);
}

function safeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const summary = {};
  const format = safeString(value.format, 16);
  if (format === "v3" || format === "legacy" || format === "empty" || format === "unknown") summary.format = format;
  for (const key of SUMMARY_COUNT_KEYS) {
    const count = safeCount(value[key]);
    if (count != null) summary[key] = count;
  }
  const labels = safeStringArray(value.acceptedLabels, safeLabel);
  if (labels) summary.acceptedLabels = labels;
  if (value.rejectedCounts && typeof value.rejectedCounts === "object" && !Array.isArray(value.rejectedCounts)) {
    const rejectedCounts = {};
    for (const reason of SAFE_REJECTION_REASONS) {
      const count = safeCount(value.rejectedCounts[reason]);
      if (count != null) rejectedCounts[reason] = count;
    }
    summary.rejectedCounts = rejectedCounts;
  }
  return Object.keys(summary).length ? summary : undefined;
}

export function safeAmazonImportError(error) {
  const property = (key) => {
    try { return error?.[key]; } catch { return undefined; }
  };
  const errorName = typeof property("name") === "string" ? safeString(property("name"), 80) : null;
  const errorCode = typeof property("code") === "string" ? safeString(property("code"), 80) : null;
  const rawStatusCode = property("statusCode");
  const statusCode = Number.isInteger(rawStatusCode) && rawStatusCode >= 100 && rawStatusCode <= 599
    ? rawStatusCode
    : null;
  const rawRequestId = property("requestId");
  const requestId = typeof rawRequestId === "string" ? safeString(rawRequestId, 128) : null;
  let hasShipStationProvenance = false;
  try {
    hasShipStationProvenance = error instanceof ShipStationError
      && SAFE_SHIPSTATION_ERROR_CODES.has(errorCode);
  } catch {
    hasShipStationProvenance = false;
  }
  const safeError = {
    errorName: errorName && SAFE_ERROR_NAMES.has(errorName) ? errorName : null,
    errorCode: errorCode && SAFE_ERROR_CODES.has(errorCode) ? errorCode : null,
    statusCode,
    retryable: typeof property("retryable") === "boolean" ? property("retryable") : null,
    requestId: hasShipStationProvenance && requestId && SAFE_REQUEST_ID.test(requestId) ? requestId : null,
  };
  if (hasShipStationProvenance) {
    const validation = property("validation");
    let matchedValidation;
    try {
      matchedValidation = SAFE_SHIPSTATION_VALIDATIONS.find((candidate) => (
        validation
        && typeof validation === "object"
        && validation.reasonCode === candidate.reasonCode
        && validation.field === candidate.field
        && safeString(validation.summary, MAX_VALIDATION_SUMMARY_LENGTH) === candidate.summary
      ));
    } catch {}
    if (matchedValidation) {
      safeError.validationReasonCode = matchedValidation.reasonCode;
      safeError.validationField = matchedValidation.field;
      safeError.validationSummary = matchedValidation.summary;
    }
  }
  return safeError;
}

function rawShipStationResponse(error) {
  try {
    if (!(error instanceof ShipStationError)) return undefined;
  } catch {
    return undefined;
  }
  try {
    const rawResponseBody = error.rawResponseBody;
    return typeof rawResponseBody === "string" ? rawResponseBody : undefined;
  } catch {
    return undefined;
  }
}

function safeContext(context) {
  const envelope = {};
  const details = {};
  if (!context || typeof context !== "object" || Array.isArray(context)) return envelope;
  for (const key of ["shipmentId", "orderNumber", "orderItemId"]) {
    const value = safeIdentifier(context[key]);
    if (value) envelope[key] = value;
  }
  const presetId = safeIdentifier(context.presetId);
  if (presetId) details.presetId = presetId;
  const fontIds = safeStringArray(context.fontIds);
  if (fontIds) details.fontIds = fontIds;
  const effectiveFontIds = safeStringArray(context.effectiveFontIds);
  if (effectiveFontIds) details.effectiveFontIds = effectiveFontIds;
  for (const key of [
    "shipmentCount",
    "itemCount",
    "textLineCount",
    "personalizationResponseCount",
    "fontSelectionCount",
    "designLineCount",
    "selectionCount",
    "recognizedCount",
    "unknownCount",
    "processedShipments",
    "importedItems",
    "existingItems",
    "alreadyProcessedShipments",
    "failed",
  ]) {
    const count = safeCount(context[key]);
    if (count != null) details[key] = count;
  }
  for (const key of ["customizationUrlPresent", "notesUpdated", "processedTagUpdated", "processedTagPresent"]) {
    if (typeof context[key] === "boolean") details[key] = context[key];
  }
  if (typeof context.customizationNeeded === "boolean") {
    details.customizationNeeded = context.customizationNeeded;
  } else {
    const customizationNeeded = safeCount(context.customizationNeeded);
    if (customizationNeeded != null) details.customizationNeeded = customizationNeeded;
  }
  const persistenceOutcome = safeString(context.persistenceOutcome, 40);
  if (persistenceOutcome && SAFE_PERSISTENCE_OUTCOMES.has(persistenceOutcome)) {
    details.persistenceOutcome = persistenceOutcome;
  }
  const skipReason = safeString(context.skipReason, 40);
  if (skipReason && SAFE_SKIP_REASONS.has(skipReason)) details.skipReason = skipReason;
  const stage = safeString(context.stage, 40);
  if (stage && SAFE_STAGES.has(stage)) envelope.stage = stage;
  const summary = safeSummary(context.summary);
  if (summary) details.summary = summary;
  if (Object.hasOwn(context, "error")) {
    Object.assign(details, safeAmazonImportError(context.error));
    const rawResponse = rawShipStationResponse(context.error);
    if (rawResponse !== undefined) details.rawShipStationResponse = rawResponse;
  }
  if (["errorName", "errorCode", "statusCode", "retryable", "requestId"].some((key) => Object.hasOwn(context, key))) {
    Object.assign(details, safeAmazonImportError({
      name: context.errorName,
      code: context.errorCode,
      statusCode: context.statusCode,
      retryable: context.retryable,
      requestId: context.requestId,
    }));
  }
  if (Object.keys(details).length) envelope.details = details;
  return envelope;
}

function emit(logger, level, event, envelope) {
  try {
    const write = typeof logger?.[level] === "function" ? logger[level].bind(logger) : console[level].bind(console);
    const result = write("Amazon import diagnostic", { event, ...envelope });
    Promise.resolve(result).catch(() => {});
  } catch {}
}

export function createAmazonImportDiagnostics({ logger = console, runId, workspaceId } = {}) {
  const correlation = {};
  const safeRunId = safeIdentifier(runId);
  const safeWorkspaceId = safeIdentifier(workspaceId);
  if (safeRunId) correlation.runId = safeRunId;
  if (safeWorkspaceId) correlation.workspaceId = safeWorkspaceId;

  function log(level, event, context) {
    const safeEvent = safeString(event, 80);
    const fullEvent = safeEvent?.startsWith("amazon_import.") ? safeEvent : `amazon_import.${safeEvent ?? "unknown"}`;
    emit(logger, level, SAFE_EVENT.test(fullEvent) ? fullEvent : "amazon_import.unknown", {
      ...correlation,
      ...safeContext(context),
    });
  }

  return {
    info(event, context) { log("info", event, context); },
    error(event, context) { log("error", event, context); },
  };
}
