import crypto from "node:crypto";
import { createSupabaseAdminClient } from "./supabase-admin.js";
import { LISTING_ASSET_BUCKET, listingAssetPath, readBase64Raster, validateRasterBytes } from "./listing-assets.js";
import { DEFAULT_LISTING_COPY_PROMPT } from "./listing-copy-prompt.js";

const COPY_FIELDS = new Set(["title", "description", "bullets", "basePriceCents"]);
const EDITABLE_FIELDS = new Set(["title", "description", "bullets", "basePriceCents", "copyApproved", "images", "amazonProductionDetails"]);
const ETSY_HOSTS = new Set(["etsy.com", "www.etsy.com"]);
const COPY_OPERATION_LEASE_MS = 170_000;

export function listingError(statusCode, message) { return Object.assign(new Error(message), { statusCode, expose: true }); }
export function cleanCopyPrompt(value) {
  if (typeof value !== "string") throw listingError(400, "copy prompt must be text.");
  const prompt = value.trim();
  if (!prompt || prompt.length > 20_000) throw listingError(400, "copy prompt is invalid.");
  return prompt;
}
export function parseEtsyListingSource(source) {
  const text = String(source || "").trim();
  if (/^\d+$/.test(text)) return text;
  let url; try { url = new URL(text); } catch { throw listingError(400, "Enter an Etsy listing URL or ID."); }
  if (url.protocol !== "https:" || !ETSY_HOSTS.has(url.hostname.toLowerCase())) throw listingError(400, "Enter an Etsy listing URL or ID.");
  const match = url.pathname.match(/^\/listing\/(\d+)(?:\/|$)/i);
  if (!match) throw listingError(400, "Enter an Etsy listing URL or ID.");
  return match[1];
}
function cleanText(value, field, { max = 10000, allowEmpty = true } = {}) {
  if (typeof value !== "string") throw listingError(400, `${field} must be text.`);
  const text = value.trim(); if ((!allowEmpty && !text) || text.length > max) throw listingError(400, `${field} is invalid.`); return text;
}
export function normalizeAmazonProductionDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw listingError(400, "amazonProductionDetails is invalid.");
  const numericFields = ["packageLengthInches", "packageWidthInches", "packageHeightInches", "packageWeightOunces"];
  const textFields = ["manufacturer", "partNumber", "specialFeature", "closureType"];
  const allowed = new Set([...numericFields, ...textFields]);
  if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) throw listingError(400, "amazonProductionDetails is invalid.");
  const details = {};
  for (const key of numericFields) {
    if (!Number.isFinite(value[key]) || value[key] <= 0) throw listingError(400, `${key} is invalid.`);
    details[key] = value[key];
  }
  for (const key of textFields) details[key] = cleanText(value[key], key, { max: 200, allowEmpty: false });
  return details;
}
export function normalizeListingChanges(changes, ownedImages = []) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw listingError(400, "changes must be an object.");
  const output = {}; const ids = new Set(ownedImages.map((image) => String(image.id)));
  for (const [key, value] of Object.entries(changes)) {
    if (!EDITABLE_FIELDS.has(key)) throw listingError(400, `Unsupported draft field: ${key}.`);
    if (key === "title") output.title = cleanText(value, "title", { max: 200 });
    if (key === "description") output.description = cleanText(value, "description");
    if (key === "bullets") { if (!Array.isArray(value) || value.length !== 5) throw listingError(400, "bullets must contain exactly five items."); output.bullets = value.map((item) => cleanText(item, "bullet", { max: 1000 })); }
    if (key === "basePriceCents") { if (!Number.isInteger(value) || value < 1 || value > 1000000) throw listingError(400, "basePriceCents is invalid."); output.basePriceCents = value; }
    if (key === "copyApproved") { if (typeof value !== "boolean") throw listingError(400, "copyApproved must be true or false."); output.copyApproved = value; }
    if (key === "amazonProductionDetails") output.amazonProductionDetails = normalizeAmazonProductionDetails(value);
    if (key === "images") {
      if (!Array.isArray(value)) throw listingError(400, "images must be an array.");
      output.images = value.map((image) => {
        if (!image || typeof image !== "object" || !ids.has(String(image.id))) throw listingError(400, "Each image must already belong to this draft.");
        const next = { id: String(image.id) }; for (const key of ["selected", "main", "approved"]) { if (key in image) { if (typeof image[key] !== "boolean") throw listingError(400, `image ${key} must be true or false.`); next[key] = image[key]; } } return next;
      });
    }
  }
  return output;
}
export function applyListingChanges(draft, changes) {
  const next = { ...draft, ...changes };
  if (Object.keys(changes).some((key) => COPY_FIELDS.has(key))) next.copyApproved = false;
  if (changes.images) {
    const byId = new Map(changes.images.map((image) => [image.id, image]));
    next.images = (draft.images || []).map((image) => ({ ...image, ...(byId.get(image.id) || {}) }));
    if (next.images.filter((image) => image.main).length > 1) throw listingError(400, "Choose only one main image.");
    for (const image of next.images) { const before = (draft.images || []).find((candidate) => candidate.id === image.id); if (before && (before.selected !== image.selected || before.main !== image.main)) image.approved = false; }
  }
  return next;
}
function rowToDraft(row, assets = []) { if (!row) return null; return { id: row.id, revision: Number(row.revision), etsyListingId: row.etsy_listing_id, sourceUrl: row.source_url, sourceTitle: row.source_title, sourceDescription: row.source_description, title: row.title, description: row.description, bullets: row.bullets_json || ["", "", "", "", ""], basePriceCents: row.base_price_cents, facts: row.facts_json || {}, amazonProductionDetails: row.amazon_production_details || {}, warnings: row.warnings_json || [], images: assets.map((asset) => ({ id: asset.id, url: asset.delivery_url || null, sourceUrl: asset.source_url || null, kind: asset.kind, alt: asset.alt || "", selected: asset.selected, main: asset.main, approved: asset.approved })), copyApproved: row.copy_approved, createdAt: row.created_at, updatedAt: row.updated_at }; }
async function loadAssets(supabase, draftId) { const { data, error } = await supabase.from("listing_assets").select("*").eq("draft_id", draftId).order("source_rank", { ascending: true }); if (error) throw error; return Promise.all((data || []).map(async (asset) => { const { data: signed, error: signedError } = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600); if (signedError) throw signedError; return { ...asset, delivery_url: signed?.signedUrl || null }; })); }
export function createListingStore({ supabase = createSupabaseAdminClient(), now = () => new Date().toISOString(), randomUUID = crypto.randomUUID } = {}) {
  async function cleanupUnreferenced(paths) {
    if (!paths.length) return;
    const { data, error } = await supabase.from("listing_assets").select("storage_path").in("storage_path", paths);
    // A timed-out RPC may have committed. Retain objects when commit status is unknown.
    if (error) return;
    const referenced = new Set((data || []).map((asset) => asset.storage_path));
    const orphaned = paths.filter((path) => !referenced.has(path));
    if (orphaned.length) await supabase.storage.from(LISTING_ASSET_BUCKET).remove(orphaned);
  }
  async function getDraft({ workspaceId, id }) { const { data, error } = await supabase.from("listing_drafts").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(); if (error) throw error; return data ? rowToDraft(data, await loadAssets(supabase, data.id)) : null; }
  return {
    async getCopyImages({ workspaceId, draftId }) {
      const { data, error } = await supabase.from("listing_assets").select("*").eq("workspace_id", workspaceId).eq("draft_id", draftId).eq("kind", "original").order("source_rank", { ascending: true }).limit(10);
      if (error) throw error;
      const images = [];
      let totalBytes = 0;
      for (const asset of data || []) {
        const { data: downloaded, error: downloadError } = await supabase.storage.from(asset.storage_bucket).download(asset.storage_path);
        if (downloadError || !downloaded) throw listingError(502, "Unable to load an imported Etsy photo. Try generating copy again.");
        if (downloaded.size > 10 * 1024 * 1024) throw listingError(400, "An imported Etsy photo is too large for copy generation.");
        const image = validateRasterBytes({ bytes: Buffer.from(await downloaded.arrayBuffer()), mimeType: asset.mime_type });
        totalBytes += image.bytes.length;
        if (totalBytes > 24 * 1024 * 1024) throw listingError(400, "Imported Etsy photos exceed the copy generation size limit.");
        images.push({ bytes: image.bytes, mimeType: image.mimeType });
      }
      return images;
    },
    async getCopyPrompt({ workspaceId }) {
      const { data, error } = await supabase.from("workspace_listing_copy_prompts").select("prompt").eq("workspace_id", workspaceId).maybeSingle();
      if (error) throw error;
      return data?.prompt || DEFAULT_LISTING_COPY_PROMPT;
    },
    async saveCopyPrompt({ workspaceId, prompt }) {
      const { data, error } = await supabase.from("workspace_listing_copy_prompts")
        .upsert({ workspace_id: workspaceId, prompt: cleanCopyPrompt(prompt), updated_at: now() }, { onConflict: "workspace_id" }).select("prompt").single();
      if (error) throw error;
      return data.prompt;
    },
    async listDrafts({ workspaceId }) { const { data, error } = await supabase.from("listing_drafts").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }); if (error) throw error; return Promise.all((data || []).map(async (row) => rowToDraft(row, await loadAssets(supabase, row.id)))); },
    getDraft,
    async runOperation({ workspaceId, draftId = null, revision = 0, sourceKey = null, type, run }) {
      if (type === "import" ? !sourceKey : !draftId) throw listingError(400, "Invalid listing operation.");
      const cutoff = new Date(Date.now() - (type === "image_preparation" ? 300000 : type === "copy_generation" ? COPY_OPERATION_LEASE_MS : 120000)).toISOString();
      let expiry = supabase.from("listing_operations").update({ status: "failed", safe_error_code: "expired", completed_at: now() })
        .eq("workspace_id", workspaceId).eq("operation_type", type).eq("status", "running").lt("created_at", cutoff);
      expiry = type === "import" ? expiry.eq("source_key", sourceKey) : expiry.eq("draft_id", draftId).eq("expected_revision", revision);
      const { error: expiryError } = await expiry;
      if (expiryError) throw expiryError;
      const operationId = randomUUID();
      const { error: claimError } = await supabase.from("listing_operations").insert({ id: operationId, workspace_id: workspaceId, draft_id: draftId, source_key: sourceKey, expected_revision: revision, operation_type: type, status: "running" });
      if (claimError) {
        if (claimError.code === "23505") throw listingError(409, "That listing operation is already running.");
        throw claimError;
      }
      try {
        const result = await run();
        const { error } = await supabase.from("listing_operations").update({ status: "completed", completed_at: now(), ...(type === "import" && result?.draft?.id ? { draft_id: result.draft.id } : {}) }).eq("id", operationId).eq("workspace_id", workspaceId);
        if (error) throw error;
        return result;
      } catch (error) {
        await supabase.from("listing_operations").update({ status: "failed", safe_error_code: error?.statusCode === 409 ? "conflict" : "failed", completed_at: now() }).eq("id", operationId).eq("workspace_id", workspaceId);
        throw error;
      }
    },
    async importDraft({ workspaceId, etsyShopId, etsyListingId, source }) {
      const listingId = String(etsyListingId);
      const { data: existing, error: lookupError } = await supabase.from("listing_drafts").select("*").eq("workspace_id", workspaceId).eq("etsy_shop_id", String(etsyShopId)).eq("etsy_listing_id", listingId).eq("target_marketplace", "amazon").maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return { draft: rowToDraft(existing, await loadAssets(supabase, existing.id)), existing: true };
      const draftId = randomUUID();
      const uploaded = [];
      const assets = [];
      const row = { id: draftId, workspaceId, etsyShopId: String(etsyShopId), etsyListingId: listingId, sourceUrl: source.sourceUrl || null, sourceTitle: source.title, sourceDescription: source.description, title: source.title, description: source.description, bullets: ["", "", "", "", ""], basePriceCents: 1999, facts: source.facts || {}, warnings: source.warnings || [] };
      let committed = false;
      const cleanup = () => cleanupUnreferenced(uploaded);
      try {
        for (const [index, original] of (source.images || []).entries()) {
          const image = validateRasterBytes({ bytes: original.bytes, mimeType: original.mimeType });
          const id = randomUUID();
          const storagePath = listingAssetPath({ workspaceId, draftId, extension: image.extension, id });
          const { error } = await supabase.storage.from(LISTING_ASSET_BUCKET).upload(storagePath, image.bytes, { contentType: image.mimeType, cacheControl: "31536000", upsert: false });
          if (error) throw error;
          uploaded.push(storagePath);
          assets.push({ id, kind: "original", sourceUrl: original.sourceUrl, storageBucket: LISTING_ASSET_BUCKET, storagePath, mimeType: image.mimeType, byteSize: image.bytes.length, width: image.width, height: image.height, sourceRank: original.sourceRank ?? index, alt: original.alt || "", main: Boolean(original.main) });
        }
        const { data, error } = await supabase.rpc("import_listing_draft_atomic", { p_draft: row, p_assets: assets });
        if (error) throw error;
        const result = data?.[0];
        if (!result?.draft_id) throw new Error("Missing imported draft");
        committed = !result.existing;
        if (result.existing) await cleanup();
        return { draft: await getDraft({ workspaceId, id: result.draft_id }), existing: result.existing };
      } catch (error) {
        // Never remove originals once the database committed their references.
        if (!committed) await cleanup();
        throw error;
      }
    },
    async updateDraft({ workspaceId, id, revision, changes, internalWarnings = null }) { const current = await getDraft({ workspaceId, id }); if (!current) throw listingError(404, "Listing draft not found."); if (Number(revision) !== current.revision) throw listingError(409, "This draft changed. Reload it and try again."); const normalized = normalizeListingChanges(changes, current.images); const next = applyListingChanges(current, normalized); const { data: applied, error } = await supabase.rpc("update_listing_draft_atomic_v2", { p_workspace_id: workspaceId, p_draft_id: id, p_revision: current.revision, p_title: next.title, p_description: next.description, p_bullets: next.bullets, p_base_price_cents: next.basePriceCents, p_copy_approved: next.copyApproved, p_amazon_production_details: next.amazonProductionDetails || {}, p_images: normalized.images ? next.images.map(({ id: imageId, selected, main, approved }) => ({ id: imageId, selected, main, approved })) : null, p_warnings: internalWarnings }); if (error) throw error; if (!applied) throw listingError(409, "This draft changed. Reload it and try again."); return getDraft({ workspaceId, id }); },
    async prepareAsset({ workspaceId, draftId, revision, imageId, prepare }) { const draft = await getDraft({ workspaceId, id: draftId }); if (!draft) throw listingError(404, "Listing draft not found."); if (Number(revision) !== draft.revision) throw listingError(409, "This draft changed. Reload it and try again."); const { data: source, error: sourceError } = await supabase.from("listing_assets").select("*").eq("workspace_id", workspaceId).eq("draft_id", draftId).eq("id", imageId).maybeSingle(); if (sourceError) throw sourceError; if (!source) throw listingError(404, "Listing image not found."); const { data: downloaded, error: downloadError } = await supabase.storage.from(source.storage_bucket).download(source.storage_path); if (downloadError) throw downloadError; const prepared = await prepare({ bytes: Buffer.from(await downloaded.arrayBuffer()), mimeType: source.mime_type }); const image = validateRasterBytes({ bytes: prepared.bytes, mimeType: prepared.mimeType }); const id = randomUUID(), storagePath = listingAssetPath({ workspaceId, draftId, extension: image.extension, id }); const { error: uploadError } = await supabase.storage.from(LISTING_ASSET_BUCKET).upload(storagePath, image.bytes, { contentType: image.mimeType, cacheControl: "31536000", upsert: false }); if (uploadError) throw uploadError; const { data: added, error: assetError } = await supabase.rpc("add_listing_asset_atomic", { p_workspace_id: workspaceId, p_draft_id: draftId, p_revision: revision, p_asset: { id, kind: "prepared", sourceUrl: "", storageBucket: LISTING_ASSET_BUCKET, storagePath, mimeType: image.mimeType, byteSize: image.bytes.length, width: image.width, height: image.height, sourceRank: source.source_rank, alt: source.alt || "", selected: true, main: false } }); if (assetError || !added) { await cleanupUnreferenced([storagePath]); if (assetError) throw assetError; throw listingError(409, "This draft changed. Reload it and try again."); } return getDraft({ workspaceId, id: draftId }); },
    async uploadAsset({ workspaceId, draftId, revision, file }) { const draft = await getDraft({ workspaceId, id: draftId }); if (!draft) throw listingError(404, "Listing draft not found."); if (Number(revision) !== draft.revision) throw listingError(409, "This draft changed. Reload it and try again."); const image = readBase64Raster(file); const id = randomUUID(); const storagePath = listingAssetPath({ workspaceId, draftId, extension: image.extension, id }); const { error: uploadError } = await supabase.storage.from(LISTING_ASSET_BUCKET).upload(storagePath, image.bytes, { contentType: image.mimeType, cacheControl: "31536000", upsert: false }); if (uploadError) throw uploadError; const { data: added, error: assetError } = await supabase.rpc("add_listing_asset_atomic", { p_workspace_id: workspaceId, p_draft_id: draftId, p_revision: revision, p_asset: { id, kind: "uploaded", sourceUrl: "", storageBucket: LISTING_ASSET_BUCKET, storagePath, mimeType: image.mimeType, byteSize: image.bytes.length, width: image.width, height: image.height, sourceRank: draft.images.length, alt: "", selected: true, main: !draft.images.some((item) => item.main) } }); if (assetError || !added) { await cleanupUnreferenced([storagePath]); if (assetError) throw assetError; throw listingError(409, "This draft changed. Reload it and try again."); } return getDraft({ workspaceId, id: draftId }); },
  };
}
export const listingStore = createListingStore;
