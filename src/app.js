import {
  DEFAULT_BACKING_MM,
  DESIGN_BLEED_MM,
  PREVIEW_BOX_HEIGHT_MM,
  PREVIEW_BOX_WIDTH_MM,
  PREVIEW_LABEL_RIGHT_MM,
  PREVIEW_MARGIN_MM,
  PX_PER_MM,
  buildScaledTextBounds,
  computePreviewFrame,
  computeTextFitScale,
  measureLineBounds,
} from "./layout-math.js";
import {
  buildPresetLines,
  DEFAULT_PRESET_ID,
  getPresetFontIdForLine,
  getPresetIdForListingId,
  hasPresetMappingForListingId,
  PRESET_OPTIONS,
} from "./presets.js";

const FONT_OPTIONS = [
  {
    id: "candlepin",
    label: "Candlepin Laser",
    family: "CandlepinLaser",
    url: "public/fonts/Candlepin-Laser.otf",
    exportPath: "public/fonts/Candlepin-Laser.otf",
  },
  {
    id: "skywalk",
    label: "Skywalk Laser",
    family: "SkywalkLaser",
    url: "public/fonts/SkywalkLaserRegular.otf",
    exportPath: "public/fonts/SkywalkLaserRegular.otf",
  },
  {
    id: "somekind",
    label: "Somekind",
    family: "Somekind",
    url: "public/fonts/Somekind.ttf",
    exportPath: "public/fonts/Somekind.ttf",
  },
];

const FONT_BY_ID = new Map(FONT_OPTIONS.map((font) => [font.id, font]));
const DEFAULT_PREVIEW_WIDTH_MM = PREVIEW_BOX_WIDTH_MM + PREVIEW_MARGIN_MM * 2 + PREVIEW_LABEL_RIGHT_MM;
const DEFAULT_PREVIEW_HEIGHT_MM = PREVIEW_BOX_HEIGHT_MM + PREVIEW_MARGIN_MM * 2;
const PREVIEW_CENTER_CIRCLE_DIAMETER_MM = 1.25 * 25.4;
const DEFAULT_ZOOM = 3;
const DEFAULT_WELD_EXPORTED_DESIGN = true;
const DEFAULT_LINE_SETTINGS = Object.freeze({
  fontId: "candlepin",
  bridgeMm: 0.5,
  lineBridgeMm: 0.5,
  offsetXMm: 0,
  fontSizeMm: 34,
});

const addOrderButton = document.querySelector("#addOrderButton");
const importClipboardButton = document.querySelector("#importClipboardButton");
const clearQueueButton = document.querySelector("#clearQueueButton");
const importStatus = document.querySelector("#importStatus");
const exportCompletedButton = document.querySelector("#exportCompletedButton");
const orderSearchInput = document.querySelector("#orderSearchInput");
const orderCountOutput = document.querySelector("#orderCountOutput");
const completeCountOutput = document.querySelector("#completeCountOutput");
const progressCountOutput = document.querySelector("#progressCountOutput");
const notStartedCountOutput = document.querySelector("#notStartedCountOutput");
const orderList = document.querySelector("#orderList");
const activeOrderName = document.querySelector("#activeOrderName");
const activeOrderMeta = document.querySelector("#activeOrderMeta");
const editorPanel = document.querySelector(".editor-panel");
const listingReferenceCard = document.querySelector("#listingReferenceCard");
const listingReferenceTitle = document.querySelector("#listingReferenceTitle");
const listingReferenceImage = document.querySelector("#listingReferenceImage");
const textInput = document.querySelector("#textInput");
const presetInput = document.querySelector("#presetInput");
const weldExportedDesignInput = document.querySelector("#weldExportedDesignInput");
const lineControls = document.querySelector("#lineControls");
const backingInput = document.querySelector("#backingInput");
const backingOutput = document.querySelector("#backingOutput");
const preview = document.querySelector("#preview");
const previewPanel = document.querySelector(".preview-panel");
const connectionStatus = document.querySelector("#connectionStatus");
const connectionStatusLabel = document.querySelector("#connectionStatusLabel");
const connectionStatusDetail = document.querySelector("#connectionStatusDetail");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomResetButton = document.querySelector("#zoomResetButton");
const zoomOutput = document.querySelector("#zoomOutput");
const downloadButton = document.querySelector("#downloadButton");
const captureButton = document.querySelector("#captureButton");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const MASK_SCALE = 3;
const MASK_PADDING_PX = 12;
let lastLayout = null;
let zoom = DEFAULT_ZOOM;
let orderSequence = 1;
let activeOrderId = null;
const orders = [];
const pendingAnalysisTimersByOrderId = new Map();
const pendingAnalysisKeysByOrderId = new Map();
const inFlightAnalysisKeys = new Set();
const analysisPromisesByJobKey = new Map();

const statusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  captured: "Saved",
  exported: "Exported",
};
const IMPORT_SOURCE_TAG = "thankfulforyou-etsy-clipboard";
const IMPORT_MOJIBAKE_PATTERN = /[ÂÃâ]/;
const STORAGE_KEY = "thankfulforyou.designQueue";
const STORAGE_VERSION = 1;

function getFontOption(fontId) {
  return FONT_BY_ID.get(fontId) || FONT_OPTIONS[0];
}

function getCanvasFont(fontSizePx, fontId) {
  return `${fontSizePx}px "${getFontOption(fontId).family}", "Segoe Script", cursive`;
}

function createDefaultLineSettings() {
  return {
    fontId: DEFAULT_LINE_SETTINGS.fontId,
    bridgeMm: DEFAULT_LINE_SETTINGS.bridgeMm,
    lineBridgeMm: DEFAULT_LINE_SETTINGS.lineBridgeMm,
    offsetXMm: DEFAULT_LINE_SETTINGS.offsetXMm,
    fontSizeMm: DEFAULT_LINE_SETTINGS.fontSizeMm,
  };
}

function createPresetLineSettings(presetId, lineIndex, options = {}) {
  const { listingId = null } = options;
  return {
    ...createDefaultLineSettings(),
    ...buildPresetLines(presetId, lineIndex + 1, createDefaultLineSettings, { listingId })[lineIndex],
    fontId: getPresetFontIdForLine(presetId, lineIndex),
  };
}

function isValidOrderStatus(status) {
  return Object.hasOwn(statusLabels, status);
}

function getRawTextLines(text) {
  if (!text.length) {
    return [];
  }

  return text.split(/\r?\n/);
}

function normalizeLineSettings(lineSettings = {}) {
  return {
    fontId: FONT_BY_ID.has(lineSettings.fontId) ? lineSettings.fontId : DEFAULT_LINE_SETTINGS.fontId,
    bridgeMm: Number.isFinite(Number(lineSettings.bridgeMm)) ? Number(lineSettings.bridgeMm) : DEFAULT_LINE_SETTINGS.bridgeMm,
    lineBridgeMm: Number.isFinite(Number(lineSettings.lineBridgeMm)) ? Number(lineSettings.lineBridgeMm) : DEFAULT_LINE_SETTINGS.lineBridgeMm,
    offsetXMm: Number.isFinite(Number(lineSettings.offsetXMm)) ? Number(lineSettings.offsetXMm) : DEFAULT_LINE_SETTINGS.offsetXMm,
    fontSizeMm: Number.isFinite(Number(lineSettings.fontSizeMm)) ? Number(lineSettings.fontSizeMm) : DEFAULT_LINE_SETTINGS.fontSizeMm,
  };
}

function normalizeSettings(settings = {}) {
  const text = typeof settings.text === "string" ? settings.text : "";
  const rawLines = getRawTextLines(text);
  const presetId = PRESET_OPTIONS.some((preset) => preset.id === settings.presetId)
    ? settings.presetId
    : DEFAULT_PRESET_ID;
  const legacyLines = Array.isArray(settings.lines)
    ? settings.lines
    : rawLines.map(() => ({
        fontId: DEFAULT_LINE_SETTINGS.fontId,
        bridgeMm: settings.bridgeMm,
        lineBridgeMm: settings.lineBridgeMm,
        offsetXMm: settings.offsetXMm,
        fontSizeMm: settings.fontSizeMm,
      }));

  return {
    text,
    presetId,
    backingMm: Number.isFinite(Number(settings.backingMm)) ? Number(settings.backingMm) : DEFAULT_BACKING_MM,
    weldExportedDesign: typeof settings.weldExportedDesign === "boolean"
      ? settings.weldExportedDesign
      : DEFAULT_WELD_EXPORTED_DESIGN,
    lines: rawLines.map((_, index) => normalizeLineSettings(legacyLines[index] || createPresetLineSettings(presetId, index))),
  };
}

function buildSettingsSignature(settings) {
  const normalized = normalizeSettings(settings);
  return JSON.stringify({
    text: normalized.text,
    presetId: normalized.presetId,
    backingMm: normalized.backingMm,
    weldExportedDesign: normalized.weldExportedDesign,
    lines: normalized.lines.map((line) => ({
      fontId: line.fontId,
      bridgeMm: Number(line.bridgeMm),
      lineBridgeMm: Number(line.lineBridgeMm),
      offsetXMm: Number(line.offsetXMm),
      fontSizeMm: Number(line.fontSizeMm),
    })),
  });
}

function normalizeStoredCachedBuild(cachedBuild) {
  if (!cachedBuild || typeof cachedBuild !== "object") {
    return null;
  }

  const { signature, layout, analysis } = cachedBuild;
  if (
    typeof signature !== "string"
    || !layout
    || typeof layout !== "object"
    || !analysis
    || typeof analysis !== "object"
  ) {
    return null;
  }

  return {
    signature,
    layout,
    analysis,
  };
}

function getOrderSettingsSignature(order) {
  return order ? buildSettingsSignature(order.settings) : null;
}

function getCachedBuild(order, signature = getOrderSettingsSignature(order)) {
  if (!order?.cachedBuild || !signature || order.cachedBuild.signature !== signature) {
    return null;
  }

  return structuredClone(order.cachedBuild);
}

function invalidateCachedBuild(order, nextSignature = getOrderSettingsSignature(order)) {
  if (order?.cachedBuild && order.cachedBuild.signature !== nextSignature) {
    order.cachedBuild = null;
  }
}

function storeCachedBuild(order, signature, layout, analysis) {
  if (!order || !signature || !layout || !analysis) {
    return;
  }

  order.cachedBuild = {
    signature,
    layout: structuredClone(layout),
    analysis: structuredClone(analysis),
  };
}

function buildExportPayload(layout, analysis = layout?.analysis || null) {
  if (!layout) {
    return null;
  }

  if (analysis?.exportFacePath && analysis?.backingPath) {
    return {
      text: layout.text,
      widthMm: layout.widthMm,
      heightMm: layout.heightMm,
      backingMm: layout.backingMm,
      weldExportedDesign: layout.weldExportedDesign,
      analysis: {
        exportFacePath: analysis.exportFacePath,
        backingPath: analysis.backingPath,
        connectedComponentCount: analysis.connectedComponentCount,
      },
    };
  }

  return layout;
}

function makeAnalysisJobKey(orderId, signature) {
  return `${orderId || "preview"}::${signature || "unknown"}`;
}

function isActiveAnalysisTarget(orderId, signature) {
  if (!orderId || activeOrderId !== orderId) {
    return false;
  }

  return buildSettingsSignature(getCurrentSettings()) === signature;
}

function getAnalysisPromise(jobKey) {
  return analysisPromisesByJobKey.get(jobKey)?.promise || null;
}

function createTrackedAnalysisPromise(jobKey) {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  analysisPromisesByJobKey.set(jobKey, {
    promise,
    resolve: resolvePromise,
  });

  return promise;
}

function resolveTrackedAnalysisPromise(jobKey) {
  const entry = analysisPromisesByJobKey.get(jobKey);
  if (!entry) {
    return;
  }

  entry.resolve();
  analysisPromisesByJobKey.delete(jobKey);
}

function isValidPresetId(presetId) {
  return PRESET_OPTIONS.some((preset) => preset.id === presetId);
}

function buildManualDesignName(order) {
  const index = orders.findIndex((candidate) => candidate.id === order?.id);
  return `Design ${index >= 0 ? index + 1 : orderSequence}`;
}

function buildActiveMeta(order) {
  if (!order) {
    return "Add or import a design to start editing.";
  }

  const metaParts = [];
  const orderNumber = order.source?.orderNumber;
  const listingId = order.source?.listingId;
  const buyerName = order.source?.buyerName;

  if (orderNumber) {
    metaParts.push(`Etsy #${orderNumber}`);
  }

  if (listingId) {
    metaParts.push(`Listing ${listingId}`);
  }

  if (buyerName) {
    metaParts.push(buyerName);
  }

  return metaParts.join(" · ") || "Manual queue item";
}

function buildQueueOrderNumber(order) {
  const orderNumber = order?.source?.orderNumber;
  return orderNumber ? `#${orderNumber}` : buildManualDesignName(order);
}

function buildQueueRecipient(order) {
  const buyerName = order?.source?.buyerName?.trim();
  if (buyerName) {
    return buyerName;
  }

  return "Manual design";
}

function buildQueueListing(order) {
  const listingId = order?.source?.listingId?.trim();
  return listingId ? `Listing ${listingId}` : buildActiveMeta(order);
}

function buildQueuePersonalization(order) {
  const personalization = summarizeOrderText(order?.text || "");
  return personalization && personalization !== "No text entered"
    ? personalization
    : "No personalization entered";
}

function normalizeStoredSource(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  return {
    orderNumber: source.orderNumber == null ? "" : String(source.orderNumber).trim(),
    listingId: source.listingId == null ? "" : String(source.listingId).trim(),
    buyerName: typeof source.buyerName === "string" ? source.buyerName.trim() : "",
    listingTitle: typeof source.listingTitle === "string" ? source.listingTitle.trim() : "",
    listingImageUrl75x75: typeof source.listingImageUrl75x75 === "string" ? source.listingImageUrl75x75.trim() : "",
    transactionId: source.transactionId == null ? "" : String(source.transactionId).trim(),
    importSource: typeof source.importSource === "string" ? source.importSource.trim() : "",
    manualPresetOverride: Boolean(source.manualPresetOverride),
  };
}

function hydrateStoredOrder(order, index) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const text = typeof order.text === "string"
    ? order.text
    : typeof order.settings?.text === "string"
      ? order.settings.text
      : "";
  const settings = normalizeSettings({
    ...(order.settings && typeof order.settings === "object" ? order.settings : {}),
    text,
  });

  return {
    id: typeof order.id === "string" && order.id.trim() ? order.id : crypto.randomUUID(),
    text,
    status: isValidOrderStatus(order.status) ? order.status : "in-progress",
    settings,
    source: normalizeStoredSource(order.source),
    capturedLayout: null,
    cachedBuild: normalizeStoredCachedBuild(order.cachedBuild),
    savedSettingsSignature: typeof order.savedSettingsSignature === "string" ? order.savedSettingsSignature : null,
  };
}

function buildPersistedQueueState() {
  return {
    version: STORAGE_VERSION,
    orderSequence,
    activeOrderId,
    orders: orders.map((order) => ({
      id: order.id,
      text: order.text,
      status: order.status,
      settings: normalizeSettings(order.settings),
      source: order.source ? { ...order.source } : null,
      cachedBuild: order.cachedBuild ? structuredClone(order.cachedBuild) : null,
      savedSettingsSignature: order.savedSettingsSignature,
    })),
  };
}

function persistQueueState() {
  try {
    if (!orders.length) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistedQueueState()));
  } catch {
    // Ignore storage failures and continue with in-memory editing.
  }
}

function clearPersistedQueueState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures and continue with in-memory editing.
  }
}

function loadPersistedQueueState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.orders)) {
      clearPersistedQueueState();
      return false;
    }

    const restoredOrders = parsed.orders
      .map((order, index) => hydrateStoredOrder(order, index))
      .filter(Boolean);

    orders.splice(0, orders.length, ...restoredOrders);
    orderSequence = Math.max(
      Number.isInteger(parsed.orderSequence) ? parsed.orderSequence : 1,
      restoredOrders.length + 1,
    );
    activeOrderId = restoredOrders.some((order) => order.id === parsed.activeOrderId)
      ? parsed.activeOrderId
      : restoredOrders[0]?.id || null;
    return restoredOrders.length > 0;
  } catch {
    clearPersistedQueueState();
    return false;
  }
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function repairImportedMojibake(value) {
  if (!IMPORT_MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value, (character) => {
      const codePoint = character.codePointAt(0);

      if (typeof codePoint !== "number" || codePoint > 255) {
        throw new Error("Non-Latin1 character");
      }

      return codePoint;
    }));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

function normalizeImportedText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return repairImportedMojibake(decodeHtmlEntities(value).trim());
}

function createQueueItem({
  text = "",
  status = "in-progress",
  presetId = DEFAULT_PRESET_ID,
  source = null,
} = {}) {
  const normalizedPresetId = isValidPresetId(presetId) ? presetId : DEFAULT_PRESET_ID;

  return {
    id: crypto.randomUUID(),
    text,
    status,
    settings: normalizeSettings({
      text,
      presetId: normalizedPresetId,
      backingMm: DEFAULT_BACKING_MM,
      weldExportedDesign: DEFAULT_WELD_EXPORTED_DESIGN,
      lines: buildPresetLines(
        normalizedPresetId,
        getRawTextLines(text).length,
        createDefaultLineSettings,
        { listingId: source?.listingId },
      ),
    }),
    source,
    capturedLayout: null,
    cachedBuild: null,
    savedSettingsSignature: null,
  };
}

function buildPresetSynchronizedSettings(settings, presetId, options = {}) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);

  return normalizeSettings({
    ...normalized,
    presetId,
    lines: buildPresetLines(presetId, rawLines.length, createDefaultLineSettings, options),
  });
}

function getMappedPresetIdForOrder(order) {
  const listingId = order?.source?.listingId;
  if (!listingId || !hasPresetMappingForListingId(listingId)) {
    return null;
  }

  return getPresetIdForListingId(listingId);
}

function shouldSyncOrderPreset(order, presetId) {
  if (!order || !presetId || order.source?.manualPresetOverride) {
    return false;
  }

  const normalized = normalizeSettings(order.settings);
  const expectedLines = buildPresetLines(
    presetId,
    getRawTextLines(normalized.text).length,
    createDefaultLineSettings,
    { listingId: order.source?.listingId },
  );

  if (normalized.presetId !== presetId) {
    return true;
  }

  return expectedLines.some((expectedLine, index) => normalized.lines[index]?.fontId !== expectedLine.fontId);
}

function syncOrderPresetFromListing(order) {
  const mappedPresetId = getMappedPresetIdForOrder(order);
  if (!shouldSyncOrderPreset(order, mappedPresetId)) {
    return;
  }

  order.settings = buildPresetSynchronizedSettings(order.settings, mappedPresetId, {
    listingId: order.source?.listingId,
  });
}

function normalizeImportedEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const personalization = normalizeImportedText(
    typeof entry.personalization === "string"
      ? entry.personalization
      : entry.text,
  );

  if (!personalization) {
    return null;
  }

  const orderNumber = entry.orderNumber == null ? "" : String(entry.orderNumber).trim();
  const listingId = entry.listingId == null ? "" : String(entry.listingId).trim();
  const buyerName = normalizeImportedText(entry.buyerName);
  const listingTitle = normalizeImportedText(entry.listingTitle);
  const listingImageUrl75x75 = typeof entry.listingImageUrl75x75 === "string"
    ? entry.listingImageUrl75x75.trim()
    : "";
  const presetId = getPresetIdForListingId(listingId);

  return {
    text: personalization,
    presetId,
    source: {
      orderNumber,
      listingId,
      buyerName,
      listingTitle,
      listingImageUrl75x75,
      transactionId: entry.transactionId == null ? "" : String(entry.transactionId).trim(),
    },
  };
}

function buildImportedQueueIdentity(source, text = "") {
  if (!source || typeof source !== "object") {
    return "";
  }

  const transactionId = source.transactionId == null ? "" : String(source.transactionId).trim();
  if (transactionId) {
    return `transaction:${transactionId}`;
  }

  const orderNumber = source.orderNumber == null ? "" : String(source.orderNumber).trim();
  const listingId = source.listingId == null ? "" : String(source.listingId).trim();
  const buyerName = typeof source.buyerName === "string" ? source.buyerName.trim() : "";
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!orderNumber && !listingId && !buyerName && !normalizedText) {
    return "";
  }

  return `fallback:${orderNumber}|${listingId}|${buyerName}|${normalizedText}`;
}

function parseImportedItems(payloadText) {
  const parsed = JSON.parse(payloadText);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [];

  if (!rawItems.length) {
    throw new Error("Clipboard data did not contain any Etsy designs.");
  }

  return rawItems
    .map((entry) => normalizeImportedEntry(entry))
    .filter(Boolean);
}

function updateImportStatus(message, state = "pending") {
  importStatus.textContent = message;
  importStatus.dataset.state = state;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateZoom(nextZoom, anchor = null) {
  const previousZoom = zoom;
  zoom = clamp(nextZoom, 0.4, 6);
  zoomOutput.textContent = `${Math.round(zoom * 100)}%`;

  if (lastLayout) {
    preview.style.setProperty("--preview-width", `${lastLayout.previewWidthMm * PX_PER_MM * zoom}px`);
    preview.style.setProperty("--preview-height", `${lastLayout.previewHeightMm * PX_PER_MM * zoom}px`);
  } else {
    preview.style.setProperty("--preview-width", `${DEFAULT_PREVIEW_WIDTH_MM * PX_PER_MM * zoom}px`);
    preview.style.setProperty("--preview-height", `${DEFAULT_PREVIEW_HEIGHT_MM * PX_PER_MM * zoom}px`);
  }

  if (anchor && previousZoom !== zoom) {
    const ratio = zoom / previousZoom;
    previewPanel.scrollLeft = (previewPanel.scrollLeft + anchor.x) * ratio - anchor.x;
    previewPanel.scrollTop = (previewPanel.scrollTop + anchor.y) * ratio - anchor.y;
  } else {
    queueMicrotask(() => {
      centerPreviewViewport();
    });
  }
}

function centerPreviewViewport() {
  const hasLayout = Boolean(lastLayout);
  const previewWidthMm = hasLayout ? lastLayout.previewWidthMm : DEFAULT_PREVIEW_WIDTH_MM;
  const previewHeightMm = hasLayout ? lastLayout.previewHeightMm : DEFAULT_PREVIEW_HEIGHT_MM;
  const previewBoxX = hasLayout
    ? lastLayout.previewBoxX
    : (DEFAULT_PREVIEW_WIDTH_MM - PREVIEW_LABEL_RIGHT_MM - PREVIEW_BOX_WIDTH_MM) / 2;
  const previewBoxY = hasLayout
    ? lastLayout.previewBoxY
    : (DEFAULT_PREVIEW_HEIGHT_MM - PREVIEW_BOX_HEIGHT_MM) / 2;
  const guideCenterX = (previewBoxX + PREVIEW_BOX_WIDTH_MM / 2) * PX_PER_MM * zoom;
  const guideCenterY = (previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2) * PX_PER_MM * zoom;
  const maxScrollLeft = Math.max(0, previewWidthMm * PX_PER_MM * zoom - previewPanel.clientWidth);
  const maxScrollTop = Math.max(0, previewHeightMm * PX_PER_MM * zoom - previewPanel.clientHeight);

  previewPanel.scrollLeft = clamp(guideCenterX - previewPanel.clientWidth / 2, 0, maxScrollLeft);
  previewPanel.scrollTop = clamp(guideCenterY - previewPanel.clientHeight / 2, 0, maxScrollTop);
}

function renderPreviewGuideOnly() {
  const previewBoxX = (DEFAULT_PREVIEW_WIDTH_MM - PREVIEW_LABEL_RIGHT_MM - PREVIEW_BOX_WIDTH_MM) / 2;
  const previewBoxY = (DEFAULT_PREVIEW_HEIGHT_MM - PREVIEW_BOX_HEIGHT_MM) / 2;

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${DEFAULT_PREVIEW_WIDTH_MM} ${DEFAULT_PREVIEW_HEIGHT_MM}`);
  lastLayout = {
    previewWidthMm: DEFAULT_PREVIEW_WIDTH_MM,
    previewHeightMm: DEFAULT_PREVIEW_HEIGHT_MM,
    previewBoxX,
    previewBoxY,
  };
  updateZoom(zoom);
  appendPreviewGuide(previewBoxX, previewBoxY);
  updateConnectionStatus("pending", "Connectedness pending", "Enter text to analyze whether the face layer cuts as one acrylic piece.");
}

function appendPreviewGuide(previewBoxX, previewBoxY) {
  const guideCenterX = previewBoxX + PREVIEW_BOX_WIDTH_MM / 2;
  const guideCenterY = previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2;
  const topLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: guideCenterX,
    y: previewBoxY - 2.6,
    "text-anchor": "middle",
  });
  topLabel.textContent = '2.2"';

  const sideLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: previewBoxX + PREVIEW_BOX_WIDTH_MM + 4.5,
    y: previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2,
    "text-anchor": "middle",
    transform: `rotate(90 ${previewBoxX + PREVIEW_BOX_WIDTH_MM + 4.5} ${previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2})`,
  });
  sideLabel.textContent = '1.5"';

  preview.append(
    makeSvgElement("rect", {
      class: "preview-guide-box",
      x: previewBoxX,
      y: previewBoxY,
      width: PREVIEW_BOX_WIDTH_MM,
      height: PREVIEW_BOX_HEIGHT_MM,
      rx: 1.6,
    }),
    makeSvgElement("circle", {
      class: "preview-guide-box",
      cx: guideCenterX,
      cy: guideCenterY,
      r: PREVIEW_CENTER_CIRCLE_DIAMETER_MM / 2,
    }),
    topLabel,
    sideLabel,
  );
}

function updateConnectionStatus(state, label, detail) {
  connectionStatus.className = `status-card status-${state}`;
  connectionStatusLabel.textContent = label;
  connectionStatusDetail.textContent = detail;
}

function lineValueText(setting, value) {
  if (setting === "fontSizeMm") {
    return `${Number(value).toFixed(0)} mm`;
  }

  return `${Number(value).toFixed(1)} mm`;
}

function updateBackingOutput() {
  backingOutput.textContent = `${Number(backingInput.value).toFixed(3)} mm`;
}

function renderLineControls(settings = getCurrentSettings()) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);
  lineControls.replaceChildren();

  if (!rawLines.length) {
    const empty = document.createElement("p");
    empty.className = "line-control-empty";
    empty.textContent = "Add text lines to generate one font and slider group per line.";
    lineControls.append(empty);
    return;
  }

  rawLines.forEach((lineText, index) => {
    const line = normalized.lines[index] || createDefaultLineSettings();
    const card = document.createElement("section");
    card.className = "line-control-card";
    card.dataset.lineIndex = String(index);

    const header = document.createElement("div");
    header.className = "line-control-header";

    const title = document.createElement("h3");
    title.className = "line-control-title";
    title.textContent = `Line ${index + 1}`;

    const summary = document.createElement("span");
    summary.className = "line-control-text";
    summary.textContent = lineText.trim() || "Blank line";

    header.append(title, summary);
    card.append(header);

    const grid = document.createElement("div");
    grid.className = "line-control-grid";
    const fields = [
      createFontField(index, line.fontId),
      createRangeField(index, "bridgeMm", "Letter Bridge", 0, 4, 0.1, line.bridgeMm),
      createRangeField(index, "offsetXMm", "Horizontal Offset", -20, 20, 0.1, line.offsetXMm),
      createRangeField(index, "fontSizeMm", "Text Height", 18, 55, 1, line.fontSizeMm),
    ];

    if (index > 0) {
      fields.splice(2, 0, createRangeField(index, "lineBridgeMm", "Line Bridge", 0, 8, 0.1, line.lineBridgeMm));
    }

    grid.append(...fields);

    card.append(grid);
    lineControls.append(card);
  });
}

function createFontField(lineIndex, fontId) {
  const label = document.createElement("label");
  label.className = "field compact-field";

  const span = document.createElement("span");
  span.textContent = "Font";

  const select = document.createElement("select");
  select.dataset.lineIndex = String(lineIndex);
  select.dataset.setting = "fontId";

  FONT_OPTIONS.forEach((font) => {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.label;
    option.selected = font.id === fontId;
    select.append(option);
  });

  label.append(span, select);
  return label;
}

function createRangeField(lineIndex, setting, labelText, min, max, step, value) {
  const label = document.createElement("label");
  label.className = "field compact-field";

  const span = document.createElement("span");
  span.textContent = labelText;

  const row = document.createElement("div");
  row.className = "range-row";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset.lineIndex = String(lineIndex);
  input.dataset.setting = setting;

  const output = document.createElement("output");
  output.textContent = lineValueText(setting, value);

  row.append(input, output);
  label.append(span, row);

  return label;
}

function getCurrentSettings() {
  const rawLines = getRawTextLines(textInput.value);
  const presetId = presetInput.value;
  const activeOrder = getActiveOrder();
  const listingId = activeOrder?.source?.listingId ?? null;
  const lines = rawLines.map((_, index) => {
    const lineCard = lineControls.querySelector(`[data-line-index="${index}"]`);
    if (!lineCard) {
      return createPresetLineSettings(presetId, index, { listingId });
    }

    const fontSelect = lineCard.querySelector('[data-setting="fontId"]');
    const bridgeInput = lineCard.querySelector('[data-setting="bridgeMm"]');
    const lineBridgeInput = lineCard.querySelector('[data-setting="lineBridgeMm"]');
    const offsetXInput = lineCard.querySelector('[data-setting="offsetXMm"]');
    const fontSizeInput = lineCard.querySelector('[data-setting="fontSizeMm"]');

    return normalizeLineSettings({
      fontId: fontSelect?.value,
      bridgeMm: bridgeInput?.value,
      lineBridgeMm: lineBridgeInput?.value,
      offsetXMm: offsetXInput?.value,
      fontSizeMm: fontSizeInput?.value,
    });
  });

  return normalizeSettings({
    text: textInput.value,
    presetId,
    backingMm: Number(backingInput.value),
    weldExportedDesign: weldExportedDesignInput.checked,
    lines,
  });
}

function applySettings(settings) {
  const normalized = normalizeSettings(settings);
  textInput.value = normalized.text;
  presetInput.value = normalized.presetId;
  weldExportedDesignInput.checked = normalized.weldExportedDesign;
  backingInput.value = String(normalized.backingMm);
  updateBackingOutput();
  renderLineControls(normalized);
}

function applyPresetSelection(presetId) {
  const currentSettings = getCurrentSettings();
  const rawLines = getRawTextLines(currentSettings.text);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    presetId,
    lines: buildPresetLines(presetId, rawLines.length, createDefaultLineSettings),
  });

  applySettings(nextSettings);
  render();
  updateActiveOrderFromControls();
}

function getActiveOrder() {
  return orders.find((order) => order.id === activeOrderId) || null;
}

function summarizeOrderText(text) {
  const summary = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" / ");
  return summary || "No text entered";
}

function renderListingReference(order) {
  const listingTitle = order?.source?.listingTitle?.trim() || order?.source?.listingId?.trim() || "Imported Etsy listing";
  const listingImageUrl = order?.source?.listingImageUrl75x75?.trim();
  const hasReference = Boolean(listingImageUrl);

  listingReferenceCard.classList.toggle("is-hidden", !hasReference);

  if (!hasReference) {
    listingReferenceTitle.textContent = "";
    listingReferenceImage.removeAttribute("src");
    listingReferenceImage.alt = "";
    return;
  }

  listingReferenceTitle.textContent = listingTitle;
  listingReferenceImage.src = listingImageUrl;
  listingReferenceImage.alt = listingTitle;
}

function saveActiveOrderDraft() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  invalidateCachedBuild(order);
  if (order.status !== "captured" && order.status !== "exported") {
    order.status = "in-progress";
  }
  persistQueueState();
}

function updateActiveOrderFromControls() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  invalidateCachedBuild(order);
  order.status = "in-progress";
  persistQueueState();
  renderOrderList();
}

function hasUnsavedRenderChanges(order) {
  if (!order || !order.text.trim()) {
    return false;
  }

  return buildSettingsSignature(getCurrentSettings()) !== order.savedSettingsSignature;
}

function renderOrderList() {
  const searchTerm = orderSearchInput.value.trim().toLowerCase();
  const visibleOrders = orders.filter((order) => {
    if (!searchTerm) {
      return true;
    }

    return `${buildQueueOrderNumber(order)} ${order.text} ${order.source?.orderNumber || ""} ${order.source?.listingId || ""} ${order.source?.buyerName || ""}`
      .toLowerCase()
      .includes(searchTerm);
  });
  const completeCount = orders.filter((order) => order.status === "captured" || order.status === "exported").length;
  const progressCount = orders.filter((order) => order.status === "in-progress").length;
  const notStartedCount = orders.filter((order) => order.status === "not-started").length;
  const exportableCount = orders.filter((order) => order.text.trim()).length;

  orderCountOutput.textContent = String(orders.length);
  completeCountOutput.textContent = String(completeCount);
  progressCountOutput.textContent = String(progressCount);
  notStartedCountOutput.textContent = String(notStartedCount);
  clearQueueButton.disabled = orders.length === 0;
  exportCompletedButton.disabled = exportableCount === 0;
  orderList.replaceChildren();

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "Add a design manually or import Etsy clipboard data. Each personalized line item becomes its own queue row.";
    orderList.append(empty);
  }

  if (orders.length && !visibleOrders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "No designs match the current search.";
    orderList.append(empty);
  }

  visibleOrders.forEach((order) => {
    const row = document.createElement("div");
    row.className = `order-row${order.id === activeOrderId ? " active" : ""}`;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "order-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "order-item-header";

    const title = document.createElement("div");
    title.className = "order-item-title";
    title.textContent = buildQueueOrderNumber(order);

    const status = document.createElement("span");
    status.className = `order-status ${order.status}`;
    status.textContent = statusLabels[order.status];

    const body = document.createElement("div");
    body.className = "order-item-body";

    const recipientText = document.createElement("div");
    recipientText.className = "order-item-recipient";
    recipientText.textContent = buildQueueRecipient(order);

    const listingText = document.createElement("div");
    listingText.className = "order-item-listing";
    listingText.textContent = buildQueueListing(order);

    const personalizationText = document.createElement("div");
    personalizationText.className = "order-item-personalization";
    personalizationText.textContent = buildQueuePersonalization(order);

    header.append(title, status);
    body.append(recipientText, listingText, personalizationText);
    item.append(header, body);
    item.addEventListener("click", () => selectOrder(order.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary-action order-delete-button";
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 11V8h12v13H6Z" />
      </svg>
    `;
    deleteButton.setAttribute("aria-label", `Delete ${buildQueueOrderNumber(order)}`);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteOrder(order.id);
    });

    row.append(item, deleteButton);
    orderList.append(row);
  });

  const activeOrder = getActiveOrder();
  editorPanel.classList.toggle("is-hidden", !activeOrder);
  renderListingReference(activeOrder);
  activeOrderName.textContent = activeOrder ? buildQueueOrderNumber(activeOrder) : "No design selected";
  activeOrderMeta.textContent = buildActiveMeta(activeOrder);
  captureButton.disabled = !hasUnsavedRenderChanges(activeOrder);
  downloadButton.disabled = !activeOrder || !activeOrder.text.trim();
}

function selectOrder(orderId) {
  saveActiveOrderDraft();

  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return;
  }

  activeOrderId = order.id;
  if (order.status === "not-started") {
    order.status = "in-progress";
  }

  syncOrderPresetFromListing(order);
  applySettings(order.settings);
  persistQueueState();
  renderOrderList();
  requestAnimationFrame(() => {
    render();
  });
}

function addOrder() {
  const order = createQueueItem({
    text: "",
    status: "in-progress",
    presetId: DEFAULT_PRESET_ID,
    source: null,
  });

  orders.push(order);
  orderSequence += 1;
  selectOrder(order.id);
}

function resetEditorToEmptyState() {
  applySettings({
    text: "",
    presetId: DEFAULT_PRESET_ID,
    backingMm: DEFAULT_BACKING_MM,
    weldExportedDesign: DEFAULT_WELD_EXPORTED_DESIGN,
    lines: [],
  });
  renderPreviewGuideOnly();
}

function deleteOrder(orderId) {
  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return;
  }

  saveActiveOrderDraft();

  if (!window.confirm(`Delete ${buildQueueOrderNumber(order)} from the current batch?`)) {
    return;
  }

  const orderIndex = orders.findIndex((candidate) => candidate.id === orderId);
  if (orderIndex < 0) {
    return;
  }

  orders.splice(orderIndex, 1);

  if (activeOrderId === orderId) {
    activeOrderId = orders[orderIndex]?.id || orders[orderIndex - 1]?.id || null;
    if (activeOrderId) {
      const nextOrder = getActiveOrder();
      applySettings(nextOrder.settings);
    } else {
      orderSequence = 1;
      resetEditorToEmptyState();
    }
  }

  if (!orders.length) {
    activeOrderId = null;
    orderSequence = 1;
    clearPersistedQueueState();
    updateImportStatus("Queue cleared. Import Etsy clipboard data copied from the browser helper.", "pending");
  } else {
    persistQueueState();
  }

  renderOrderList();
  if (activeOrderId) {
    render();
  }
}

function clearAllOrders() {
  saveActiveOrderDraft();
  if (!orders.length) {
    return;
  }

  if (!window.confirm("Clear the current batch and delete all saved local designs?")) {
    return;
  }

  orders.splice(0, orders.length);
  activeOrderId = null;
  orderSequence = 1;
  clearPersistedQueueState();
  resetEditorToEmptyState();
  updateImportStatus("Batch cleared. Import Etsy clipboard data copied from the browser helper.", "pending");
  renderOrderList();
}

async function importFromClipboard() {
  if (!navigator.clipboard?.readText) {
    updateImportStatus("Clipboard import is not available in this browser context.", "error");
    return;
  }

  importClipboardButton.disabled = true;
  importClipboardButton.textContent = "Importing...";

  try {
    const clipboardText = await navigator.clipboard.readText();
    const importedItems = parseImportedItems(clipboardText);
    const existingImportedIdentities = new Set(
      orders
        .map((order) => buildImportedQueueIdentity(order?.source, order?.text))
        .filter(Boolean),
    );
    const dedupedItems = [];
    let skippedCount = 0;

    for (const entry of importedItems) {
      const identity = buildImportedQueueIdentity(entry.source, entry.text);

      if (identity && existingImportedIdentities.has(identity)) {
        skippedCount += 1;
        continue;
      }

      if (identity) {
        existingImportedIdentities.add(identity);
      }

      dedupedItems.push(entry);
    }

    const createdItems = dedupedItems.map((entry) => {
      return createQueueItem({
        text: entry.text,
        status: "in-progress",
        presetId: entry.presetId,
        source: {
          ...entry.source,
          importSource: IMPORT_SOURCE_TAG,
        },
      });
    });

    saveActiveOrderDraft();
    if (createdItems.length) {
      orders.push(...createdItems);
      orderSequence += createdItems.length;
      selectOrder(createdItems[0].id);
    }

    if (createdItems.length && skippedCount) {
      updateImportStatus(`Imported ${createdItems.length} new Etsy design${createdItems.length === 1 ? "" : "s"} and skipped ${skippedCount} already in the queue.`, "success");
    } else if (createdItems.length) {
      updateImportStatus(`Imported ${createdItems.length} Etsy design${createdItems.length === 1 ? "" : "s"} from the clipboard.`, "success");
    } else if (skippedCount) {
      updateImportStatus(`Skipped ${skippedCount} Etsy design${skippedCount === 1 ? "" : "s"} already in the queue. No new designs were added.`, "success");
    } else {
      updateImportStatus("Clipboard data did not include any importable Etsy designs.", "error");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clipboard import failed.";
    updateImportStatus(message, "error");
  } finally {
    importClipboardButton.disabled = false;
    importClipboardButton.textContent = "Import Clipboard";
  }
}

function captureActiveOrder() {
  const order = getActiveOrder();
  if (!order || !textInput.value.trim()) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  order.savedSettingsSignature = buildSettingsSignature(order.settings);
  order.capturedLayout = structuredClone(lastLayout);
  order.status = "captured";
  persistQueueState();
  renderOrderList();

  const activeIndex = orders.findIndex((candidate) => candidate.id === order.id);
  const orderedCandidates = [...orders.slice(activeIndex + 1), ...orders.slice(0, activeIndex)];
  const nextUncaptured = orderedCandidates.find((candidate) => candidate.status !== "captured" && candidate.status !== "exported");
  if (nextUncaptured) {
    selectOrder(nextUncaptured.id);
  }
}

async function checkFonts() {
  await Promise.all(
    FONT_OPTIONS.map(async (font) => {
      try {
        const response = await fetch(font.url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Font file not found");
        }
        await document.fonts.load(`120px "${font.family}"`);
      } catch {
        // Fall back to the browser script font when a production font is unavailable.
      }
    }),
  );
}

function measureCharacter(character, fontSizeMm, fontId) {
  const fontSizePx = fontSizeMm * PX_PER_MM;
  ctx.font = getCanvasFont(fontSizePx, fontId);
  const metrics = ctx.measureText(character);
  const left = (metrics.actualBoundingBoxLeft || 0) / PX_PER_MM;
  const right = (metrics.actualBoundingBoxRight || metrics.width) / PX_PER_MM;

  return {
    advance: metrics.width / PX_PER_MM,
    left,
    right,
    inkWidth: left + right,
  };
}

function createGlyphMask(character, fontSizeMm, fontId) {
  const fontSizePx = fontSizeMm * PX_PER_MM * MASK_SCALE;
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskContext.font = getCanvasFont(fontSizePx, fontId);
  const metrics = maskContext.measureText(character);
  const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
  const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSizePx * 0.8);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSizePx * 0.25);
  const width = Math.max(1, left + right + MASK_PADDING_PX * 2);
  const height = Math.max(1, ascent + descent + MASK_PADDING_PX * 2);
  const baseline = MASK_PADDING_PX + ascent;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.font = getCanvasFont(fontSizePx, fontId);
  maskContext.fillStyle = "#000";
  maskContext.textBaseline = "alphabetic";
  maskContext.fillText(character, MASK_PADDING_PX + left, baseline);

  const imageData = maskContext.getImageData(0, 0, width, height);

  return {
    character,
    data: imageData.data,
    width,
    height,
    baseline,
    leftMm: left / MASK_SCALE / PX_PER_MM,
    rightMm: right / MASK_SCALE / PX_PER_MM,
    ascentMm: ascent / MASK_SCALE / PX_PER_MM,
    descentMm: descent / MASK_SCALE / PX_PER_MM,
  };
}

function maskHasInk(mask, x, y) {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }

  return mask.data[(y * mask.width + x) * 4 + 3] > 32;
}

function getOverlapWidthPx(leftMask, rightMask, dxPx) {
  const baselineDelta = leftMask.baseline - rightMask.baseline;
  let minX = Infinity;
  let maxX = -Infinity;

  for (let rightY = 0; rightY < rightMask.height; rightY += 1) {
    const leftY = rightY + baselineDelta;
    if (leftY < 0 || leftY >= leftMask.height) {
      continue;
    }

    for (let rightX = 0; rightX < rightMask.width; rightX += 1) {
      if (!maskHasInk(rightMask, rightX, rightY)) {
        continue;
      }

      const leftX = rightX + dxPx;
      if (maskHasInk(leftMask, leftX, leftY)) {
        minX = Math.min(minX, leftX);
        maxX = Math.max(maxX, leftX);
      }
    }
  }

  return Number.isFinite(minX) ? maxX - minX + 1 : 0;
}

function findPairOffsetMm(leftMask, rightMask, bridgeMm) {
  const targetPx = Math.max(1, Math.round(bridgeMm * PX_PER_MM * MASK_SCALE));
  const start = leftMask.width + rightMask.width;
  const end = -rightMask.width;

  for (let dx = start; dx >= end; dx -= 1) {
    if (getOverlapWidthPx(leftMask, rightMask, dx) >= targetPx) {
      return dx / MASK_SCALE / PX_PER_MM;
    }
  }

  return (leftMask.rightMm + rightMask.leftMm) - bridgeMm;
}

function createEmptyLineMask(fontSizeMm) {
  const scale = PX_PER_MM * MASK_SCALE;
  const height = Math.ceil(fontSizeMm * 1.35 * scale) + MASK_PADDING_PX * 2;
  const baseline = MASK_PADDING_PX + Math.ceil(fontSizeMm * scale);

  return {
    data: new Uint8ClampedArray(4),
    width: 1,
    height,
    baseline,
    inkLeft: 0,
    inkRight: 0,
    leftMm: 0,
    rightMm: 0,
    topMm: 0,
    bottomMm: fontSizeMm,
    widthMm: 0,
    heightMm: fontSizeMm,
    baselineMm: baseline / scale,
    hasInk: false,
  };
}

function createLineMask(letters, fontSizeMm, fontId) {
  if (!letters.length) {
    return createEmptyLineMask(fontSizeMm);
  }

  const scale = PX_PER_MM * MASK_SCALE;
  const minLeft = Math.min(...letters.map((letter) => letter.leftEdge), 0);
  const maxRight = Math.max(...letters.map((letter) => letter.rightEdge), fontSizeMm);
  const width = Math.ceil((maxRight - minLeft) * scale) + MASK_PADDING_PX * 2;
  const height = Math.ceil(fontSizeMm * 1.35 * scale) + MASK_PADDING_PX * 2;
  const baseline = MASK_PADDING_PX + Math.ceil(fontSizeMm * scale);
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.font = getCanvasFont(fontSizeMm * scale, fontId);
  maskContext.fillStyle = "#000";
  maskContext.textBaseline = "alphabetic";

  letters.forEach((letter) => {
    maskContext.fillText(letter.character, MASK_PADDING_PX + (letter.x - minLeft) * scale, baseline);
  });

  const imageData = maskContext.getImageData(0, 0, width, height);
  let inkLeft = width;
  let inkRight = 0;
  let hasInk = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] > 32) {
        inkLeft = Math.min(inkLeft, x);
        inkRight = Math.max(inkRight, x);
        hasInk = true;
      }
    }
  }

  const visualLeftMm = hasInk ? minLeft + (inkLeft - MASK_PADDING_PX) / scale : minLeft;
  const visualRightMm = hasInk ? minLeft + (inkRight - MASK_PADDING_PX) / scale : maxRight;
  let inkTop = height;
  let inkBottom = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] > 32) {
        inkTop = Math.min(inkTop, y);
        inkBottom = Math.max(inkBottom, y);
      }
    }
  }

  const visualTopMm = hasInk ? (inkTop - MASK_PADDING_PX) / scale : 0;
  const visualBottomMm = hasInk ? (inkBottom - MASK_PADDING_PX) / scale : fontSizeMm;

  return {
    data: imageData.data,
    width,
    height,
    baseline,
    inkLeft,
    inkRight,
    leftMm: visualLeftMm,
    rightMm: visualRightMm,
    topMm: visualTopMm,
    bottomMm: visualBottomMm,
    widthMm: visualRightMm - visualLeftMm,
    heightMm: visualBottomMm - visualTopMm,
    baselineMm: baseline / scale,
    hasInk,
  };
}

function getLineOverlapHeightPx(upperMask, lowerMask, dxPx, dyPx) {
  let minY = Infinity;
  let maxY = -Infinity;

  for (let lowerY = 0; lowerY < lowerMask.height; lowerY += 1) {
    const upperY = lowerY + dyPx;
    if (upperY < 0 || upperY >= upperMask.height) {
      continue;
    }

    for (let lowerX = 0; lowerX < lowerMask.width; lowerX += 1) {
      if (!maskHasInk(lowerMask, lowerX, lowerY)) {
        continue;
      }

      const upperX = lowerX + dxPx;
      if (maskHasInk(upperMask, upperX, upperY)) {
        minY = Math.min(minY, upperY);
        maxY = Math.max(maxY, upperY);
      }
    }
  }

  return Number.isFinite(minY) ? maxY - minY + 1 : 0;
}

function findLineOffsetMm(upperMask, lowerMask, bridgeMm) {
  if (!upperMask.hasInk || !lowerMask.hasInk) {
    return upperMask.heightMm - bridgeMm;
  }

  const scale = PX_PER_MM * MASK_SCALE;
  const targetPx = Math.max(1, Math.round(bridgeMm * scale));
  const upperCenter = (upperMask.inkLeft + upperMask.inkRight) / 2;
  const lowerCenter = (lowerMask.inkLeft + lowerMask.inkRight) / 2;
  const dxPx = Math.round(upperCenter - lowerCenter);

  for (let dy = upperMask.height; dy >= -lowerMask.height; dy -= 1) {
    if (getLineOverlapHeightPx(upperMask, lowerMask, dxPx, dy) >= targetPx) {
      return dy / scale;
    }
  }

  return (upperMask.height - MASK_PADDING_PX * 2) / scale - bridgeMm;
}

function layoutCharacters(text, fontSizeMm, bridgeMm, fontId) {
  const characters = [...text];
  if (!characters.length) {
    return [];
  }

  const masks = characters.map((character) => createGlyphMask(character, fontSizeMm, fontId));
  const positions = [];

  return characters.map((character, index) => {
    const metrics = measureCharacter(character, fontSizeMm, fontId);
    const mask = masks[index];
    const maskOrigin = index === 0
      ? 0
      : positions[index - 1].maskOrigin + findPairOffsetMm(masks[index - 1], mask, bridgeMm);
    positions.push({ maskOrigin });

    const x = maskOrigin + mask.leftMm;
    const leftEdge = x - metrics.left;
    const rightEdge = x + metrics.right;

    return {
      character,
      index,
      x,
      leftEdge,
      rightEdge,
      width: metrics.inkWidth,
      advance: metrics.advance,
    };
  });
}

function layoutTextLines(text, lineSettings) {
  const rawLines = getRawTextLines(text);
  const normalizedSettings = normalizeSettings({ text, lines: lineSettings }).lines;
  const lines = rawLines.map((lineText, index) => {
    const settings = normalizedSettings[index] || createDefaultLineSettings();
    const letters = layoutCharacters(lineText, settings.fontSizeMm, settings.bridgeMm, settings.fontId);
    return {
      index,
      text: lineText,
      settings,
      letters,
      mask: createLineMask(letters, settings.fontSizeMm, settings.fontId),
      offsetXMm: settings.offsetXMm,
      y: 0,
    };
  });

  lines.forEach((line, index) => {
    if (index === 0) {
      line.y = 0;
      return;
    }

    const previous = lines[index - 1];
    line.y = previous.y + findLineOffsetMm(previous.mask, line.mask, line.settings.lineBridgeMm);
  });

  return lines;
}

function makeSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

async function analyzeLayout(layout) {
  const response = await fetch("/api/layout-analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "analyze",
      layout,
    }),
  });

  if (!response.ok) {
    throw new Error("Layout analysis failed");
  }

  return response.json();
}

function fillBackingHoles(imageData, width, height) {
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const queue = [];

  function isTransparent(index) {
    return data[index * 4 + 3] <= 32;
  }

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;
    if (visited[index] || !isTransparent(index)) {
      return;
    }

    visited[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = Math.floor(index / width);

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  for (let index = 0; index < width * height; index += 1) {
    if (!visited[index]) {
      const offset = index * 4;
      data[offset] = 68;
      data[offset + 1] = 111;
      data[offset + 2] = 139;
      data[offset + 3] = 255;
    }
  }
}

function createBackingImage(letters, widthMm, heightMm, backingMm) {
  const scale = PX_PER_MM * 3;
  const backingCanvas = document.createElement("canvas");
  const backingContext = backingCanvas.getContext("2d", { willReadFrequently: true });
  const widthPx = Math.ceil(widthMm * scale);
  const heightPx = Math.ceil(heightMm * scale);

  backingCanvas.width = widthPx;
  backingCanvas.height = heightPx;
  backingContext.textBaseline = "alphabetic";
  backingContext.lineJoin = "round";
  backingContext.lineCap = "round";
  backingContext.strokeStyle = "#446f8b";
  backingContext.fillStyle = "#446f8b";

  letters.forEach((letter) => {
    backingContext.font = getCanvasFont(letter.fontSizeMm * scale, letter.fontId);
    backingContext.lineWidth = backingMm * 2 * scale;
    backingContext.strokeText(letter.character, letter.x * scale, letter.y * scale);
    backingContext.fillText(letter.character, letter.x * scale, letter.y * scale);
  });

  const imageData = backingContext.getImageData(0, 0, widthPx, heightPx);
  fillBackingHoles(imageData, widthPx, heightPx);
  backingContext.putImageData(imageData, 0, 0);

  return backingCanvas.toDataURL("image/png");
}

function measureCanvasInkBounds(canvas, widthMm, heightMm) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 32) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  return {
    left: (minX / width) * widthMm,
    top: (minY / height) * heightMm,
    width: ((maxX - minX + 1) / width) * widthMm,
    height: ((maxY - minY + 1) / height) * heightMm,
  };
}

function createFaceImage(letters, widthMm, heightMm) {
  const scale = PX_PER_MM * 3;
  const faceCanvas = document.createElement("canvas");
  const faceContext = faceCanvas.getContext("2d");
  const widthPx = Math.ceil(widthMm * scale);
  const heightPx = Math.ceil(heightMm * scale);

  faceCanvas.width = widthPx;
  faceCanvas.height = heightPx;
  faceContext.textBaseline = "alphabetic";
  faceContext.lineJoin = "round";
  faceContext.lineCap = "round";
  faceContext.fillStyle = "#f8fbfc";

  letters.forEach((letter) => {
    faceContext.font = getCanvasFont(letter.fontSizeMm * scale, letter.fontId);
    faceContext.fillText(letter.character, letter.x * scale, letter.y * scale);
  });

  return {
    href: faceCanvas.toDataURL("image/png"),
    boundsMm: measureCanvasInkBounds(faceCanvas, widthMm, heightMm),
  };
}

function renderPreviewFromLayout(layout) {
  const analysis = layout.analysis || null;
  const facePreview = createFaceImage(layout.letters, layout.widthMm, layout.heightMm);
  const previewBounds = facePreview.boundsMm.width > 0 && facePreview.boundsMm.height > 0
    ? facePreview.boundsMm
    : analysis?.faceBoundsMm || layout.textBoundsMm;
  const frame = computePreviewFrame(layout, previewBounds);

  lastLayout = {
    ...layout,
    previewWidthMm: frame.previewWidthMm,
    previewHeightMm: frame.previewHeightMm,
    previewBoxX: frame.previewBoxX,
    previewBoxY: frame.previewBoxY,
  };

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${frame.previewWidthMm} ${frame.previewHeightMm}`);
  updateZoom(zoom);

  const backingLayer = analysis
    ? makeSvgElement("path", {
        d: analysis.backingPath,
        fill: "#446f8b",
        transform: `translate(${frame.designX} ${frame.designY})`,
      })
    : makeSvgElement("image", {
        href: createBackingImage(layout.letters, layout.widthMm, layout.heightMm, layout.backingMm),
        x: frame.designX,
        y: frame.designY,
        width: layout.widthMm,
        height: layout.heightMm,
      });
  const faceLayer = analysis
    ? makeSvgElement("path", {
        class: "face-layer",
        d: analysis.facePath,
        fill: "#f8fbfc",
        transform: `translate(${frame.designX} ${frame.designY})`,
      })
    : makeSvgElement("image", {
        class: "face-layer",
        href: facePreview.href,
        x: frame.designX,
        y: frame.designY,
        width: layout.widthMm,
        height: layout.heightMm,
      });

  preview.append(backingLayer, faceLayer);
  appendPreviewGuide(frame.previewBoxX, frame.previewBoxY);
}

function updateConnectionStatusFromAnalysis(analysis) {
  if (analysis.isConnected) {
    updateConnectionStatus(
      "ok",
      "Single connected face piece",
      "The current face-layer analysis reads as one connected acrylic component.",
    );
    return;
  }

  updateConnectionStatus(
    "warning",
    `${analysis.connectedComponentCount} separate face pieces`,
    "The current face-layer analysis still contains disconnected acrylic pieces. Adjust the bridges or line layout before export.",
  );
}

function applyAnalysisResult(layout, analysis, orderId = null, signature = null) {
  if (orderId && signature) {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (order && getOrderSettingsSignature(order) === signature) {
      storeCachedBuild(order, signature, layout, analysis);
      persistQueueState();
    }
  }

  if (!isActiveAnalysisTarget(orderId, signature)) {
    return;
  }

  renderPreviewFromLayout({
    ...layout,
    analysis,
  });
  updateConnectionStatusFromAnalysis(analysis);
}

function scheduleLayoutAnalysis(layout, orderId = null, signature = null) {
  const jobKey = makeAnalysisJobKey(orderId, signature);
  if (inFlightAnalysisKeys.has(jobKey)) {
    return;
  }

  if (getAnalysisPromise(jobKey)) {
    return;
  }

  if (orderId) {
    const pendingTimerId = pendingAnalysisTimersByOrderId.get(orderId);
    if (pendingTimerId) {
      clearTimeout(pendingTimerId);
    }
  }

  createTrackedAnalysisPromise(jobKey);

  const timerId = setTimeout(async () => {
    if (orderId) {
      pendingAnalysisTimersByOrderId.delete(orderId);
      pendingAnalysisKeysByOrderId.delete(orderId);
    }

    inFlightAnalysisKeys.add(jobKey);

    try {
      const analysis = await analyzeLayout(layout);
      applyAnalysisResult(layout, analysis, orderId, signature);
    } catch {
      if (isActiveAnalysisTarget(orderId, signature)) {
        updateConnectionStatus(
          "warning",
          "Analysis unavailable",
          "The connectedness check failed, but the live preview is still available.",
        );
      }
    } finally {
      inFlightAnalysisKeys.delete(jobKey);
      resolveTrackedAnalysisPromise(jobKey);
    }
  }, 180);

  if (orderId) {
    pendingAnalysisTimersByOrderId.set(orderId, timerId);
    pendingAnalysisKeysByOrderId.set(orderId, jobKey);
  }
}

function render() {
  updateBackingOutput();
  const settings = getCurrentSettings();
  const activeOrder = getActiveOrder();
  const signature = buildSettingsSignature(settings);

  if (!settings.text.trim()) {
    lastLayout = null;
    renderPreviewGuideOnly();
    return;
  }

  const cachedBuild = getCachedBuild(activeOrder, signature);
  if (cachedBuild) {
    renderPreviewFromLayout({
      ...cachedBuild.layout,
      analysis: cachedBuild.analysis,
    });
    updateConnectionStatusFromAnalysis(cachedBuild.analysis);
    return;
  }

  const layout = buildOrderLayout(settings);
  renderPreviewFromLayout(layout);
  updateConnectionStatus("pending", "Analyzing layout...", "Checking connectedness in the background while keeping the live preview responsive.");
  scheduleLayoutAnalysis(layout, activeOrder?.id || null, signature);
}

async function downloadSvg() {
  const order = getActiveOrder();
  if (!order || !lastLayout) {
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Exporting...";
  downloadButton.setAttribute("aria-busy", "true");

  try {
    order.text = textInput.value;
    order.settings = getCurrentSettings();
    let cachedBuild = getCachedBuild(order);
    if (!cachedBuild) {
      const layout = buildOrderLayout(order.settings);
      const analysis = await analyzeLayout(layout);
      const signature = getOrderSettingsSignature(order);
      storeCachedBuild(order, signature, layout, analysis);
      persistQueueState();
      cachedBuild = getCachedBuild(order, signature);
    }

    await requestSvgExport({
      layout: buildExportPayload(cachedBuild.layout, cachedBuild.analysis),
      filename: "badge-reel-layout.svg",
    });
    order.status = "exported";
    order.capturedLayout = structuredClone({
      ...cachedBuild.layout,
      analysis: cachedBuild.analysis,
    });
    persistQueueState();
    renderOrderList();
  } catch {
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Export This Design";
    downloadButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

async function requestSvgExport({ layout = null, layouts = null, filename }) {
  const payload = layouts ? { layouts } : layout;
  const response = await fetch("/api/export-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Vector SVG export failed");
  }

  const svgSource = await response.text();
  const blob = new Blob([svgSource], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function ensureOrderCachedBuild(order) {
  const signature = getOrderSettingsSignature(order);
  let cachedBuild = getCachedBuild(order, signature);
  if (cachedBuild) {
    return cachedBuild;
  }

  const jobKey = makeAnalysisJobKey(order.id, signature);
  const pendingJob = getAnalysisPromise(jobKey);
  if (pendingJob) {
    await pendingJob;
    cachedBuild = getCachedBuild(order, signature);
    if (cachedBuild) {
      return cachedBuild;
    }
  }

  const layout = buildOrderLayout(order.settings);
  const analysis = await analyzeLayout(layout);
  storeCachedBuild(order, signature, layout, analysis);
  persistQueueState();
  return getCachedBuild(order, signature);
}

async function exportAllOrders() {
  saveActiveOrderDraft();
  renderOrderList();

  const exportableOrders = orders.filter((order) => order.text.trim());
  if (!exportableOrders.length) {
    return;
  }

  exportCompletedButton.disabled = true;
  exportCompletedButton.textContent = "Exporting...";
  exportCompletedButton.setAttribute("aria-busy", "true");

  try {
    const builtLayouts = await Promise.all(exportableOrders.map(async (order) => {
      const cachedBuild = await ensureOrderCachedBuild(order);
      return {
        order,
        layout: cachedBuild.layout,
        analysis: cachedBuild.analysis,
      };
    }));

    await requestSvgExport({
      layouts: builtLayouts.map(({ layout, analysis }) => buildExportPayload(layout, analysis)),
      filename: "badge-reel-layout-batch.svg",
    });

    builtLayouts.forEach(({ order, layout, analysis }) => {
      order.status = "exported";
      order.capturedLayout = structuredClone(analysis ? { ...layout, analysis } : layout);
    });
    persistQueueState();
  } catch {
  } finally {
    exportCompletedButton.disabled = false;
    exportCompletedButton.textContent = "Export All Designs";
    exportCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

function buildOrderLayout(settings) {
  const normalized = normalizeSettings(settings);
  const text = normalized.text.trim();
  const lines = layoutTextLines(normalized.text, normalized.lines);
  const baseTextWidthMm = Math.max(
    1,
    ...lines.map((line) => line.mask.widthMm),
    ...lines.map((line) => line.settings.fontSizeMm),
  );
  const {
    lineBounds,
    minLeftMm,
    maxRightMm,
    minTopMm,
    maxBottomMm,
  } = measureLineBounds(baseTextWidthMm, lines);
  const textWidthMm = Math.max(1, maxRightMm - minLeftMm);
  const textHeightMm = Math.max(1, maxBottomMm - minTopMm);
  const scaleFactor = computeTextFitScale(textWidthMm, textHeightMm);
  const scaledBackingMm = normalized.backingMm * scaleFactor;
  const rawWidthMm = textWidthMm + normalized.backingMm * 2 + DESIGN_BLEED_MM * 2;
  const rawHeightMm = textHeightMm + normalized.backingMm * 2 + DESIGN_BLEED_MM * 2;
  const widthMm = rawWidthMm * scaleFactor;
  const heightMm = rawHeightMm * scaleFactor;
  const absoluteLetters = lineBounds.flatMap(({ line, centeredLeftMm }) => {
    const font = getFontOption(line.settings.fontId);
    const rawLineX = DESIGN_BLEED_MM + normalized.backingMm + centeredLeftMm - minLeftMm - line.mask.leftMm;
    const rawBaselineY = DESIGN_BLEED_MM + normalized.backingMm + (line.y - minTopMm) + line.mask.baselineMm;

    return line.letters.map((letter) => ({
      character: letter.character,
      x: (rawLineX + letter.x) * scaleFactor,
      y: rawBaselineY * scaleFactor,
      fontId: line.settings.fontId,
      fontPath: font.exportPath,
      fontSizeMm: line.settings.fontSizeMm * scaleFactor,
    }));
  });

  return {
    text,
    widthMm,
    heightMm,
    backingMm: scaledBackingMm,
    weldExportedDesign: normalized.weldExportedDesign,
    textBoundsMm: buildScaledTextBounds(textWidthMm, textHeightMm, normalized.backingMm, scaleFactor),
    letters: absoluteLetters,
  };
}

function handleTextInput() {
  const nextSettings = normalizeSettings(getCurrentSettings());
  renderLineControls(nextSettings);
  updateActiveOrderFromControls();
  render();
}

function handleLineControlsChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    return;
  }

  if (target instanceof HTMLSelectElement && target.dataset.setting === "fontId") {
    const order = getActiveOrder();
    if (order?.source) {
      order.source.manualPresetOverride = true;
    }
  }

  if (target instanceof HTMLInputElement && target.type === "range") {
    const output = target.parentElement?.querySelector("output");
    if (output) {
      output.textContent = lineValueText(target.dataset.setting, target.value);
    }
  }

  render();
  updateActiveOrderFromControls();
}

textInput.addEventListener("input", handleTextInput);
presetInput.addEventListener("change", () => {
  const order = getActiveOrder();
  if (order?.source) {
    order.source.manualPresetOverride = true;
  }
  applyPresetSelection(presetInput.value);
});
lineControls.addEventListener("input", handleLineControlsChange);
lineControls.addEventListener("change", handleLineControlsChange);
backingInput.addEventListener("input", () => {
  updateBackingOutput();
  render();
  updateActiveOrderFromControls();
});
weldExportedDesignInput.addEventListener("input", () => {
  render();
  updateActiveOrderFromControls();
});

addOrderButton.addEventListener("click", addOrder);
importClipboardButton.addEventListener("click", importFromClipboard);
clearQueueButton.addEventListener("click", clearAllOrders);
exportCompletedButton.addEventListener("click", exportAllOrders);
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", captureActiveOrder);
downloadButton.addEventListener("click", downloadSvg);
zoomOutButton.addEventListener("click", () => updateZoom(zoom / 1.2));
zoomInButton.addEventListener("click", () => updateZoom(zoom * 1.2));
zoomResetButton.addEventListener("click", () => updateZoom(DEFAULT_ZOOM));
previewPanel.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = previewPanel.getBoundingClientRect();
  const anchor = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  updateZoom(zoom * direction, anchor);
}, { passive: false });

await checkFonts();
updateBackingOutput();
const restoredQueue = loadPersistedQueueState();
if (restoredQueue) {
  updateImportStatus(`Restored ${orders.length} design${orders.length === 1 ? "" : "s"} from browser storage.`, "success");
} else {
  updateImportStatus("Import Etsy clipboard data copied from the browser helper.", "pending");
}
renderLineControls(normalizeSettings({
  text: "",
  presetId: DEFAULT_PRESET_ID,
  backingMm: DEFAULT_BACKING_MM,
  weldExportedDesign: DEFAULT_WELD_EXPORTED_DESIGN,
  lines: [],
}));
if (activeOrderId) {
  const activeOrder = getActiveOrder();
  if (activeOrder) {
    applySettings(activeOrder.settings);
  }
}
renderPreviewGuideOnly();
render();
renderOrderList();
