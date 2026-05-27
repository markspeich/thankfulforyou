import { chooseSharedQueueStartupState } from "./shared-queue-model.js";

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
  const startupState = chooseSharedQueueStartupState({
    remoteSnapshot,
    localCache: localSnapshot,
  });

  if (startupState.source === "local-cache") {
    return {
      ...startupState,
      source: "local",
    };
  }

  return startupState;
}

export function isQueueSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orders) || snapshot.orders.length === 0;
}
