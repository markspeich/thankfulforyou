function normalizeMetadata(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeVersion(value) {
  const version = Number.parseInt(value, 10);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function buildState(deletedAt) {
  return deletedAt ? { state: "deleted", stateLabel: "Deleted" } : { state: "active", stateLabel: "Available" };
}

export function normalizeFixedDesignRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = normalizeString(record.id);
  const displayName = normalizeString(record.display_name ?? record.displayName);
  const publicUrl = normalizeString(record.public_url ?? record.publicUrl);
  if (!id || !displayName) {
    return null;
  }

  const deletedAt = record.deleted_at ?? record.deletedAt ?? null;
  const state = buildState(deletedAt);

  return {
    id,
    workspaceId: record.workspace_id ?? record.workspaceId ?? null,
    displayName,
    storageBucket: record.storage_bucket ?? record.storageBucket ?? null,
    storagePath: record.storage_path ?? record.storagePath ?? null,
    publicUrl: publicUrl || null,
    fileName: record.file_name ?? record.fileName ?? null,
    version: normalizeVersion(record.version),
    metadata: normalizeMetadata(record.metadata_json ?? record.metadata),
    deletedAt,
    createdAt: record.created_at ?? record.createdAt ?? null,
    updatedAt: record.updated_at ?? record.updatedAt ?? null,
    isDeleted: Boolean(deletedAt),
    ...state,
  };
}

export function normalizeFixedDesignRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeFixedDesignRecord)
    .filter(Boolean);
}

export function settingsNeedFixedDesignRecords(settings = {}, { recordsLoaded = false } = {}) {
  if (recordsLoaded) {
    return false;
  }

  return Array.isArray(settings?.lines)
    && settings.lines.some((line) => line?.kind === "fixedSvg" && normalizeString(line.fixedDesignId));
}

export function resolveFixedDesignReference(lineSettings, records = []) {
  const fixedDesignId = normalizeString(lineSettings?.fixedDesignId);
  const fixedDesign = records.find((record) => record.id === fixedDesignId);
  if (fixedDesign) {
    return fixedDesign;
  }

  return {
    id: fixedDesignId,
    displayName: normalizeString(lineSettings?.fixedDesignName, fixedDesignId || "Fixed design"),
    version: normalizeVersion(lineSettings?.fixedDesignVersion),
    publicUrl: null,
    isDeleted: false,
    state: "missing",
    stateLabel: "Missing",
  };
}
