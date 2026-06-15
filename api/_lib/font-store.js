import crypto from "node:crypto";
import { basename, extname } from "node:path";
import zlib from "node:zlib";

import { createSupabaseAdminClient } from "./supabase-admin.js";

export const FONT_STORAGE_BUCKET = "workspace-fonts";
const FONT_STORAGE_BUCKET_OPTIONS = Object.freeze({
  public: true,
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: [
    "font/otf",
    "font/ttf",
    "font/woff",
    "font/woff2",
    "application/font-sfnt",
    "application/octet-stream",
  ],
});
const SUPPORTED_FONT_EXTENSIONS = new Set(["otf", "ttf", "woff", "woff2"]);
const ORIGINAL_PRODUCTION_FONT_IDS = new Set(["candlepin", "skywalk", "somekind"]);
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

function readUploadedFontBodySync(file) {
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

async function readUploadedFontBody(file) {
  const body = readUploadedFontBodySync(file);
  if (body) {
    return body;
  }
  if (file?.arrayBuffer) {
    return Buffer.from(await file.arrayBuffer());
  }
  return null;
}

function decodeFontName(bytes, platformId) {
  if (platformId === 0 || platformId === 3) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/\0/g, "").trim();
  }
  return new TextDecoder("latin1").decode(bytes).replace(/\0/g, "").trim();
}

function getSfntTable(fontBuffer, tableTag) {
  if (!Buffer.isBuffer(fontBuffer) || fontBuffer.length < 12) {
    return null;
  }

  const signature = fontBuffer.toString("ascii", 0, 4);
  if (signature === "wOFF") {
    const tableCount = fontBuffer.readUInt16BE(12);
    for (let index = 0; index < tableCount; index += 1) {
      const recordOffset = 44 + index * 20;
      if (recordOffset + 20 > fontBuffer.length) {
        return null;
      }
      const tag = fontBuffer.toString("ascii", recordOffset, recordOffset + 4);
      if (tag !== tableTag) {
        continue;
      }
      const offset = fontBuffer.readUInt32BE(recordOffset + 4);
      const compressedLength = fontBuffer.readUInt32BE(recordOffset + 8);
      const originalLength = fontBuffer.readUInt32BE(recordOffset + 12);
      if (offset + compressedLength > fontBuffer.length) {
        return null;
      }
      const table = fontBuffer.subarray(offset, offset + compressedLength);
      return compressedLength === originalLength ? table : zlib.inflateSync(table);
    }
    return null;
  }

  const tableCount = fontBuffer.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > fontBuffer.length) {
      return null;
    }
    const tag = fontBuffer.toString("ascii", recordOffset, recordOffset + 4);
    if (tag !== tableTag) {
      continue;
    }
    const offset = fontBuffer.readUInt32BE(recordOffset + 8);
    const length = fontBuffer.readUInt32BE(recordOffset + 12);
    if (offset + length > fontBuffer.length) {
      return null;
    }
    return fontBuffer.subarray(offset, offset + length);
  }
  return null;
}

function scoreNameRecord(record) {
  let score = 0;
  if (record.nameId === 4) {
    score += 40;
  } else if (record.nameId === 16) {
    score += 35;
  } else if (record.nameId === 1) {
    score += 30;
  }
  if (record.platformId === 3) {
    score += 8;
  } else if (record.platformId === 0) {
    score += 6;
  } else if (record.platformId === 1) {
    score += 4;
  }
  if (record.languageId === 0x0409 || record.languageId === 0) {
    score += 3;
  }
  return score;
}

export function readFontDisplayName(file) {
  try {
    const fontBuffer = readUploadedFontBodySync(file);
    const nameTable = getSfntTable(fontBuffer, "name");
    if (!nameTable || nameTable.length < 6) {
      return "";
    }

    const count = nameTable.readUInt16BE(2);
    const storageOffset = nameTable.readUInt16BE(4);
    const candidates = [];
    for (let index = 0; index < count; index += 1) {
      const recordOffset = 6 + index * 12;
      if (recordOffset + 12 > nameTable.length) {
        break;
      }
      const platformId = nameTable.readUInt16BE(recordOffset);
      const languageId = nameTable.readUInt16BE(recordOffset + 4);
      const nameId = nameTable.readUInt16BE(recordOffset + 6);
      const length = nameTable.readUInt16BE(recordOffset + 8);
      const offset = nameTable.readUInt16BE(recordOffset + 10);
      if (![1, 4, 16].includes(nameId)) {
        continue;
      }
      const start = storageOffset + offset;
      const end = start + length;
      if (start < storageOffset || end > nameTable.length) {
        continue;
      }
      const text = decodeFontName(nameTable.subarray(start, end), platformId);
      if (text) {
        candidates.push({ text, nameId, platformId, languageId });
      }
    }

    candidates.sort((left, right) => scoreNameRecord(right) - scoreNameRecord(left));
    return candidates[0]?.text || "";
  } catch {
    return "";
  }
}

export function resolveUploadedFontDisplayName({ file, fallbackDisplayName = "" }) {
  const fontDisplayName = readFontDisplayName(file);
  const fileName = typeof file?.name === "string" ? file.name.replace(/\.[^.]+$/, "") : "";
  return String(fontDisplayName || fallbackDisplayName || fileName).trim();
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

export function rejectMissingFontReplacement(font) {
  if (!font) {
    throw createFontStoreError(404, "Font not found.");
  }
}

export function rejectBuiltinFontDeletion(font) {
  if (font?.is_builtin || font?.isBuiltin || ORIGINAL_PRODUCTION_FONT_IDS.has(font?.id)) {
    throw createFontStoreError(400, "Original production fonts cannot be deleted.");
  }
}

export function normalizeFontRow(row) {
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
    bridging_enabled: typeof row.bridging_enabled === "boolean" ? row.bridging_enabled : true,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(FONT_STORAGE_BUCKET).getPublicUrl(storagePath);
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

export async function ensureFontStorageBucket(supabase) {
  const { error: getBucketError } = await supabase.storage.getBucket(FONT_STORAGE_BUCKET);
  if (!getBucketError) {
    return;
  }

  if (!isMissingBucketError(getBucketError)) {
    throw getBucketError;
  }

  const { error: createBucketError } = await supabase.storage.createBucket(
    FONT_STORAGE_BUCKET,
    FONT_STORAGE_BUCKET_OPTIONS,
  );
  if (createBucketError && !isExistingBucketError(createBucketError)) {
    throw createBucketError;
  }
}

async function uploadFontObject(supabase, storagePath, file, contentType) {
  const body = await readUploadedFontBody(file);
  if (!body || !body.length) {
    throw createFontStoreError(400, "Font upload must include a non-empty file.");
  }

  await ensureFontStorageBucket(supabase);

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
    .select("id, workspace_id, display_name, family_name, storage_bucket, storage_path, public_url, file_name, file_format, version, is_builtin, bridging_enabled, deleted_at, created_at, updated_at")
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
  const resolvedDisplayName = resolveUploadedFontDisplayName({
    file,
    fallbackDisplayName: displayName || upload.fileName.replace(/\.[^.]+$/, ""),
  });
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
    bridging_enabled: true,
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
    rejectMissingFontReplacement(data);
  }
  return data;
}

export async function replaceWorkspaceFont({ workspaceId, fontId, file }) {
  const supabase = createSupabaseAdminClient();
  const existing = await getWorkspaceFontOrThrow(supabase, { workspaceId, fontId });
  rejectMissingFontReplacement(existing);

  const upload = normalizeUploadedFontFile(file);
  const version = Number(existing.version || 1) + 1;
  const resolvedDisplayName = resolveUploadedFontDisplayName({
    file,
    fallbackDisplayName: existing.display_name,
  });
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
      display_name: resolvedDisplayName,
      family_name: inferFamilyName(resolvedDisplayName, fontId),
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

export async function updateWorkspaceFontSettings({ workspaceId, fontId, bridgingEnabled }) {
  const supabase = createSupabaseAdminClient();
  await getWorkspaceFontOrThrow(supabase, { workspaceId, fontId });

  const { data, error } = await supabase
    .from("fonts")
    .update({
      bridging_enabled: Boolean(bridgingEnabled),
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
  rejectBuiltinFontDeletion(existing);

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
