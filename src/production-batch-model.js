function isProductionBatchSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orderItems) || snapshot.orderItems.length === 0;
}

export function createProductionBatchSnapshot({ batch, activeOrderItemId, orderItems } = {}) {
  return {
    batch: batch ?? null,
    activeOrderItemId: activeOrderItemId ?? null,
    orderItems: Array.isArray(orderItems) ? orderItems : [],
  };
}

export function getNextRevision(order) {
  const currentRevision = Number(order?.revision);
  return (Number.isFinite(currentRevision) ? currentRevision : 0) + 1;
}

export function chooseProductionBatchStartupState({ remoteSnapshot, localCache }) {
  if (!isProductionBatchSnapshotEmpty(remoteSnapshot)) {
    return {
      source: "remote",
      snapshot: remoteSnapshot,
    };
  }

  if (!isProductionBatchSnapshotEmpty(localCache)) {
    return {
      source: "local-cache",
      snapshot: localCache,
    };
  }

  return {
    source: null,
    snapshot: null,
  };
}
