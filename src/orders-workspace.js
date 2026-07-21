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

export function getOrderItemCustomizationWarning(item) {
  const source = item?.source?.source && typeof item.source.source === "object" ? item.source.source : item?.source;
  return source?.customizationNeeded
    ? { label: "Customization needed", detail: "Review this Etsy item before production." }
    : null;
}
