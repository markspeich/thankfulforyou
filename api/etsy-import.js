import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import * as connectionStore from "./_lib/etsy-connection-store.js";
import { refreshEtsyAuthorization } from "./_lib/etsy-oauth.js";
import { createEtsyClient } from "./_lib/etsy-client.js";
import { normalizeEtsyTransaction } from "./_lib/etsy-import-normalizer.js";
import { importWorkspaceOrderItems } from "./_lib/orders-store.js";
import { loadPresetSnapshot } from "./_lib/preset-store.js";
import { createEtsyImportService, EtsyImportError } from "./_lib/etsy-import-service.js";
function lookup(snapshot) {
  const map = new Map((snapshot?.presets || []).flatMap((p) => (p.listingAssignments || []).map((a) => [String(a.listingId), p.id])));
  return (id) => map.get(String(id)) || snapshot?.defaultPresetId || null;
}
export function createEtsyImportHandler({ resolveAuth = resolveProductionBatchAuth, serviceFactory = createEtsyImportService, dependencies = {} } = {}) {
  return async (req, res) => {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Method not allowed." }); return; }
    let prepared, streaming = false;
    try {
      const auth = await resolveAuth(req);
      const snapshot = await (dependencies.loadPresetSnapshot || loadPresetSnapshot)(auth.workspaceId);
      const service = serviceFactory({
        store: dependencies.store || { ...connectionStore, importWorkspaceOrderItems },
        refreshAccess: dependencies.refreshAccess || refreshEtsyAuthorization,
        createClient: dependencies.createClient || createEtsyClient,
        normalizeTransaction: dependencies.normalizeTransaction || normalizeEtsyTransaction,
        getPresetIdForListingId: lookup(snapshot), clock: dependencies.clock, randomUUID: dependencies.randomUUID,
      });
      prepared = await service.prepare({
        ...auth, signal: req.signal,
        onProgress(event) { if (streaming) res.write(JSON.stringify(event) + "\n"); },
      });
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders?.();
      streaming = true;
      await prepared.run();
      res.end();
    } catch (error) {
      if (!streaming) {
        try { await prepared?.release(); } catch {}
        if (error?.statusCode && (error?.expose || error instanceof EtsyImportError || error?.code)) res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
        else res.status(500).json({ error: "Unable to import Etsy orders." });
        return;
      }
      try { await prepared?.release(); } catch {}
      res.write(JSON.stringify({ type: "error", code: error?.code || "import_failed", message: "Unable to import Etsy orders." }) + "\n");
      res.end();
    }
  };
}
export default createEtsyImportHandler();
