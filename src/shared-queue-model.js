function isSharedQueueSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orders) || snapshot.orders.length === 0;
}

export function createSharedQueueSnapshot({ queue, activeOrderId, orders } = {}) {
  return {
    queue: queue ?? null,
    activeOrderId: activeOrderId ?? null,
    orders: Array.isArray(orders) ? orders : [],
  };
}

export function getNextRevision(order) {
  const currentRevision = Number(order?.revision);
  return (Number.isFinite(currentRevision) ? currentRevision : 0) + 1;
}

export function chooseSharedQueueStartupState({ remoteSnapshot, localCache }) {
  if (!isSharedQueueSnapshotEmpty(remoteSnapshot)) {
    return {
      source: "remote",
      snapshot: remoteSnapshot,
    };
  }

  if (!isSharedQueueSnapshotEmpty(localCache)) {
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
