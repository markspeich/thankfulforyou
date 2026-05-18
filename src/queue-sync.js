export const REMOTE_QUEUE_WORKSPACE_KEY = "primary";

export function buildRemoteQueuePayload(snapshot) {
  return {
    workspaceKey: REMOTE_QUEUE_WORKSPACE_KEY,
    snapshot,
  };
}

export function chooseInitialQueueSnapshot({
  localSnapshot,
  remoteSnapshot,
}) {
  if (!isQueueSnapshotEmpty(localSnapshot)) {
    return {
      source: "local",
      snapshot: localSnapshot,
    };
  }

  if (!isQueueSnapshotEmpty(remoteSnapshot)) {
    return {
      source: "remote",
      snapshot: remoteSnapshot,
    };
  }

  return {
    source: null,
    snapshot: null,
  };
}

export function isQueueSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orders) || snapshot.orders.length === 0;
}
