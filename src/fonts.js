import {
  createWorkspaceFont,
  deleteWorkspaceFont,
  fetchWorkspaceFonts,
  replaceWorkspaceFont,
} from "./font-api.js";

export const BUILTIN_FONT_DEFINITIONS = Object.freeze([
  {
    id: "candlepin",
    label: "Candlepin Laser",
    family: "CandlepinLaser",
    url: "public/fonts/Candlepin-Laser.otf",
    exportPath: "public/fonts/Candlepin-Laser.otf",
    fileFormat: "otf",
    version: 1,
    isBuiltin: true,
  },
  {
    id: "skywalk",
    label: "Skywalk Laser",
    family: "SkywalkLaser",
    url: "public/fonts/SkywalkLaserRegular.otf",
    exportPath: "public/fonts/SkywalkLaserRegular.otf",
    fileFormat: "otf",
    version: 1,
    isBuiltin: true,
  },
  {
    id: "somekind",
    label: "Somekind",
    family: "Somekind",
    url: "public/fonts/Somekind.ttf",
    exportPath: "public/fonts/Somekind.ttf",
    fileFormat: "ttf",
    version: 1,
    isBuiltin: true,
  },
]);

const DEFAULT_FONT = BUILTIN_FONT_DEFINITIONS[0];
const registeredBrowserFontFaces = new Map();

function toTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildUploadedFamilyName(record) {
  const familyName = toTrimmedString(record.family_name) || toTrimmedString(record.familyName);
  if (familyName) {
    return familyName;
  }
  return `WorkspaceFont_${toTrimmedString(record.id).replace(/[^a-z0-9_-]/gi, "_")}`;
}

function buildUploadedUrl(record) {
  return toTrimmedString(record.public_url)
    || toTrimmedString(record.publicUrl)
    || toTrimmedString(record.url)
    || toTrimmedString(record.storage_path)
    || toTrimmedString(record.storagePath);
}

export function normalizeFontRecord(record, { includeDeleted = false } = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = toTrimmedString(record.id);
  const label = toTrimmedString(record.display_name) || toTrimmedString(record.displayName) || id;
  const url = buildUploadedUrl(record);
  const deletedAt = record.deleted_at ?? record.deletedAt ?? null;
  if (!id || !label || !url || (deletedAt && !includeDeleted)) {
    return null;
  }

  const isDeleted = Boolean(deletedAt);
  const version = Number.isFinite(Number(record.version)) ? Number(record.version) : 1;

  return {
    id,
    label: isDeleted ? `${label} (deleted)` : label,
    displayName: label,
    family: buildUploadedFamilyName({ ...record, id }),
    url,
    exportPath: url,
    fileFormat: toTrimmedString(record.file_format) || toTrimmedString(record.fileFormat),
    version,
    isBuiltin: Boolean(record.is_builtin ?? record.isBuiltin),
    isUploaded: !record.is_builtin && !record.isBuiltin,
    isDeleted,
    deletedAt,
  };
}

export function buildFontOptions(fontRecords = [], { includeDeleted = false } = {}) {
  const uploadedOptions = fontRecords
    .map((record) => normalizeFontRecord(record, { includeDeleted }))
    .filter(Boolean)
    .filter((font) => !BUILTIN_FONT_DEFINITIONS.some((builtin) => builtin.id === font.id));

  return [
    ...BUILTIN_FONT_DEFINITIONS,
    ...uploadedOptions,
  ];
}

export function resolveFontOption(fontId, fontOptions = BUILTIN_FONT_DEFINITIONS) {
  return fontOptions.find((font) => font.id === fontId) || DEFAULT_FONT;
}

export async function registerBrowserFont(font) {
  if (!font || !font.family || !font.url || typeof FontFace === "undefined" || !document?.fonts) {
    return null;
  }

  const existingFace = registeredBrowserFontFaces.get(font.family);
  if (existingFace && typeof document.fonts.delete === "function") {
    document.fonts.delete(existingFace);
  }

  const face = new FontFace(font.family, `url("${font.url}")`);
  await face.load();
  document.fonts.add(face);
  registeredBrowserFontFaces.set(font.family, face);
  return face;
}

export async function registerBrowserFonts(fontOptions) {
  return Promise.allSettled(
    fontOptions.map((font) => registerBrowserFont(font)),
  );
}

export async function loadWorkspaceFontOptions(options = {}) {
  const records = await fetchWorkspaceFonts(options);
  return buildFontOptions(records, { includeDeleted: Boolean(options.includeDeleted) });
}

export {
  createWorkspaceFont,
  deleteWorkspaceFont,
  replaceWorkspaceFont,
};
