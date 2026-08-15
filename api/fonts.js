import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import fontAliasHandler from "./_lib/font-alias-handler.js";
import {
  createWorkspaceFont,
  archiveWorkspaceFont,
  listWorkspaceFonts,
  replaceWorkspaceFont,
  restoreWorkspaceFont,
  updateWorkspaceFontSettings,
} from "./_lib/font-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  return req.body;
}

function readFontId(req) {
  return typeof req.query?.fontId === "string" ? req.query.fontId.trim() : "";
}

function readUploadPayload(req) {
  const body = readJsonBody(req);
  const file = body.file ?? body.fontFile ?? null;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  return { file, displayName };
}

function readFontSettingsPayload(req) {
  const body = readJsonBody(req);
  return {
    displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
    bridgingEnabled: body.bridgingEnabled,
    lifecycle: body.lifecycle,
  };
}

function sendError(res, error, fallbackMessage = "Unable to manage fonts.") {
  if (error?.statusCode && error?.expose) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

export default async function handler(req, res) {
  if (req.query?.resource === "aliases") {
    await fontAliasHandler(req, res);
    return;
  }

  try {
    req.auth = await resolveProductionBatchAuth(req);

    if (req.method === "GET") {
      const fonts = await listWorkspaceFonts({
        workspaceId: req.auth.workspaceId,
        includeArchived: req.query?.includeArchived === "true",
      });
      res.status(200).json({ fonts });
      return;
    }

    if (req.method === "POST") {
      const { file, displayName } = readUploadPayload(req);
      if (!file) {
        res.status(400).json({ error: "Font upload must include a file." });
        return;
      }
      const font = await createWorkspaceFont({
        workspaceId: req.auth.workspaceId,
        displayName,
        file,
      });
      res.status(201).json({ font });
      return;
    }

    if (req.method === "PUT") {
      const fontId = readFontId(req);
      const { file } = readUploadPayload(req);
      if (!fontId) {
        res.status(400).json({ error: "fontId is required." });
        return;
      }
      if (!file) {
        res.status(400).json({ error: "Font upload must include a file." });
        return;
      }
      const font = await replaceWorkspaceFont({
        workspaceId: req.auth.workspaceId,
        fontId,
        file,
      });
      res.status(200).json({ font });
      return;
    }

    if (req.method === "PATCH") {
      const fontId = readFontId(req);
      const { displayName, bridgingEnabled, lifecycle } = readFontSettingsPayload(req);
      if (!fontId) {
        res.status(400).json({ error: "fontId is required." });
        return;
      }
      if (lifecycle === "archive" || lifecycle === "restore") {
        const font = lifecycle === "archive"
          ? await archiveWorkspaceFont({ workspaceId: req.auth.workspaceId, fontId })
          : await restoreWorkspaceFont({ workspaceId: req.auth.workspaceId, fontId });
        res.status(200).json({ font });
        return;
      }
      if (typeof bridgingEnabled !== "boolean") {
        res.status(400).json({ error: "bridgingEnabled must be true or false." });
        return;
      }
      if (displayName !== undefined && !displayName) {
        res.status(400).json({ error: "Font display name is required." });
        return;
      }
      const font = await updateWorkspaceFontSettings({
        workspaceId: req.auth.workspaceId,
        fontId,
        displayName,
        bridgingEnabled,
      });
      res.status(200).json({ font });
      return;
    }

    res.setHeader("Allow", "GET, POST, PUT, PATCH");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    sendError(res, error);
  }
}
