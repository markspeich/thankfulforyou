function toOrderIdArray(orderIds) {
  if (Array.isArray(orderIds)) {
    return orderIds;
  }

  if (orderIds instanceof Set) {
    return [...orderIds];
  }

  return [];
}

function cloneBuild(build) {
  return typeof structuredClone === "function"
    ? structuredClone(build)
    : JSON.parse(JSON.stringify(build));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidSavedBuild(build) {
  return Boolean(
    build
    && typeof build === "object"
    && build.layout
    && typeof build.layout === "object"
    && build.analysis
    && typeof build.analysis === "object",
  );
}

export function getCheckedOrderIdsForBulkAction(checkedOrderIds) {
  return toOrderIdArray(checkedOrderIds).filter(isNonEmptyString);
}

export function getOrderItemListingText(item) {
  const candidates = [
    item?.source?.listingTitle,
    item?.listingTitle,
    item?.title,
    item?.listing?.title,
    item?.design?.listingTitle,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return match ? match.trim() : "Untitled listing";
}

export function getVisibleOrderSelectionState(visibleOrders, checkedOrderIds) {
  const visibleOrderIds = new Set(
    (Array.isArray(visibleOrders) ? visibleOrders : [])
      .map((order) => order?.id)
      .filter(isNonEmptyString),
  );
  const checkedVisibleOrderCount = getCheckedOrderIdsForBulkAction(checkedOrderIds)
    .filter((orderId) => visibleOrderIds.has(orderId))
    .length;
  const visibleOrderCount = visibleOrderIds.size;

  return {
    visibleOrderCount,
    checkedVisibleOrderCount,
    allVisibleChecked: visibleOrderCount > 0 && checkedVisibleOrderCount === visibleOrderCount,
    someVisibleChecked: checkedVisibleOrderCount > 0 && checkedVisibleOrderCount < visibleOrderCount,
  };
}

export function getSelectedGroupedOrder(orders, selectedOrderId) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return null;
  }

  return orders.find((order) => order.id === selectedOrderId) || orders[0];
}

function getOrderSearchText(order) {
  const parts = [
    order?.id,
    order?.orderNumber,
    order?.buyerName,
  ];
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    parts.push(
      item?.id,
      item?.orderNumber,
      item?.buyerName,
      item?.listingId,
      item?.transactionId,
      item?.importedColor,
      item?.shipByDate,
      item?.source?.listingTitle,
      item?.source?.title,
      item?.design?.text,
    );
    for (const line of Array.isArray(item?.design?.lines) ? item.design.lines : []) {
      parts.push(line?.text);
    }
  }
  return parts
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();
}

function getOrderLifecycleStatus(order) {
  if (order?.status === "complete") {
    return "complete";
  }
  if (order?.status === "skipped") {
    return "skipped";
  }
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length > 0 && items.every((item) => item?.status === "complete")) {
    return "complete";
  }
  if (items.length > 0 && items.every((item) => item?.status === "skipped")) {
    return "skipped";
  }
  return "open";
}

const ORDER_STATUS_DESCRIPTOR_BY_STATUS = {
  open: { status: "open", label: "Open", className: "is-open" },
  complete: { status: "complete", label: "Complete", className: "is-complete" },
  skipped: { status: "skipped", label: "Skipped", className: "is-skipped" },
};

export function getOrderLifecycleStatusDescriptor(order) {
  const status = getOrderLifecycleStatus(order);
  return ORDER_STATUS_DESCRIPTOR_BY_STATUS[status] || ORDER_STATUS_DESCRIPTOR_BY_STATUS.open;
}

export function getOrderItemStatusDescriptor(item) {
  if (item?.status === "complete") {
    return {
      ...ORDER_STATUS_DESCRIPTOR_BY_STATUS.complete,
      detail: "Can be added back to the active batch",
    };
  }
  if (item?.status === "skipped") {
    return {
      ...ORDER_STATUS_DESCRIPTOR_BY_STATUS.skipped,
      detail: "Excluded from production batching",
    };
  }
  return {
    ...ORDER_STATUS_DESCRIPTOR_BY_STATUS.open,
    detail: item?.isInActiveBatch ? "Already in active batch" : "Not in active batch",
  };
}

export function filterGroupedOrders(orders, {
  searchTerm = "",
  statusFilter = "open",
  batchFilter = "all",
} = {}) {
  const normalizedSearchTerm = typeof searchTerm === "string" ? searchTerm.trim().toLowerCase() : "";
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    if (normalizedSearchTerm && !getOrderSearchText(order).includes(normalizedSearchTerm)) {
      return false;
    }

    const lifecycleStatus = getOrderLifecycleStatus(order);
    if (statusFilter === "open" && lifecycleStatus !== "open") {
      return false;
    }
    if (statusFilter === "complete" && lifecycleStatus !== "complete") {
      return false;
    }
    if (statusFilter === "skipped" && lifecycleStatus !== "skipped") {
      return false;
    }

    if (batchFilter === "inBatch" && !order?.isInActiveBatch) {
      return false;
    }
    if (batchFilter === "notInBatch" && order?.isInActiveBatch) {
      return false;
    }

    return true;
  });
}

export function normalizeOrdersWorkspaceState({
  orders: directOrders,
  payload,
  selectedOrderId,
  checkedOrderIds,
} = {}) {
  const rawOrders = Array.isArray(directOrders) ? directOrders : payload?.orders;
  const orders = Array.isArray(rawOrders)
    ? rawOrders.filter((order) => order && isNonEmptyString(order.id))
    : [];
  const currentOrderIds = new Set(orders.map((order) => order.id));
  const nextSelectedOrderId = currentOrderIds.has(selectedOrderId)
    ? selectedOrderId
    : orders[0]?.id || null;

  return {
    orders,
    selectedOrderId: nextSelectedOrderId,
    checkedOrderIds: new Set(
      getCheckedOrderIdsForBulkAction(checkedOrderIds)
        .filter((orderId) => currentOrderIds.has(orderId)),
    ),
  };
}

export function mergeOrdersPageState({
  currentOrders,
  incomingOrders,
  selectedOrderId,
  checkedOrderIds,
  nextCursor = null,
  hasMore = false,
  reset = false,
} = {}) {
  const incoming = (Array.isArray(incomingOrders) ? incomingOrders : [])
    .filter((order) => order && isNonEmptyString(order.id));
  const current = (Array.isArray(currentOrders) ? currentOrders : [])
    .filter((order) => order && isNonEmptyString(order.id));
  const currentOrderIds = new Set(current.map((order) => order.id));
  const incomingOrderIds = new Set();
  const uniqueIncoming = incoming.filter((order) => {
    if (currentOrderIds.has(order.id) || incomingOrderIds.has(order.id)) {
      return false;
    }
    incomingOrderIds.add(order.id);
    return true;
  });
  const orders = reset
    ? incoming
    : [
      ...current,
      ...uniqueIncoming,
    ];

  const normalized = normalizeOrdersWorkspaceState({
    orders,
    selectedOrderId,
    checkedOrderIds,
  });
  return {
    ...normalized,
    nextCursor: isNonEmptyString(nextCursor) ? nextCursor : null,
    hasMore: Boolean(hasMore),
  };
}

export function getOrdersRetryLoadOptions({ orders, failedLoadingMode } = {}) {
  if (failedLoadingMode === "append" && Array.isArray(orders) && orders.length > 0) {
    return { append: true };
  }
  return { reset: true };
}

export function getCopyableSavedBuild(item) {
  const design = item?.design && typeof item.design === "object"
    ? item.design
    : null;
  const candidates = [
    design?.cachedBuild || item?.cachedBuild,
    design?.previousCompletedBuild || item?.previousCompletedBuild,
  ];
  const rawCompletedSettingsSignature = design?.completedSettingsSignature
    || item?.completedSettingsSignature;
  const completedSettingsSignature = isNonEmptyString(rawCompletedSettingsSignature)
    ? rawCompletedSettingsSignature
    : null;

  if (completedSettingsSignature) {
    const matchingBuild = candidates.find((build) => (
      isValidSavedBuild(build) && build.signature === completedSettingsSignature
    ));
    return matchingBuild ? cloneBuild(matchingBuild) : null;
  }

  const validBuild = candidates.find(isValidSavedBuild);
  return validBuild ? cloneBuild(validBuild) : null;
}
export function getEtsyConnectionActionDescriptor(connection) {
  const importing = Boolean(connection?.importing || connection?.isImporting);
  if (connection?.status === "connected" && importing) return { label: "Importing…", disabled: true };
  if (connection?.status === "connected") return { label: "Import from Etsy", disabled: importing };
  if (connection?.status === "reconnect_required" || connection?.reconnectRequired) {
    return { label: "Reconnect Etsy Shop", disabled: importing };
  }
  return { label: "Connect Etsy Shop", disabled: importing };
}

function normalizeEtsyCount(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
}

export function getEtsyImportProgressDescriptor(event) {
  if (event?.stage === "fetching_receipts") {
    return { label: "Fetching Etsy receipts…", determinate: false, value: null, max: null };
  }
  if (event?.stage === "importing_items") {
    const max = normalizeEtsyCount(event.total);
    const value = Math.min(normalizeEtsyCount(event.processed), max);
    if (max === 0) {
      return { label: "Importing 0 of 0 order items\u2026", determinate: false, value: null, max: null };
    }
    return { label: `Importing ${value} of ${max} order items…`, determinate: true, value, max };
  }
  return null;
}

export function getEtsyImportSummary(summary = {}) {
  const imported = normalizeEtsyCount(summary.imported);
  const existing = normalizeEtsyCount(summary.existing);
  const customization = normalizeEtsyCount(summary.customizationNeeded);
  const failed = normalizeEtsyCount(summary.failed);
  const noun = (number, singular, plural = `${singular}s`) => `${number} ${number === 1 ? singular : plural}`;
  const importedLabel = imported === 1 ? "1 order imported" : `${imported} orders imported`;
  return `${importedLabel}, ${noun(existing, "existing order")}, ${noun(customization, "item needing customization")}, ${noun(failed, "failure", "failures")}.`;
}

function normalizeAmazonCount(value) {
  return Number.isInteger(value) && value >= 0 && Number.isFinite(value) ? value : 0;
}

const AMAZON_IMPORT_FAILURE_FALLBACK = "One or more Amazon orders could not be imported. Please retry or check the production logs.";
const SAFE_AMAZON_ORDER_NUMBER = /^\d{3}-\d{7}-\d{7}$/;
const AMAZON_IMPORT_FAILURE_STAGE_DESCRIPTIONS = Object.freeze({
  item_start: "while starting an Amazon order item",
  customization_fetch: "while fetching Amazon customization details",
  normalization: "while preparing Amazon order details",
  enrichment: "while preparing the badge reel design",
  notes_build: "while preparing ShipStation notes",
  notes_update: "while updating ShipStation notes",
  persistence: "while saving the Amazon order",
  tag_update: "while updating the ShipStation shipment tag",
});
const SAFE_AMAZON_IMPORT_FAILURE_VALIDATIONS = Object.freeze([
  Object.freeze({ reasonCode: "required_field", summary: "Package weight is required." }),
  Object.freeze({ reasonCode: "invalid_field_value", summary: "The selected shipping service is invalid." }),
]);
const AMAZON_IMPORT_WARNING_FALLBACK = "One or more Amazon orders were imported, but ShipStation synchronization could not be completed.";
const SAFE_AMAZON_IMPORT_WARNING_SUMMARIES = Object.freeze({
  noteSize: "ShipStation Notes to Buyer is too long to update.",
  synchronization: "ShipStation synchronization could not be completed.",
});

export function getAmazonImportFailureDescription(summary = {}) {
  let failed;
  try {
    failed = normalizeAmazonCount(summary?.failed);
  } catch {
    return null;
  }
  if (failed === 0) return null;

  try {
    const failure = Array.isArray(summary?.failures) ? summary.failures[0] : null;
    if (!failure || typeof failure !== "object" || Array.isArray(failure)) {
      return AMAZON_IMPORT_FAILURE_FALLBACK;
    }
    const orderNumber = failure.orderNumber;
    const stageDescription = Object.hasOwn(AMAZON_IMPORT_FAILURE_STAGE_DESCRIPTIONS, failure.stage)
      ? AMAZON_IMPORT_FAILURE_STAGE_DESCRIPTIONS[failure.stage]
      : null;
    const validation = SAFE_AMAZON_IMPORT_FAILURE_VALIDATIONS.find((candidate) => (
      failure.reasonCode === candidate.reasonCode && failure.summary === candidate.summary
    ));
    if (
      typeof orderNumber !== "string"
      || !SAFE_AMAZON_ORDER_NUMBER.test(orderNumber)
      || !stageDescription
      || !validation
    ) return AMAZON_IMPORT_FAILURE_FALLBACK;

    const additionalFailures = failed - 1;
    const additionalDescription = additionalFailures === 0
      ? ""
      : additionalFailures === 1
        ? " One additional Amazon order failed."
        : ` ${additionalFailures} additional Amazon orders failed.`;
    return `Amazon order ${orderNumber} failed ${stageDescription}: ${validation.summary}${additionalDescription}`;
  } catch {
    return AMAZON_IMPORT_FAILURE_FALLBACK;
  }
}

export function getAmazonImportWarningDescription(summary = {}) {
  let warnings;
  try {
    warnings = normalizeAmazonCount(summary?.warnings);
  } catch {
    return null;
  }
  if (warnings === 0) return null;

  try {
    const warningDetails = Array.isArray(summary?.warningDetails) ? summary.warningDetails : [];
    const descriptions = warningDetails.flatMap((warning) => {
      if (
        !warning
        || typeof warning !== "object"
        || Array.isArray(warning)
        || typeof warning.orderNumber !== "string"
        || !SAFE_AMAZON_ORDER_NUMBER.test(warning.orderNumber)
      ) return [];
      if (
        warning.stage === "notes_update"
        && warning.summary === SAFE_AMAZON_IMPORT_WARNING_SUMMARIES.noteSize
      ) {
        return [`Amazon order ${warning.orderNumber} was imported, but ShipStation Notes to Buyer could not be updated because the note is too long.`];
      }
      if (warning.summary !== SAFE_AMAZON_IMPORT_WARNING_SUMMARIES.synchronization) return [];
      if (warning.stage === "notes_update") {
        return [`Amazon order ${warning.orderNumber} was imported, but ShipStation Notes to Buyer could not be updated.`];
      }
      if (warning.stage === "tag_update") {
        return [`Amazon order ${warning.orderNumber} was imported, but the ShipStation Customization Needed tag could not be removed.`];
      }
      return [];
    });
    if (descriptions.length < warnings) descriptions.push(AMAZON_IMPORT_WARNING_FALLBACK);
    return descriptions.join(" ");
  } catch {
    return AMAZON_IMPORT_WARNING_FALLBACK;
  }
}

export function getAmazonImportSummary(summary = {}) {
  const processedShipments = normalizeAmazonCount(summary.processedShipments);
  const importedItems = normalizeAmazonCount(summary.importedItems);
  const existingItems = normalizeAmazonCount(summary.existingItems);
  const alreadyProcessedShipments = normalizeAmazonCount(summary.alreadyProcessedShipments);
  const customizationNeeded = normalizeAmazonCount(summary.customizationNeeded);
  const warnings = normalizeAmazonCount(summary.warnings);
  const failed = normalizeAmazonCount(summary.failed);
  const noun = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
  return [
    noun(processedShipments, "shipment processed", "shipments processed"),
    noun(importedItems, "item imported", "items imported"),
    noun(existingItems, "existing item", "existing items"),
    noun(alreadyProcessedShipments, "shipment not awaiting customization", "shipments not awaiting customization"),
    noun(customizationNeeded, "item needing customization", "items needing customization"),
    noun(warnings, "warning", "warnings"),
    noun(failed, "failure", "failures"),
  ].join(", ") + ".";
}

export function getMarketplaceImportPresentation({ amazon = {}, etsy = {} } = {}) {
  const outcomes = [
    { label: "Imported", amazon: normalizeAmazonCount(amazon.importedItems), etsy: normalizeEtsyCount(etsy.imported) },
    { label: "Existing", amazon: normalizeAmazonCount(amazon.existingItems), etsy: normalizeEtsyCount(etsy.existing) },
    { label: "Failed", amazon: normalizeAmazonCount(amazon.failed), etsy: normalizeEtsyCount(etsy.failed) },
  ];
  const rows = outcomes.map((outcome) => ({
    ...outcome,
    total: outcome.amazon + outcome.etsy,
  }));
  return {
    title: rows.at(-1).total > 0 ? "Import Completed with Issues" : "Import Complete",
    description: "Amazon and Etsy orders have been checked.",
    rows,
  };
}
export function getOrderItemCustomizationWarning(item) {
  const source = item?.source?.source && typeof item.source.source === "object" ? item.source.source : item?.source;
  return source?.customizationNeeded
    ? { label: "Customization needed", detail: "Review this item before production." }
    : null;
}
