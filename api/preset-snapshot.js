import { loadPresetSnapshot, savePresetSnapshot } from "./_lib/preset-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

function isValidPresetSnapshot(snapshot) {
  return Boolean(
    snapshot
    && typeof snapshot === "object"
    && Number.isInteger(snapshot.version)
    && typeof snapshot.defaultPresetId === "string"
    && snapshot.defaultPresetId.trim()
    && Array.isArray(snapshot.presets),
  );
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const workspaceKey = typeof req.query?.workspaceKey === "string" && req.query.workspaceKey.trim()
        ? req.query.workspaceKey.trim()
        : "primary";
      const record = await loadPresetSnapshot(workspaceKey);

      if (!record) {
        res.status(404).json({ error: "Preset snapshot not found." });
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

      if (!isValidPresetSnapshot(snapshot)) {
        res.status(400).json({ error: "snapshot.version, snapshot.defaultPresetId, and snapshot.presets are required." });
        return;
      }

      const record = await savePresetSnapshot(workspaceKey.trim(), snapshot);
      res.status(200).json(record);
      return;
    }

    res.setHeader("Allow", "GET, PUT");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected preset snapshot error.",
    });
  }
}
