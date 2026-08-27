import { getSettingsSignatureCandidates } from "./order-signatures.js";
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
function normalizeComparableSource(source) {
  return source && typeof source === "object" ? source : null;
}

function buildComparablePublishedOrder(order) {
  if (!order || typeof order !== "object") {
    return null;
  }

  return {
    id: typeof order.id === "string" ? order.id : "",
    text: typeof order.text === "string" ? order.text : "",
    status: typeof order.status === "string" ? order.status : "",
    settingsSignatures: getSettingsSignatureCandidates(order.settings || {}),
    source: normalizeComparableSource(order.source),
  };
}

export function isRevisionOnlyProductionBatchConflict({
  localPublishedOrder,
  remoteOrder,
} = {}) {
  const comparableLocalOrder = buildComparablePublishedOrder(localPublishedOrder);
  const comparableRemoteOrder = buildComparablePublishedOrder(remoteOrder);
  if (!comparableLocalOrder || !comparableRemoteOrder || comparableLocalOrder.id !== comparableRemoteOrder.id) {
    return false;
  }

  const localSettingsSignatures = new Set(comparableLocalOrder.settingsSignatures);
  const hasMatchingSettingsSignature = comparableRemoteOrder.settingsSignatures
    .some((signature) => localSettingsSignatures.has(signature));

  return hasMatchingSettingsSignature
    && comparableLocalOrder.text === comparableRemoteOrder.text
    && comparableLocalOrder.status === comparableRemoteOrder.status
    && JSON.stringify(comparableLocalOrder.source) === JSON.stringify(comparableRemoteOrder.source);
}

function buildComparableAttemptedOrder(order) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const {
    revision: _revision,
    designId: _designId,
    designRevision: _designRevision,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    ...persistedDesign
  } = order;
  return persistedDesign;
}

export function isAttemptedProductionBatchOrderAcknowledged({
  attemptedOrder,
  remoteOrder,
} = {}) {
  const comparableAttemptedOrder = buildComparableAttemptedOrder(attemptedOrder);
  const comparableRemoteOrder = buildComparableAttemptedOrder(remoteOrder);
  return Boolean(
    comparableAttemptedOrder
    && comparableRemoteOrder
    && JSON.stringify(comparableAttemptedOrder) === JSON.stringify(comparableRemoteOrder)
  );
}
