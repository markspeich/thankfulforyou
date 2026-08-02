const MAX_STRING_LENGTH = 128;
const MAX_LABEL_LENGTH = 80;
const MAX_ARRAY_LENGTH = 40;
const MAX_COUNT = 1_000_000;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EVENT = /^[a-z][a-z0-9_.-]{0,79}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_.-]{0,79}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_STAGES = new Set([
  "item_start",
  "customization_fetch",
  "normalization",
  "enrichment",
  "notes_update",
  "persistence",
  "tag_update",
]);
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
  const errorName = safeString(error?.name, 80);
  const errorCode = safeString(error?.code, 80);
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 100 && error.statusCode <= 599
    ? error.statusCode
    : null;
  const requestId = safeString(error?.requestId, 128);
  return {
    errorName: errorName && SAFE_ERROR_NAME.test(errorName) ? errorName : null,
    errorCode: errorCode && SAFE_ERROR_CODE.test(errorCode) ? errorCode : null,
    statusCode,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    requestId: requestId && SAFE_REQUEST_ID.test(requestId) ? requestId : null,
  };
}

function safeContext(context) {
  const output = {};
  if (!context || typeof context !== "object" || Array.isArray(context)) return output;
  for (const key of ["shipmentId", "orderNumber", "orderItemId", "presetId"]) {
    const value = safeIdentifier(context[key]);
    if (value) output[key] = value;
  }
  const fontIds = safeStringArray(context.fontIds);
  if (fontIds) output.fontIds = fontIds;
  const effectiveFontIds = safeStringArray(context.effectiveFontIds);
  if (effectiveFontIds) output.effectiveFontIds = effectiveFontIds;
  for (const key of [
    "shipmentCount",
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
    if (count != null) output[key] = count;
  }
  for (const key of ["customizationUrlPresent", "notesUpdated", "processedTagUpdated"]) {
    if (typeof context[key] === "boolean") output[key] = context[key];
  }
  if (typeof context.customizationNeeded === "boolean") {
    output.customizationNeeded = context.customizationNeeded;
  } else {
    const customizationNeeded = safeCount(context.customizationNeeded);
    if (customizationNeeded != null) output.customizationNeeded = customizationNeeded;
  }
  const persistenceOutcome = safeString(context.persistenceOutcome, 40);
  if (persistenceOutcome && SAFE_PERSISTENCE_OUTCOMES.has(persistenceOutcome)) {
    output.persistenceOutcome = persistenceOutcome;
  }
  const stage = safeString(context.stage, 40);
  if (stage && SAFE_STAGES.has(stage)) output.stage = stage;
  const summary = safeSummary(context.summary);
  if (summary) output.summary = summary;
  if (Object.hasOwn(context, "error")) Object.assign(output, safeAmazonImportError(context.error));
  if (["errorName", "errorCode", "statusCode", "retryable", "requestId"].some((key) => Object.hasOwn(context, key))) {
    Object.assign(output, safeAmazonImportError({
      name: context.errorName,
      code: context.errorCode,
      statusCode: context.statusCode,
      retryable: context.retryable,
      requestId: context.requestId,
    }));
  }
  return output;
}

function emit(logger, level, event, envelope) {
  try {
    const write = typeof logger?.[level] === "function" ? logger[level].bind(logger) : console[level].bind(console);
    const result = write(`amazon_import.${event}`, envelope);
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
    emit(logger, level, safeEvent && SAFE_EVENT.test(safeEvent) ? safeEvent : "unknown", {
      ...correlation,
      ...safeContext(context),
    });
  }

  return {
    info(event, context) { log("info", event, context); },
    error(event, context) { log("error", event, context); },
  };
}
