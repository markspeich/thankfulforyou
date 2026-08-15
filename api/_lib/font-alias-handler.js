import { normalizeCustomerFontAlias } from "../../src/amazon-customer-fonts.js";
import { resolveProductionBatchAuth } from "./production-batch-auth.js";
import { listWorkspaceFontAliases, mapWorkspaceFontAlias } from "./font-alias-store.js";

function readJsonBody(req) {
  if (req.body == null) return {};
  if (typeof req.body !== "string") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw Object.assign(new Error("Font alias input must be valid JSON."), {
      statusCode: 400,
      code: "FONT_ALIAS_VALIDATION",
      expose: true,
    });
  }
}

function readMappingPayload(req) {
  const body = readJsonBody(req);
  return {
    aliasName: typeof body?.aliasName === "string" ? body.aliasName : "",
    fontId: typeof body?.fontId === "string" ? body.fontId : "",
    orderItemId: typeof body?.orderItemId === "string" ? body.orderItemId : null,
    designId: typeof body?.designId === "string" ? body.designId : null,
    lineIndex: Number.isInteger(body?.lineIndex) ? body.lineIndex : null,
    expectedAliasRevision: Number.isInteger(body?.expectedAliasRevision) ? body.expectedAliasRevision : null,
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
        res.status(503).json({
          error: "The latest font mappings could not be loaded. Try again.",
          code: "FONT_ALIAS_SNAPSHOT_UNAVAILABLE",
        });
        return;
      }
    }
    sendError(res, error);
  }
}
