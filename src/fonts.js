import {
  archiveWorkspaceFont,
  createWorkspaceFont,
  fetchWorkspaceFonts,
  replaceWorkspaceFont,
  restoreWorkspaceFont,
  updateWorkspaceFontSettings,
} from "./font-api.js";
import { buildWorkspaceFontFamily } from "./font-identity.js";

const registeredBrowserFontFaces = new Map();

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function url(record) { return text(record.public_url) || text(record.publicUrl) || text(record.url) || text(record.storage_path) || text(record.storagePath); }

export function normalizeFontRecord(record, { includeArchived = false } = {}) {
  if (!record || typeof record !== "object") return null;
  const id = typeof record.id === "string" ? record.id : "";
  const displayName = text(record.display_name) || text(record.displayName) || id;
  const publicUrl = url(record);
  const browserUrl = !publicUrl || /^https?:|^\//i.test(publicUrl) ? publicUrl : `/${publicUrl}`;
  const archivedAt = record.archived_at ?? record.archivedAt ?? record.deleted_at ?? record.deletedAt ?? null;
  if (!id.trim() || !displayName || (archivedAt && !includeArchived)) return null;
  return {
    id, displayName, label: archivedAt ? `${displayName} (archived)` : displayName,
    family: buildWorkspaceFontFamily(id),
    url: browserUrl, exportPath: publicUrl,
    fileFormat: text(record.file_format) || text(record.fileFormat),
    version: Number.isFinite(Number(record.version)) ? Number(record.version) : 1,
    archivedAt, isArchived: Boolean(archivedAt),
    bridgingEnabled: typeof (record.bridging_enabled ?? record.bridgingEnabled) === "boolean"
      ? (record.bridging_enabled ?? record.bridgingEnabled) : true,
  };
}

export function buildFontOptions(records = [], { includeArchived = false } = {}) {
  return records.map((record) => normalizeFontRecord(record, { includeArchived })).filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getSelectableFontOptions(fontOptions = [], selectedFontId = "") {
  const active = fontOptions.filter((font) => !font.isArchived);
  const selected = fontOptions.find((font) => font.id === selectedFontId);
  if (selected?.isArchived) return [...active, selected];
  if (selectedFontId && !selected) return [...active, { id: selectedFontId, label: `Missing font (${selectedFontId})`, isMissing: true, isArchived: true }];
  return active;
}

export function getFontLibraryOptions(fontOptions = [], { showArchived = false } = {}) {
  return showArchived ? fontOptions : fontOptions.filter((font) => !font.isArchived);
}

export function resolveFontOption(fontId, fontOptions = []) {
  return fontOptions.find((font) => font.id === fontId) || { id: fontId, label: `Missing font (${fontId})`, isMissing: true, family: "", url: "", exportPath: "" };
}

export function getFontRenderingIssue(settings = {}, fontOptions = []) {
  const rawLines = typeof settings.text === "string" ? settings.text.split(/\r?\n/) : [];
  let textLineIndex = 0;

  for (const line of Array.isArray(settings.lines) ? settings.lines : []) {
    if (line?.kind === "fixedSvg") {
      continue;
    }

    const rawLine = rawLines[textLineIndex] || "";
    textLineIndex += 1;
    if (!rawLine.trim()) {
      continue;
    }

    const fontId = typeof line?.fontId === "string" ? line.fontId : "";
    const font = resolveFontOption(fontId, fontOptions);
    if (font.isMissing) {
      return { fontId, label: font.label, reason: "missing" };
    }
    if (font.loadError) {
      return { fontId, label: font.displayName || font.label || fontId, reason: "load-failed", detail: font.loadError };
    }
    if (!font.family || !font.url || !font.exportPath) {
      return { fontId, label: font.displayName || font.label || fontId, reason: "unresolvable" };
    }
  }

  return null;
}

export async function registerBrowserFont(font) {
  if (!font?.family || !font?.url) throw new Error(`Font ${font?.label || font?.id || "asset"} has no resolvable asset.`);
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    throw new Error(`The browser cannot register ${font.label || font.id}.`);
  }
  const registrationKey = font.id || font.family;
  const previous = registeredBrowserFontFaces.get(registrationKey);
  if (previous && typeof document.fonts.delete === "function") document.fonts.delete(previous);
  const face = new FontFace(font.family, `url("${font.url}")`);
  await face.load();
  document.fonts.add(face);
  registeredBrowserFontFaces.set(registrationKey, face);
  return face;
}

export async function registerBrowserFonts(fontOptions) {
  return Promise.allSettled(fontOptions.map(registerBrowserFont));
}

export async function loadWorkspaceFontOptions(options = {}) {
  return buildFontOptions(await fetchWorkspaceFonts(options), { includeArchived: Boolean(options.includeArchived) });
}

export { archiveWorkspaceFont, createWorkspaceFont, replaceWorkspaceFont, restoreWorkspaceFont, updateWorkspaceFontSettings };
