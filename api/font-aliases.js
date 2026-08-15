import { normalizeCustomerFontAlias } from "../src/amazon-customer-fonts.js";
import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import { listWorkspaceFontAliases, mapWorkspaceFontAlias } from "./_lib/font-alias-store.js";

function readJsonBody(req) {
  if (req.body == null) return {};
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

function readMappingPayload(req) {
  const body = readJsonBody(req);
  return {
    aliasName: typeof body?.aliasName === "string" ? body.aliasName : "",
    fontId: typeof body?.fontId === "string" ? body.fontId : "",
    orderItemId: typeof body?.orderItemId === "string" ? body.orderItemId : null,
    designId: typeof body?.designId === "string" ? body.designId : null,
    lineIndex: Number.isInteger(body?.lineIndex) ? body.lineIndex : null,
    expectedOrderRevision: Number.isInteger(body?.expectedOrderRevision) ? body.expectedOrderRevision : null,
    expectedDesignRevision: Number.isInteger(body?.expectedDesignRevision) ? body.expectedDesignRevision : null,
  };
}

function sendError(res, error) {
  if (error?.statusCode && error?.expose) {
    res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    return;
  }
  res.status(500).json({ error: "Unable to save this font mapping.", code: "FONT_ALIAS_SAVE_FAILED" });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  let auth = null;
  try {
    auth = await resolveProductionBatchAuth(req);
    if (req.method === "GET") {
      res.status(200).json({ fontAliases: await listWorkspaceFontAliases({ workspaceId: auth.workspaceId }) });
      return;
    }

    const payload = readMappingPayload(req);
    const result = await mapWorkspaceFontAlias({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      ...payload,
      normalizedAlias: normalizeCustomerFontAlias(payload.aliasName),
    });
    res.status(200).json(result);
  } catch (error) {
    if (auth && error?.code === "FONT_ALIAS_CONFLICT" && error?.statusCode === 409) {
      try {
        const fontAliases = await listWorkspaceFontAliases({ workspaceId: auth.workspaceId });
        res.status(409).json({ error: error.message, code: error.code, fontAliases });
        return;
      } catch {
        // Fall through to the safe conflict response when refreshing aliases also fails.
      }
    }
    sendError(res, error);
  }
}
