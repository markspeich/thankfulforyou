import crypto from "node:crypto";
import { basename, extname } from "node:path";

import { createSupabaseAdminClient } from "./supabase-admin.js";

export const FIXED_DESIGN_STORAGE_BUCKET = "workspace-fixed-designs";
const FIXED_DESIGN_STORAGE_BUCKET_OPTIONS = Object.freeze({
  public: true,
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: [
    "image/svg+xml",
    "text/plain",
    "application/octet-stream",
  ],
});
const SUPPORTED_SVG_CONTENT_TYPES = new Set([
  "",
  "image/svg+xml",
  "text/plain",
  "application/octet-stream",
]);

export function createFixedDesignStoreError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true,
  });
}

export function normalizeFixedDesignStoreError(error, { displayName = "" } = {}) {
  const constraintText = [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === "string")
    .join(" ");
  const isActiveNameConflict = error?.code === "23505"
    && /fixed_designs_workspace_active_name_uidx/i.test(constraintText);

  if (!isActiveNameConflict) {
    return error;
  }

  return createFixedDesignStoreError(
    409,
    `A fixed design named "${String(displayName).trim()}" already exists. Select it and use Load New Version to replace its SVG.`,
  );
}

function cleanPathPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function stripSvgPreamble(svgText) {
  let remaining = String(svgText || "").trim().replace(/^\uFEFF/, "");
  let changed = true;
  while (changed) {
    const next = remaining
      .replace(/^<\?xml[\s\S]*?\?>\s*/i, "")
      .replace(/^<!--[\s\S]*?-->\s*/, "")
      .replace(/^<!doctype[\s\S]*?>\s*/i, "");
    changed = next !== remaining;
    remaining = next.trimStart();
  }
  return remaining;
}

function readUploadedSvgBodySync(file) {
  if (typeof file?.text === "string") {
    return Buffer.from(file.text, "utf8");
  }
  if (Array.isArray(file?.buffer)) {
    return Buffer.from(file.buffer);
  }
  if (Buffer.isBuffer(file?.buffer)) {
    return file.buffer;
  }
  if (file?.buffer instanceof ArrayBuffer) {
    return Buffer.from(file.buffer);
  }
  if (ArrayBuffer.isView(file?.buffer)) {
    return Buffer.from(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
  }
  return null;
}

async function readUploadedSvgBody(file) {
  const body = readUploadedSvgBodySync(file);
  if (body) {
    return body;
  }
  if (file?.arrayBuffer) {
    return Buffer.from(await file.arrayBuffer());
  }
  if (typeof file?.text === "function") {
    return Buffer.from(await file.text(), "utf8");
  }
  return null;
}

function resolveFixedDesignDisplayName({ displayName = "", fileName = "" }) {
  return String(displayName || fileName.replace(/\.[^.]+$/, "")).trim();
}

export function buildFixedDesignStoragePath({ workspaceId, fixedDesignId, version, fileName }) {
  const safeFileName = cleanPathPart(basename(fileName)) || "fixed-design.svg";
  return `workspaces/${cleanPathPart(workspaceId)}/fixed-designs/${cleanPathPart(fixedDesignId)}/v${Number(version) || 1}/${safeFileName}`;
}

export function validateSvgContent(svgText) {
  const withoutPreamble = stripSvgPreamble(svgText);
  if (!withoutPreamble || !/^<svg(?:\s|>)/i.test(withoutPreamble)) {
    throw createFixedDesignStoreError(400, "Upload a valid SVG file.");
  }
  return true;
}

function parsePositiveNumber(value) {
  const match = String(value || "").trim().match(/^-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractSvgAttribute(svgText, attributeName) {
  const withoutPreamble = stripSvgPreamble(svgText);
  const svgOpenTag = withoutPreamble.match(/^<svg\b[^>]*>/i)?.[0] || "";
  const pattern = new RegExp(`${attributeName}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  return svgOpenTag.match(pattern)?.[2] || null;
}

export function extractSvgMetadata(svgText) {
  const viewBox = extractSvgAttribute(svgText, "viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return {
        viewBox: parts.map((part) => Number.isInteger(part) ? String(part) : String(part)).join(" "),
        aspectRatio: parts[2] / parts[3],
      };
    }
  }

  const width = parsePositiveNumber(extractSvgAttribute(svgText, "width"));
  const height = parsePositiveNumber(extractSvgAttribute(svgText, "height"));
  if (width && height) {
    return {
      width,
      height,
      aspectRatio: width / height,
    };
  }

  return {};
}

export function normalizeSvgUploadFile(file) {
  const fileName = typeof file?.name === "string" ? file.name.trim() : "";
  const fileFormat = extname(fileName).replace(".", "").toLowerCase();
  const contentType = String(file?.type || "").trim().toLowerCase();

  if (!fileName || fileFormat !== "svg" || !SUPPORTED_SVG_CONTENT_TYPES.has(contentType)) {
    throw createFixedDesignStoreError(400, "Unsupported file type. Upload an SVG file.");
  }

  const metadata = typeof file?.text === "string" ? extractSvgMetadata(file.text) : {};
  if (typeof file?.text === "string") {
    validateSvgContent(file.text);
  }

  return {
    fileName,
    fileFormat,
    contentType: contentType || "image/svg+xml",
    size: Number(file?.size) || 0,
    metadata,
  };
}

function normalizeFixedDesignRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    display_name: row.display_name,
    storage_bucket: row.storage_bucket,
    storage_path: row.storage_path,
    public_url: row.public_url,
    file_name: row.file_name,
    version: row.version,
    metadata_json: row.metadata_json,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(FIXED_DESIGN_STORAGE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

function isMissingBucketError(error) {
  if (!error) {
    return false;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return error.statusCode === 404
    || error.status === 404
    || /bucket not found|not found/i.test(message);
}

function isExistingBucketError(error) {
  if (!error) {
    return false;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return error.statusCode === 409
    || error.status === 409
    || /already exists|duplicate/i.test(message);
}

export async function ensureFixedDesignStorageBucket(supabase) {
  const { error: getBucketError } = await supabase.storage.getBucket(FIXED_DESIGN_STORAGE_BUCKET);
  if (!getBucketError) {
    return;
  }

  if (!isMissingBucketError(getBucketError)) {
    throw getBucketError;
  }

  const { error: createBucketError } = await supabase.storage.createBucket(
    FIXED_DESIGN_STORAGE_BUCKET,
    FIXED_DESIGN_STORAGE_BUCKET_OPTIONS,
  );
  if (createBucketError && !isExistingBucketError(createBucketError)) {
    throw createBucketError;
  }
}

async function uploadFixedDesignObject(supabase, storagePath, file, contentType) {
  const body = await readUploadedSvgBody(file);
  if (!body || !body.length) {
    throw createFixedDesignStoreError(400, "SVG upload must include a non-empty file.");
  }
  validateSvgContent(body.toString("utf8"));

  await ensureFixedDesignStorageBucket(supabase);

  const { error } = await supabase.storage
    .from(FIXED_DESIGN_STORAGE_BUCKET)
    .upload(storagePath, body, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (error) {
    throw error;
  }
}

export async function listWorkspaceFixedDesigns({ workspaceId, includeDeleted = false }) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("fixed_designs")
    .select("id, workspace_id, display_name, storage_bucket, storage_path, public_url, file_name, version, metadata_json, deleted_at, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("display_name", { ascending: true });

  if (!includeDeleted) {
    query = query.is("deleted_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data || []).map(normalizeFixedDesignRow);
}

export async function createWorkspaceFixedDesign({ workspaceId, displayName, file }) {
  const supabase = createSupabaseAdminClient();
  const upload = normalizeSvgUploadFile(file);
  const fixedDesignId = `fixed-design-${crypto.randomUUID()}`;
  const version = 1;
  const resolvedDisplayName = resolveFixedDesignDisplayName({
    displayName,
    fileName: upload.fileName,
  });
  if (!resolvedDisplayName) {
    throw createFixedDesignStoreError(400, "Fixed design display name is required.");
  }

  const storagePath = buildFixedDesignStoragePath({
    workspaceId,
    fixedDesignId,
    version,
    fileName: upload.fileName,
  });
  await uploadFixedDesignObject(supabase, storagePath, file, upload.contentType);
  const publicUrl = await getPublicUrl(supabase, storagePath);

  const row = {
    id: fixedDesignId,
    workspace_id: workspaceId,
    display_name: resolvedDisplayName,
    storage_bucket: FIXED_DESIGN_STORAGE_BUCKET,
    storage_path: storagePath,
    public_url: publicUrl,
    file_name: upload.fileName,
    version,
    metadata_json: upload.metadata,
    deleted_at: null,
  };

  const { data, error } = await supabase
    .from("fixed_designs")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw normalizeFixedDesignStoreError(error, { displayName: resolvedDisplayName });
  }

  return normalizeFixedDesignRow(data);
}

async function getWorkspaceFixedDesignOrThrow(supabase, { workspaceId, fixedDesignId }) {
  const { data, error } = await supabase
    .from("fixed_designs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", fixedDesignId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw createFixedDesignStoreError(404, "Fixed design not found.");
  }
  return data;
}

export async function replaceWorkspaceFixedDesign({ workspaceId, fixedDesignId, file }) {
  const supabase = createSupabaseAdminClient();
  const existing = await getWorkspaceFixedDesignOrThrow(supabase, { workspaceId, fixedDesignId });
  const upload = normalizeSvgUploadFile(file);
  const version = Number(existing.version || 1) + 1;
  const storagePath = buildFixedDesignStoragePath({
    workspaceId,
    fixedDesignId,
    version,
    fileName: upload.fileName,
  });
  await uploadFixedDesignObject(supabase, storagePath, file, upload.contentType);
  const publicUrl = await getPublicUrl(supabase, storagePath);

  const { data, error } = await supabase
    .from("fixed_designs")
    .update({
      storage_bucket: FIXED_DESIGN_STORAGE_BUCKET,
      storage_path: storagePath,
      public_url: publicUrl,
      file_name: upload.fileName,
      version,
      metadata_json: upload.metadata,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", fixedDesignId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFixedDesignRow(data);
}

export async function deleteWorkspaceFixedDesign({ workspaceId, fixedDesignId }) {
  const supabase = createSupabaseAdminClient();
  await getWorkspaceFixedDesignOrThrow(supabase, { workspaceId, fixedDesignId });

  const { data, error } = await supabase
    .from("fixed_designs")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", fixedDesignId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFixedDesignRow(data);
}
