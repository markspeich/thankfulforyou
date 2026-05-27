import { resolveSharedQueueAuth } from "./_lib/shared-queue-auth.js";
import { loadSharedQueue, saveSharedQueue } from "./_lib/shared-queue-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

function normalizeJsonValue(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

function normalizeSnapshot(value) {
  if (!value) {
    return value;
  }

  if ("queue" in value && "activeOrderId" in value && "orders" in value) {
    return {
      queue: normalizeJsonValue(value.queue),
      activeOrderId: value.activeOrderId,
      orders: normalizeJsonValue(value.orders),
    };
  }

  return {
    queue: normalizeJsonValue(value.queue_json),
    activeOrderId: value.active_order_id ?? null,
    orders: normalizeJsonValue(value.orders_json) ?? [],
  };
}

export default async function handler(req, res) {
  try {
    req.auth = await resolveSharedQueueAuth(req);

    if (req.method === "GET") {
      const queueId = typeof req.query?.queueId === "string" ? req.query.queueId.trim() : "";

      if (!queueId) {
        res.status(400).json({ error: "queueId is required." });
        return;
      }

      const snapshot = await loadSharedQueue({
        queueId,
        workspaceId: req.auth.workspaceId,
      });

      if (!snapshot) {
        res.status(404).json({ error: "Shared queue not found." });
        return;
      }

      res.status(200).json(snapshot);
      return;
    }

    if (req.method === "PUT") {
      const { snapshot } = readJsonBody(req);

      if (!snapshot?.queue?.id || !snapshot?.queue?.workspaceId) {
        res.status(400).json({ error: "snapshot.queue.id and snapshot.queue.workspaceId are required." });
        return;
      }

      if (snapshot.queue.workspaceId !== req.auth.workspaceId) {
        res.status(403).json({ error: "snapshot.queue.workspaceId must match the authenticated workspace." });
        return;
      }

      if (!Array.isArray(snapshot.orders)) {
        res.status(400).json({ error: "snapshot.orders must be an array." });
        return;
      }

      const savedSnapshot = await saveSharedQueue({
        snapshot,
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
      error: error instanceof Error ? error.message : "Unexpected shared queue error.",
    });
  }
}
