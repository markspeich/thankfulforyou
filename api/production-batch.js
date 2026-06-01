import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import { loadProductionBatch, saveProductionBatch } from "./_lib/production-batch-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

function normalizeSnapshot(value) {
  if (!value) {
    return value;
  }

  return {
    batch: value.batch ?? null,
    activeOrderItemId: value.activeOrderItemId ?? null,
    orderItems: Array.isArray(value.orderItems) ? value.orderItems : [],
  };
}

function normalizeRevision(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeChangedOrderItemIds(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : null;
}

function mergeSnapshotWithCurrentForUnchangedOrders(incomingSnapshot, currentSnapshot, changedOrderItemIds = null) {
  if (!changedOrderItemIds || !currentSnapshot || !Array.isArray(incomingSnapshot?.orderItems) || !Array.isArray(currentSnapshot?.orderItems)) {
    return incomingSnapshot;
  }

  const changedOrderItemIdSet = new Set(changedOrderItemIds);
  const incomingOrderItemsById = new Map(
    incomingSnapshot.orderItems
      .filter((orderItem) => typeof orderItem?.id === "string" && orderItem.id.trim())
      .map((orderItem) => [orderItem.id.trim(), orderItem]),
  );

  const mergedOrderItems = currentSnapshot.orderItems.map((currentOrderItem) => {
    const orderItemId = typeof currentOrderItem?.id === "string" ? currentOrderItem.id.trim() : "";
    return orderItemId && changedOrderItemIdSet.has(orderItemId) && incomingOrderItemsById.has(orderItemId)
      ? incomingOrderItemsById.get(orderItemId)
      : currentOrderItem;
  });

  for (const incomingOrderItem of incomingSnapshot.orderItems) {
    const orderItemId = typeof incomingOrderItem?.id === "string" ? incomingOrderItem.id.trim() : "";
    if (orderItemId && changedOrderItemIdSet.has(orderItemId) && !currentSnapshot.orderItems.some((currentOrderItem) => currentOrderItem?.id === orderItemId)) {
      mergedOrderItems.push(incomingOrderItem);
    }
  }

  return {
    ...incomingSnapshot,
    orderItems: mergedOrderItems,
  };
}

function findRevisionConflict(incomingSnapshot, currentSnapshot, changedOrderItemIds = null) {
  if (!incomingSnapshot || !currentSnapshot || !Array.isArray(incomingSnapshot.orderItems) || !Array.isArray(currentSnapshot.orderItems)) {
    return null;
  }

  const changedOrderItemIdSet = changedOrderItemIds ? new Set(changedOrderItemIds) : null;
  const currentOrderItemsById = new Map(
    currentSnapshot.orderItems
      .filter((orderItem) => typeof orderItem?.id === "string" && orderItem.id.trim())
      .map((orderItem) => [orderItem.id.trim(), orderItem]),
  );

  for (const incomingOrderItem of incomingSnapshot.orderItems) {
    const orderItemId = typeof incomingOrderItem?.id === "string" ? incomingOrderItem.id.trim() : "";
    if (changedOrderItemIdSet && !changedOrderItemIdSet.has(orderItemId)) {
      continue;
    }

    if (!orderItemId || !currentOrderItemsById.has(orderItemId)) {
      continue;
    }

    const currentOrderItem = currentOrderItemsById.get(orderItemId);
    const expectedRevision = normalizeRevision(incomingOrderItem.revision);
    const currentRevision = normalizeRevision(currentOrderItem.revision);

    if (expectedRevision !== currentRevision) {
      return {
        orderItemId,
        revision: currentRevision,
        updatedAt: currentOrderItem.updatedAt ?? null,
        updatedBy: currentOrderItem.updatedBy ?? null,
      };
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    req.auth = await resolveProductionBatchAuth(req);

    if (req.method === "GET") {
      const batchId = typeof req.query?.batchId === "string" ? req.query.batchId.trim() : "";

      if (!batchId) {
        res.status(400).json({ error: "batchId is required." });
        return;
      }

      const snapshot = await loadProductionBatch({
        batchId,
        workspaceId: req.auth.workspaceId,
      });

      if (!snapshot) {
        res.status(404).json({ error: "Production batch not found." });
        return;
      }

      res.status(200).json(snapshot);
      return;
    }

    if (req.method === "PUT") {
      const { snapshot, changedOrderItemIds: rawChangedOrderItemIds } = readJsonBody(req);
      const changedOrderItemIds = normalizeChangedOrderItemIds(rawChangedOrderItemIds);

      if (!snapshot?.batch?.id || !snapshot?.batch?.workspaceId) {
        res.status(400).json({ error: "snapshot.batch.id and snapshot.batch.workspaceId are required." });
        return;
      }

      if (snapshot.batch.workspaceId !== req.auth.workspaceId) {
        res.status(403).json({ error: "snapshot.batch.workspaceId must match the authenticated workspace." });
        return;
      }

      if (!Array.isArray(snapshot.orderItems)) {
        res.status(400).json({ error: "snapshot.orderItems must be an array." });
        return;
      }

      const currentSnapshot = await loadProductionBatch({
        batchId: snapshot.batch.id,
        workspaceId: req.auth.workspaceId,
      });

      if (!currentSnapshot) {
        res.status(404).json({ error: "Production batch not found." });
        return;
      }

      const normalizedCurrentSnapshot = normalizeSnapshot(currentSnapshot);
      const revisionConflict = findRevisionConflict(snapshot, normalizedCurrentSnapshot, changedOrderItemIds);
      if (revisionConflict) {
        res.status(409).json({
          error: "Revision conflict",
          details: revisionConflict,
        });
        return;
      }

      const savedSnapshot = await saveProductionBatch({
        snapshot: mergeSnapshotWithCurrentForUnchangedOrders(snapshot, normalizedCurrentSnapshot, changedOrderItemIds),
        changedOrderItemIds,
        userId: req.auth.userId,
      });

      res.status(200).json(normalizeSnapshot(savedSnapshot));
      return;
    }

    res.setHeader("Allow", "GET, PUT");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    if (error?.statusCode && error?.expose) {
      res.status(error.statusCode).json({
        error: error.message,
      });
      return;
    }

    if (error?.code === "REVISION_CONFLICT") {
      res.status(409).json({
        error: error.message,
        details: error.details || null,
      });
      return;
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected production batch error.",
    });
  }
}
