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

export function getSelectedGroupedOrder(orders, selectedOrderId) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return null;
  }

  return orders.find((order) => order.id === selectedOrderId) || orders[0];
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
