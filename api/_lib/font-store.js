import crypto from "node:crypto";
import { basename, extname } from "node:path";

import { createSupabaseAdminClient } from "./supabase-admin.js";

export const FONT_STORAGE_BUCKET = "workspace-fonts";
const SUPPORTED_FONT_EXTENSIONS = new Set(["otf", "ttf", "woff", "woff2"]);
const CONTENT_TYPE_BY_FORMAT = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function createFontStoreError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true,
  });
}

function cleanPathPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function inferFamilyName(displayName, fontId) {
  const base = cleanPathPart(displayName).replace(/[-.]+/g, "_");
  return `WorkspaceFont_${base || fontId}`;
}

export function buildFontStoragePath({ workspaceId, fontId, version, fileName }) {
  const safeFileName = cleanPathPart(basename(fileName)) || `font.${extname(fileName).replace(".", "") || "otf"}`;
  return `workspaces/${cleanPathPart(workspaceId)}/fonts/${cleanPathPart(fontId)}/v${Number(version) || 1}/${safeFileName}`;
}

export function normalizeUploadedFontFile(file) {
  const fileName = typeof file?.name === "string" ? file.name.trim() : "";
  const fileFormat = extname(fileName).replace(".", "").toLowerCase();

  if (!fileName || !SUPPORTED_FONT_EXTENSIONS.has(fileFormat)) {
    throw createFontStoreError(400, "Unsupported font file type. Upload an OTF, TTF, WOFF, or WOFF2 file.");
  }

  return {
    fileName,
    fileFormat,
    contentType: CONTENT_TYPE_BY_FORMAT[fileFormat],
    size: Number(file?.size) || 0,
  };
}

export function rejectBuiltinFontMutation(font) {
  if (font?.is_builtin || font?.isBuiltin) {
    throw createFontStoreError(400, "Built-in fonts cannot be deleted or replaced.");
  }
}

function normalizeFontRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    display_name: row.display_name,
    family_name: row.family_name,
    storage_bucket: row.storage_bucket,
    storage_path: row.storage_path,
    public_url: row.public_url,
    file_name: row.file_name,
    file_format: row.file_format,
    version: row.version,
    is_builtin: row.is_builtin,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(FONT_STORAGE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

async function uploadFontObject(supabase, storagePath, file, contentType) {
  const body = file?.arrayBuffer
    ? Buffer.from(await file.arrayBuffer())
    : Array.isArray(file?.buffer)
      ? Buffer.from(file.buffer)
      : file?.buffer;
  if (!body || !body.length) {
    throw createFontStoreError(400, "Font upload must include a non-empty file.");
  }

  const { error } = await supabase.storage
    .from(FONT_STORAGE_BUCKET)
    .upload(storagePath, body, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (error) {
    throw error;
  }
}

export async function listWorkspaceFonts({ workspaceId, includeDeleted = false }) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("fonts")
    .select("id, workspace_id, display_name, family_name, storage_bucket, storage_path, public_url, file_name, file_format, version, is_builtin, deleted_at, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("is_builtin", { ascending: false })
    .order("display_name", { ascending: true });

  if (!includeDeleted) {
    query = query.is("deleted_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data || []).map(normalizeFontRow);
}

export async function createWorkspaceFont({ workspaceId, displayName, file }) {
  const supabase = createSupabaseAdminClient();
  const upload = normalizeUploadedFontFile(file);
  const fontId = `font-${crypto.randomUUID()}`;
  const version = 1;
  const resolvedDisplayName = String(displayName || upload.fileName.replace(/\.[^.]+$/, "")).trim();
  if (!resolvedDisplayName) {
    throw createFontStoreError(400, "Font display name is required.");
  }

  const storagePath = buildFontStoragePath({
    workspaceId,
    fontId,
    version,
    fileName: upload.fileName,
  });
  await uploadFontObject(supabase, storagePath, file, upload.contentType);
  const publicUrl = await getPublicUrl(supabase, storagePath);

  const row = {
    id: fontId,
    workspace_id: workspaceId,
    display_name: resolvedDisplayName,
    family_name: inferFamilyName(resolvedDisplayName, fontId),
    storage_bucket: FONT_STORAGE_BUCKET,
    storage_path: storagePath,
    public_url: publicUrl,
    file_name: upload.fileName,
    file_format: upload.fileFormat,
    version,
    is_builtin: false,
    deleted_at: null,
  };

  const { data, error } = await supabase
    .from("fonts")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFontRow(data);
}

async function getWorkspaceFontOrThrow(supabase, { workspaceId, fontId }) {
  const { data, error } = await supabase
    .from("fonts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", fontId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw createFontStoreError(404, "Font not found.");
  }
  return data;
}

export async function replaceWorkspaceFont({ workspaceId, fontId, file }) {
  const supabase = createSupabaseAdminClient();
  const existing = await getWorkspaceFontOrThrow(supabase, { workspaceId, fontId });
  rejectBuiltinFontMutation(existing);

  const upload = normalizeUploadedFontFile(file);
  const version = Number(existing.version || 1) + 1;
  const storagePath = buildFontStoragePath({
    workspaceId,
    fontId,
    version,
    fileName: upload.fileName,
  });
  await uploadFontObject(supabase, storagePath, file, upload.contentType);
  const publicUrl = await getPublicUrl(supabase, storagePath);

  const { data, error } = await supabase
    .from("fonts")
    .update({
      storage_bucket: FONT_STORAGE_BUCKET,
      storage_path: storagePath,
      public_url: publicUrl,
      file_name: upload.fileName,
      file_format: upload.fileFormat,
      version,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", fontId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFontRow(data);
}

export async function deleteWorkspaceFont({ workspaceId, fontId }) {
  const supabase = createSupabaseAdminClient();
  const existing = await getWorkspaceFontOrThrow(supabase, { workspaceId, fontId });
  rejectBuiltinFontMutation(existing);

  const { data, error } = await supabase
    .from("fonts")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", fontId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return normalizeFontRow(data);
}
