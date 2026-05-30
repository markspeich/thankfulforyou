import { chooseProductionBatchStartupState } from "./production-batch-model.js";

export const REMOTE_BATCH_WORKSPACE_KEY = "primary";

export function buildRemoteBatchPayload(snapshot) {
  return {
    workspaceKey: REMOTE_BATCH_WORKSPACE_KEY,
    snapshot,
  };
}

export function chooseInitialBatchSnapshot({
  localSnapshot,
  remoteSnapshot,
}) {
  const startupState = chooseProductionBatchStartupState({
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

export function isBatchSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orderItems) || snapshot.orderItems.length === 0;
}
