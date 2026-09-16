import { resolveProductionBatchAuth } from "./production-batch-auth.js";
import { cleanCopyPrompt, createListingStore, listingError, parseEtsyListingSource } from "./listing-store.js";
import { getListingCapabilities, generateListingCopy, prepareListingImage, ListingProviderError } from "./listing-providers.js";
import { createListingImportService } from "./listing-import-service.js";
import { getEtsyConnectionCredentials } from "./etsy-connection-store.js";
import { createEtsyClient } from "./etsy-client.js";
import { createListingAmazonSandboxService } from "./listing-amazon-sandbox.js";
import { createListingAmazonProductionService } from "./listing-amazon-production.js";
import { hasAmazonProductionConfig } from "./amazon-production-client.js";
import { hasAmazonSandboxConfig } from "./amazon-sandbox-client.js";

function readBody(req) {
  let payload = req.body ?? {};
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { throw listingError(400, "Invalid request body."); }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw listingError(400, "Invalid request body.");
  return payload;
}

function safeError(res, error) {
  if (error instanceof ListingProviderError || (error?.statusCode && error?.expose)) return res.status(error.statusCode || 502).json({ error: error.message });
  console.error("Listings API error", error?.name || "Error");
  return res.status(500).json({ error: "Unable to manage listing drafts." });
}

export function createListingsHandler({
  resolveAuth = resolveProductionBatchAuth,
  store = createListingStore(),
  getCapabilities = getListingCapabilities,
  generateCopy = generateListingCopy,
  prepareImage = prepareListingImage,
  importer = createListingImportService({ getConnection: getEtsyConnectionCredentials, createClient: createEtsyClient }),
  sandboxService = null,
  productionService = null,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!["GET", "POST", "PATCH"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST, PATCH");
        return res.status(405).json({ error: "Method not allowed." });
      }
      const { workspaceId } = await resolveAuth(req);
      const sandboxEnabled = sandboxService ? sandboxService.configured() : hasAmazonSandboxConfig(process.env);
      const sandbox = sandboxEnabled ? (sandboxService || createListingAmazonSandboxService()) : null;
      const productionEnabled = productionService ? productionService.configured() : hasAmazonProductionConfig(process.env);
      const production = productionEnabled ? (productionService || createListingAmazonProductionService()) : null;
      const capabilities = { ...getCapabilities(process.env), amazon: false, amazonSandbox: sandboxEnabled, amazonProduction: productionEnabled };
      const withSandbox = async (draft) => {
        if (!draft) return draft;
        return { ...draft, ...(sandbox ? { amazonSandbox: await sandbox.describe({workspaceId,draft}) } : {}), ...(production ? { amazonProduction: await production.describe({workspaceId,draft}) } : {}) };
      };
      if (req.method === "GET") {
        if (req.query?.setting === "copyPrompt") return res.status(200).json({ prompt: await store.getCopyPrompt({ workspaceId }) });
        const id = typeof req.query?.id === "string" ? req.query.id.trim() : "";
        if (!id) return res.status(200).json({ drafts: await Promise.all((await store.listDrafts({ workspaceId })).map(withSandbox)), capabilities });
        const draft = await store.getDraft({ workspaceId, id });
        if (!draft) throw listingError(404, "Listing draft not found.");
        return res.status(200).json({ draft: await withSandbox(draft), capabilities });
      }
      const payload = readBody(req);
      if (req.method === "PATCH") {
        return res.status(200).json({ draft: await withSandbox(await store.updateDraft({ workspaceId, id: payload.id, revision: payload.revision, changes: payload.changes })) });
      }
      if (payload.action === "import") {
        const result = await store.runOperation({ workspaceId, sourceKey: parseEtsyListingSource(payload.source), type: "import", run: async () => {
          const imported = await importer.importOwnedListing({ workspaceId, source: payload.source, signal: req.signal });
          return store.importDraft({ workspaceId, ...imported });
        } });
        return res.status(result.existing ? 200 : 201).json({ ...result, draft: await withSandbox(result.draft) });
      }
      if (payload.action === "saveCopyPrompt") {
        return res.status(200).json({ prompt: await store.saveCopyPrompt({ workspaceId, prompt: cleanCopyPrompt(payload.prompt) }) });
      }
      if (payload.action === "submitAmazon") throw listingError(409, "Amazon submission is not available yet.");
      const productionAction = { validateAmazonProduction: "validate", submitAmazonProduction: "submit", reconcileAmazonProduction: "reconcile" }[payload.action];
      if (productionAction) {
        if (!production) throw listingError(409, "Amazon production credentials are not configured.");
        const draft = await store.getDraft({ workspaceId, id: payload.id });
        if (!draft) throw listingError(404, "Listing draft not found.");
        if (Number(payload.revision) !== draft.revision) throw listingError(409, "This draft changed. Reload it and try again.");
        await production.run({ workspaceId, draft, action: productionAction, confirmed: payload.confirmProduction === true });
        return res.status(200).json({ draft: await withSandbox(await store.getDraft({workspaceId,id:draft.id})) });
      }
      const sandboxAction = { validateAmazonSandbox: "validate", submitAmazonSandbox: "submit", reconcileAmazonSandbox: "reconcile" }[payload.action];
      if (sandboxAction) {
        if (!sandbox) throw listingError(409, "Amazon sandbox credentials are not configured.");
        const draft = await store.getDraft({ workspaceId, id: payload.id });
        if (!draft) throw listingError(404, "Listing draft not found.");
        if (Number(payload.revision) !== draft.revision) throw listingError(409, "This draft changed. Reload it and try again.");
        await sandbox.run({ workspaceId, draft, action: sandboxAction });
        return res.status(200).json({ draft: await withSandbox(await store.getDraft({ workspaceId, id: draft.id })) });
      }
      if (!["generateCopy", "prepareImage", "uploadImage"].includes(payload.action)) throw listingError(400, "Unsupported listing action.");
      const draft = await store.getDraft({ workspaceId, id: payload.id });
      if (!draft) throw listingError(404, "Listing draft not found.");
      if (Number(payload.revision) !== draft.revision) throw listingError(409, "This draft changed. Reload it and try again.");
      const context = { workspaceId, draftId: draft.id, revision: draft.revision };
      if (payload.action === "uploadImage") {
        return res.status(200).json({ draft: await withSandbox(await store.uploadAsset({ ...context, file: payload.file })) });
      }
      if (payload.action === "generateCopy") {
        if (!capabilities.copyGeneration) throw listingError(409, "Copy generation is not configured.");
        const saved = await store.runOperation({ ...context, type: "copy_generation", run: async () => {
          const prompt = await store.getCopyPrompt({ workspaceId });
          const images = await store.getCopyImages({ workspaceId, draftId: draft.id });
          const generated = await generateCopy({ draft, prompt, images, env: process.env, fetchImpl: fetch });
          return store.updateDraft({ workspaceId, id: draft.id, revision: draft.revision,
            changes: { title: generated.title, description: generated.description, bullets: generated.bullets },
            internalWarnings: [...new Set([...draft.warnings, ...(generated.warnings || [])])],
          });
        } });
        return res.status(200).json({ draft: await withSandbox(saved) });
      }
      if (!capabilities.imagePreparation) throw listingError(409, "Image preparation is not configured.");
      if (typeof payload.imageId !== "string" || !payload.imageId.trim()) throw listingError(400, "imageId is required.");
      const saved = await store.runOperation({ ...context, type: "image_preparation", run: () => store.prepareAsset({
        ...context, imageId: payload.imageId.trim(),
        prepare: ({ bytes, mimeType }) => prepareImage({ bytes, mimeType, env: process.env, fetchImpl: fetch }),
      }) });
      return res.status(200).json({ draft: await withSandbox(saved) });
    } catch (error) { return safeError(res, error); }
  };
}

export default async function listingHandler(req, res) {
  try { return await createListingsHandler()(req, res); }
  catch (error) { res.setHeader("Cache-Control", "no-store"); return safeError(res, error); }
}
