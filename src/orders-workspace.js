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
