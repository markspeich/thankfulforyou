import { deleteQueueSnapshot, loadQueueSnapshot, saveQueueSnapshot } from "./_lib/queue-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const workspaceKey = typeof req.query?.workspaceKey === "string" && req.query.workspaceKey.trim()
        ? req.query.workspaceKey.trim()
        : "primary";
      const record = await loadQueueSnapshot(workspaceKey);

      if (!record) {
        res.status(404).json({ error: "Queue snapshot not found." });
        return;
      }

      res.status(200).json(record);
      return;
    }

    if (req.method === "PUT") {
      const { workspaceKey, snapshot } = readJsonBody(req);

      if (typeof workspaceKey !== "string" || !workspaceKey.trim()) {
        res.status(400).json({ error: "workspaceKey is required." });
        return;
      }

      if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.orders)) {
        res.status(400).json({ error: "snapshot.orders is required." });
        return;
      }

      const record = await saveQueueSnapshot(workspaceKey.trim(), snapshot);
      res.status(200).json(record);
      return;
    }

    if (req.method === "DELETE") {
      const workspaceKey = typeof req.query?.workspaceKey === "string" && req.query.workspaceKey.trim()
        ? req.query.workspaceKey.trim()
        : "primary";
      await deleteQueueSnapshot(workspaceKey);
      res.status(204).end();
      return;
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected queue snapshot error.",
    });
  }
}
