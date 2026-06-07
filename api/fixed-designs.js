import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import {
  createWorkspaceFixedDesign,
  deleteWorkspaceFixedDesign,
  listWorkspaceFixedDesigns,
  replaceWorkspaceFixedDesign,
} from "./_lib/fixed-design-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  return req.body;
}

function readFixedDesignId(req) {
  return typeof req.query?.fixedDesignId === "string" ? req.query.fixedDesignId.trim() : "";
}

function readUploadPayload(req) {
  const body = readJsonBody(req);
  const file = body.file ?? body.fixedDesignFile ?? null;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  return { file, displayName };
}

function sendError(res, error, fallbackMessage = "Unable to manage fixed designs.") {
  if (error?.statusCode && error?.expose) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

export default async function handler(req, res) {
  try {
    req.auth = await resolveProductionBatchAuth(req);

    if (req.method === "GET") {
      const fixedDesigns = await listWorkspaceFixedDesigns({
        workspaceId: req.auth.workspaceId,
        includeDeleted: req.query?.includeDeleted === "true",
      });
      res.status(200).json({ fixedDesigns });
      return;
    }

    if (req.method === "POST") {
      const { file, displayName } = readUploadPayload(req);
      if (!file) {
        res.status(400).json({ error: "Fixed design upload must include a file." });
        return;
      }
      const fixedDesign = await createWorkspaceFixedDesign({
        workspaceId: req.auth.workspaceId,
        displayName,
        file,
      });
      res.status(201).json({ fixedDesign });
      return;
    }

    if (req.method === "PUT") {
      const fixedDesignId = readFixedDesignId(req);
      const { file } = readUploadPayload(req);
      if (!fixedDesignId) {
        res.status(400).json({ error: "fixedDesignId is required." });
        return;
      }
      if (!file) {
        res.status(400).json({ error: "Fixed design upload must include a file." });
        return;
      }
      const fixedDesign = await replaceWorkspaceFixedDesign({
        workspaceId: req.auth.workspaceId,
        fixedDesignId,
        file,
      });
      res.status(200).json({ fixedDesign });
      return;
    }

    if (req.method === "DELETE") {
      const fixedDesignId = readFixedDesignId(req);
      if (!fixedDesignId) {
        res.status(400).json({ error: "fixedDesignId is required." });
        return;
      }
      const fixedDesign = await deleteWorkspaceFixedDesign({
        workspaceId: req.auth.workspaceId,
        fixedDesignId,
      });
      res.status(200).json({ fixedDesign });
      return;
    }

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    sendError(res, error);
  }
}
