import {
  DEFAULT_BACKING_MM,
  DESIGN_BLEED_MM,
  PREVIEW_BOX_HEIGHT_MM,
  PREVIEW_BOX_WIDTH_MM,
  PREVIEW_LABEL_RIGHT_MM,
  PREVIEW_MARGIN_MM,
  PX_PER_MM,
  computeLineScaleFactors,
  computeMixedFitScale,
  computeMixedScaleBounds,
  computePreviewFrame,
  computeTextFitScale,
  measureLineBounds,
} from "./layout-math.js";
import {
  buildPresetLines,
  getDefaultPresetId,
  getPresetGlobalDefaults,
  getPresetIdForListingId,
  getPresetOptions,
  hasPresetMappingForListingId,
  isValidPresetId,
  loadPresetRegistry,
} from "./presets.js";
import {
  buildSettingsSignature,
  getSettingsSignatureCandidates,
} from "./order-signatures.js";

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
  verticalScale: 1,
  lockTextHeight: false,
});

const addOrderButton = document.querySelector("#addOrderButton");
const importClipboardButton = document.querySelector("#importClipboardButton");
const clearQueueButton = document.querySelector("#clearQueueButton");
const importStatus = document.querySelector("#importStatus");
const exportCompletedButton = document.querySelector("#exportCompletedButton");
const copyCompletedButton = document.querySelector("#copyCompletedButton");
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
const importedColorField = document.querySelector("#importedColorField");
const importedColorValue = document.querySelector("#importedColorValue");
const importedQuantityField = document.querySelector("#importedQuantityField");
const importedQuantityValue = document.querySelector("#importedQuantityValue");
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
const copyButton = document.querySelector("#copyButton");
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
let queuePersistenceTimeoutId = null;
let orderListRenderFrameId = null;

const statusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  captured: "Complete",
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
    verticalScale: DEFAULT_LINE_SETTINGS.verticalScale,
    lockTextHeight: DEFAULT_LINE_SETTINGS.lockTextHeight,
  };
}

function getPresetBaseSettings(presetId) {
  const globalDefaults = getPresetGlobalDefaults(presetId);

  return {
    backingMm: Number.isFinite(Number(globalDefaults.backingMm)) ? Number(globalDefaults.backingMm) : DEFAULT_BACKING_MM,
    weldExportedDesign: typeof globalDefaults.weldExportedDesign === "boolean"
      ? globalDefaults.weldExportedDesign
      : DEFAULT_WELD_EXPORTED_DESIGN,
  };
}

function createPresetLineSettings(presetId, lineIndex, options = {}) {
  const { listingId = null } = options;
  return {
    ...createDefaultLineSettings(),
    ...buildPresetLines(presetId, lineIndex + 1, createDefaultLineSettings, { listingId })[lineIndex],
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
    verticalScale: Number.isFinite(Number(lineSettings.verticalScale)) ? Number(lineSettings.verticalScale) : DEFAULT_LINE_SETTINGS.verticalScale,
    lockTextHeight: typeof lineSettings.lockTextHeight === "boolean"
      ? lineSettings.lockTextHeight
      : DEFAULT_LINE_SETTINGS.lockTextHeight,
  };
}

function normalizeSettings(settings = {}) {
  const text = typeof settings.text === "string" ? settings.text : "";
  const rawLines = getRawTextLines(text);
  const defaultPresetId = getDefaultPresetId();
  const presetId = isValidPresetId(settings.presetId)
    ? settings.presetId
    : defaultPresetId;
  const presetBaseSettings = getPresetBaseSettings(presetId);
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
    backingMm: Number.isFinite(Number(settings.backingMm)) ? Number(settings.backingMm) : presetBaseSettings.backingMm,
    weldExportedDesign: typeof settings.weldExportedDesign === "boolean"
      ? settings.weldExportedDesign
      : presetBaseSettings.weldExportedDesign,
    lines: rawLines.map((_, index) => normalizeLineSettings(legacyLines[index] || createPresetLineSettings(presetId, index))),
  };
}

function settingsSignatureMatches(settings, signature) {
  if (typeof signature !== "string" || !signature) {
    return false;
  }

  return getSettingsSignatureCandidates(settings).includes(signature);
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

function normalizeStoredAnalysisBadge(analysisBadge) {
  if (!analysisBadge || typeof analysisBadge !== "object") {
    return null;
  }

  const state = analysisBadge.state;
  if (state !== "running" && state !== "ok" && state !== "warning") {
    return null;
  }

  return {
    state,
    shortLabel: typeof analysisBadge.shortLabel === "string" ? analysisBadge.shortLabel : "",
    fullLabel: typeof analysisBadge.fullLabel === "string" ? analysisBadge.fullLabel : "",
  };
}

function normalizeStoredSignature(signature) {
  return typeof signature === "string" && signature ? signature : null;
}

function toSignatureCandidates(signature) {
  if (Array.isArray(signature)) {
    return signature.filter((candidate) => typeof candidate === "string" && candidate);
  }

  return typeof signature === "string" && signature ? [signature] : [];
}

function getStoredBuildForSignature(cachedBuild, previousCompletedBuild, signature) {
  const signatureCandidates = toSignatureCandidates(signature);
  if (!signatureCandidates.length) {
    return null;
  }

  if (signatureCandidates.includes(cachedBuild?.signature)) {
    return structuredClone(cachedBuild);
  }

  if (signatureCandidates.includes(previousCompletedBuild?.signature)) {
    return structuredClone(previousCompletedBuild);
  }

  return null;
}

function getOrderSettingsSignature(order) {
  return order ? buildSettingsSignature(order.settings) : null;
}

function getOrderSettingsSignatureCandidates(order) {
  return order ? getSettingsSignatureCandidates(order.settings) : [];
}

function getCachedBuild(order, signature = getOrderSettingsSignatureCandidates(order)) {
  if (!order?.cachedBuild) {
    return null;
  }

  return getStoredBuildForSignature(order.cachedBuild, null, signature);
}

function getBuildForSignature(order, signature) {
  const signatureCandidates = toSignatureCandidates(signature);
  if (!order?.text.trim() || !signatureCandidates.length) {
    return null;
  }

  const storedBuild = getStoredBuildForSignature(order.cachedBuild, order.previousCompletedBuild, signatureCandidates);
  if (storedBuild) {
    return storedBuild;
  }

  if (
    order.capturedLayout
    && typeof order.capturedLayout === "object"
    && signatureCandidates.includes(order.savedSettingsSignature)
    && order.capturedLayout.analysis
    && typeof order.capturedLayout.analysis === "object"
  ) {
    const layout = structuredClone(order.capturedLayout);
    const analysis = structuredClone(order.capturedLayout.analysis);
    delete layout.analysis;

    return {
      signature: order.savedSettingsSignature,
      layout,
      analysis,
    };
  }

  return null;
}

function cloneSerializableData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function storeCachedBuild(order, signature, layout, analysis) {
  if (!order || !signature || !layout || !analysis) {
    return;
  }

  order.cachedBuild = {
    signature,
    layout: cloneSerializableData(layout),
    analysis: cloneSerializableData(analysis),
  };
}

function buildExportPayload(layout, analysis = layout?.analysis || null, source = null) {
  if (!layout) {
    return null;
  }

  const colorName = typeof source?.colorName === "string" ? source.colorName.trim() : "";
  const quantity = source?.quantity == null ? "" : String(source.quantity).trim();

  if (analysis?.exportFacePath && analysis?.backingPath) {
    return {
      text: layout.text,
      widthMm: layout.widthMm,
      heightMm: layout.heightMm,
      backingMm: layout.backingMm,
      weldExportedDesign: layout.weldExportedDesign,
      colorName,
      quantity,
      analysis: {
        exportFacePath: analysis.exportFacePath,
        backingPath: analysis.backingPath,
        connectedComponentCount: analysis.connectedComponentCount,
      },
    };
  }

  return {
    ...layout,
    colorName,
    quantity,
  };
}

function renderPresetOptions() {
  const presetOptions = getPresetOptions();
  const selectedPresetId = presetInput.value;

  presetInput.replaceChildren();
  presetOptions.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    presetInput.append(option);
  });

  presetInput.value = isValidPresetId(selectedPresetId)
    ? selectedPresetId
    : getDefaultPresetId();
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
    colorName: typeof source.colorName === "string" ? source.colorName.trim() : "",
    quantity: source.quantity == null ? "" : String(source.quantity).trim(),
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
  const currentSignature = buildSettingsSignature(settings);

  const cachedBuild = normalizeStoredCachedBuild(order.cachedBuild);
  const previousCompletedBuild = normalizeStoredCachedBuild(order.previousCompletedBuild);
  let status = isValidOrderStatus(order.status) ? order.status : "in-progress";
  let savedSettingsSignature = normalizeStoredSignature(order.savedSettingsSignature);
  const persistedPendingAnalysisSignature = normalizeStoredSignature(order.pendingAnalysisSignature);
  let analysisBadge = normalizeStoredAnalysisBadge(order.analysisBadge);
  let effectiveCachedBuild = cachedBuild;
  let effectivePreviousCompletedBuild = previousCompletedBuild;
  const abandonedPendingSignature = persistedPendingAnalysisSignature
    || (analysisBadge?.state === "running" ? savedSettingsSignature : null);
  const savedCompletedBuild = getStoredBuildForSignature(
    cachedBuild,
    previousCompletedBuild,
    savedSettingsSignature,
  );
  const pendingCompletedBuild = getStoredBuildForSignature(
    cachedBuild,
    previousCompletedBuild,
    abandonedPendingSignature,
  );

  if (abandonedPendingSignature) {
    status = "in-progress";
    analysisBadge = null;

    if (settingsSignatureMatches(settings, abandonedPendingSignature) && pendingCompletedBuild) {
      status = "captured";
      savedSettingsSignature = abandonedPendingSignature;
      analysisBadge = buildCompletedAnalysisBadge(pendingCompletedBuild.analysis);
      if (previousCompletedBuild?.signature === abandonedPendingSignature) {
        effectivePreviousCompletedBuild = null;
      }
    } else if (!savedCompletedBuild) {
      savedSettingsSignature = null;
    }
  } else if (!savedCompletedBuild && savedSettingsSignature) {
    savedSettingsSignature = null;
    if (status === "captured" || status === "exported") {
      status = "in-progress";
      analysisBadge = null;
    }
  } else if (savedCompletedBuild && settingsSignatureMatches(settings, savedSettingsSignature)) {
    if (status === "captured" || status === "exported" || analysisBadge?.state === "running") {
      analysisBadge = buildCompletedAnalysisBadge(savedCompletedBuild.analysis);
    }
  } else if (!settingsSignatureMatches(settings, savedSettingsSignature) && status !== "exported") {
    status = "in-progress";
    analysisBadge = null;
  }

  return {
    id: typeof order.id === "string" && order.id.trim() ? order.id : crypto.randomUUID(),
    text,
    status,
    settings,
    source: normalizeStoredSource(order.source),
    capturedLayout: null,
    cachedBuild: effectiveCachedBuild,
    previousCompletedBuild: effectivePreviousCompletedBuild,
    savedSettingsSignature,
    analysisBadge,
    analysisState: "idle",
    pendingAnalysisSignature: null,
    pendingAnalysisRequestId: null,
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
      previousCompletedBuild: order.previousCompletedBuild ? structuredClone(order.previousCompletedBuild) : null,
    savedSettingsSignature: order.savedSettingsSignature,
    analysisBadge: order.analysisBadge ? structuredClone(order.analysisBadge) : null,
    pendingAnalysisSignature: order.pendingAnalysisSignature,
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

function schedulePersistQueueState() {
  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
  }

  queuePersistenceTimeoutId = window.setTimeout(() => {
    queuePersistenceTimeoutId = null;
    persistQueueState();
  }, 150);
}

function scheduleRenderOrderList() {
  if (orderListRenderFrameId != null) {
    return;
  }

  orderListRenderFrameId = window.requestAnimationFrame(() => {
    orderListRenderFrameId = null;
    renderOrderList();
  });
}

function clearPersistedQueueState() {
  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
    queuePersistenceTimeoutId = null;
  }
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
  presetId = null,
  source = null,
} = {}) {
  const defaultPresetId = getDefaultPresetId();
  const normalizedPresetId = isValidPresetId(presetId) ? presetId : defaultPresetId;
  const presetBaseSettings = getPresetBaseSettings(normalizedPresetId);

  return {
    id: crypto.randomUUID(),
    text,
    status,
    settings: normalizeSettings({
      text,
      presetId: normalizedPresetId,
      backingMm: presetBaseSettings.backingMm,
      weldExportedDesign: presetBaseSettings.weldExportedDesign,
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
    previousCompletedBuild: null,
    savedSettingsSignature: null,
    analysisBadge: null,
    analysisState: "idle",
    pendingAnalysisSignature: null,
    pendingAnalysisRequestId: null,
  };
}

function buildPresetSynchronizedSettings(settings, presetId, options = {}) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);
  const presetBaseSettings = getPresetBaseSettings(presetId);

  return normalizeSettings({
    ...normalized,
    presetId,
    backingMm: presetBaseSettings.backingMm,
    weldExportedDesign: presetBaseSettings.weldExportedDesign,
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
  if (
    !order
    || !presetId
    || order.source?.manualPresetOverride
    || typeof order.savedSettingsSignature === "string"
  ) {
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
  const colorName = normalizeImportedText(entry.colorName);
  const quantity = entry.quantity == null ? "" : String(entry.quantity).trim();
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
      colorName,
      quantity,
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

function captureElementScrollState(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  return {
    left: element.scrollLeft,
    top: element.scrollTop,
  };
}

function restoreElementScrollState(element, state) {
  if (!(element instanceof HTMLElement) || !state) {
    return;
  }

  element.scrollLeft = state.left;
  element.scrollTop = state.top;
}

function captureSelectionScrollState() {
  return {
    pageLeft: window.scrollX,
    pageTop: window.scrollY,
    queue: captureElementScrollState(orderList),
  };
}

function restoreSelectionScrollState(state) {
  if (!state) {
    return;
  }

  restoreElementScrollState(orderList, state.queue);
  window.scrollTo(state.pageLeft, state.pageTop);
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

  if (setting === "verticalScale") {
    return `${Math.round(Number(value) * 100)}%`;
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
      createRangeField(index, "verticalScale", "Vertical Stretch", 0.75, 1.5, 0.01, line.verticalScale),
      createCheckboxField(index, "lockTextHeight", "Lock Text Height", line.lockTextHeight),
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

function createCheckboxField(lineIndex, setting, labelText, checked) {
  const label = document.createElement("label");
  label.className = "check-field line-control-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.dataset.lineIndex = String(lineIndex);
  input.dataset.setting = setting;

  const span = document.createElement("span");
  span.textContent = labelText;

  label.append(input, span);
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
    const verticalScaleInput = lineCard.querySelector('[data-setting="verticalScale"]');
    const lockTextHeightInput = lineCard.querySelector('[data-setting="lockTextHeight"]');

    return normalizeLineSettings({
      fontId: fontSelect?.value,
      bridgeMm: bridgeInput?.value,
      lineBridgeMm: lineBridgeInput?.value,
      offsetXMm: offsetXInput?.value,
      fontSizeMm: fontSizeInput?.value,
      verticalScale: verticalScaleInput?.value,
      lockTextHeight: lockTextHeightInput?.checked,
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
  const activeOrder = getActiveOrder();
  const rawLines = getRawTextLines(currentSettings.text);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    presetId,
    ...getPresetBaseSettings(presetId),
    lines: buildPresetLines(
      presetId,
      rawLines.length,
      createDefaultLineSettings,
      { listingId: activeOrder?.source?.listingId ?? null },
    ),
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
  const colorName = order?.source?.colorName?.trim() || "";
  const quantity = order?.source?.quantity?.trim() || "";
  const hasReference = Boolean(listingImageUrl || colorName || quantity);

  listingReferenceCard.classList.toggle("is-hidden", !hasReference);

  if (!hasReference) {
    listingReferenceTitle.textContent = "";
    listingReferenceImage.removeAttribute("src");
    listingReferenceImage.alt = "";
    return;
  }

  listingReferenceTitle.textContent = listingTitle;
  if (listingImageUrl) {
    listingReferenceImage.src = listingImageUrl;
    listingReferenceImage.alt = listingTitle;
    listingReferenceImage.classList.remove("is-hidden");
  } else {
    listingReferenceImage.removeAttribute("src");
    listingReferenceImage.alt = "";
    listingReferenceImage.classList.add("is-hidden");
  }
}

function renderImportedColor(order) {
  const colorName = order?.source?.colorName?.trim() || "";
  const hasColor = Boolean(colorName);
  const quantity = order?.source?.quantity?.trim() || "";
  const hasQuantity = Boolean(quantity);

  importedColorField.classList.toggle("is-hidden", !hasColor);
  importedColorValue.classList.toggle("highlight-light-color", /\bwhite\b/i.test(colorName));
  importedQuantityField.classList.toggle("is-hidden", !hasQuantity);

  if (!hasColor) {
    importedColorValue.textContent = "";
  } else {
    importedColorValue.textContent = colorName;
  }

  importedQuantityValue.textContent = hasQuantity ? quantity : "";
}

function saveActiveOrderDraft() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  if (order.status !== "captured" && order.status !== "exported") {
    order.status = "in-progress";
    order.analysisBadge = null;
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
  const currentSignature = buildSettingsSignature(order.settings);
  const matchingCompletedBuild = getBuildForSignature(order, getSettingsSignatureCandidates(order.settings));
  const preservesPendingGeometry = order.pendingAnalysisSignature === currentSignature && !matchingCompletedBuild;

  if (matchingCompletedBuild) {
    order.savedSettingsSignature = matchingCompletedBuild.signature;
    order.cachedBuild = structuredClone(matchingCompletedBuild);
    order.capturedLayout = {
      ...cloneSerializableData(matchingCompletedBuild.layout),
      analysis: cloneSerializableData(matchingCompletedBuild.analysis),
    };
    order.status = "captured";
    order.analysisState = "idle";
    order.pendingAnalysisSignature = null;
    order.pendingAnalysisRequestId = null;
    order.analysisBadge = buildCompletedAnalysisBadge(matchingCompletedBuild.analysis);
    if (order.previousCompletedBuild?.signature === matchingCompletedBuild.signature) {
      order.previousCompletedBuild = null;
    }
  } else if (preservesPendingGeometry) {
    order.status = "captured";
    order.analysisState = "running";
    order.analysisBadge = {
      state: "running",
      shortLabel: "",
      fullLabel: "Analysis running",
    };
  } else {
    order.status = "in-progress";
    order.analysisState = "idle";
    order.analysisBadge = null;
    if (!getSavedCachedBuild(order)) {
      order.savedSettingsSignature = null;
    } else if (order.analysisState === "running") {
      order.analysisState = "idle";
    }
  }
  schedulePersistQueueState();
  scheduleRenderOrderList();
}

function getTrackedSettingsSignature(order) {
  if (!order) {
    return null;
  }

  return order.pendingAnalysisSignature || order.savedSettingsSignature;
}

function canCompleteActiveOrder(order) {
  if (!order || !order.text.trim()) {
    return false;
  }

  const currentSignature = buildSettingsSignature(getCurrentSettings());
  if (order.analysisState === "running" && order.pendingAnalysisSignature === currentSignature) {
    return true;
  }

  return hasUnsavedRenderChanges(order);
}

function hasUnsavedRenderChanges(order) {
  if (!order || !order.text.trim()) {
    return false;
  }

  return !settingsSignatureMatches(getCurrentSettings(), getTrackedSettingsSignature(order));
}

function hasSavedCompletedState(order) {
  return Boolean(
    order
    && typeof order.savedSettingsSignature === "string"
    && (order.status === "captured" || order.status === "exported"),
  );
}

function getSavedCachedBuild(order) {
  if (!order?.text.trim() || !hasSavedCompletedState(order)) {
    return null;
  }

  return getBuildForSignature(order, order.savedSettingsSignature);
}

function isOrderReadyForExport(order) {
  if (!getSavedCachedBuild(order)) {
    return false;
  }

  if (order?.id === activeOrderId && hasUnsavedRenderChanges(order)) {
    return false;
  }

  return true;
}

function buildCompletedAnalysisBadge(analysis) {
  if (!analysis || typeof analysis !== "object") {
    return null;
  }

  if (analysis.isConnected) {
    return {
      state: "ok",
      shortLabel: "1",
      fullLabel: "Analysis complete: 1 connected face piece",
    };
  }

  const pieceCount = Number.isFinite(Number(analysis.connectedComponentCount))
    ? Math.max(1, Number(analysis.connectedComponentCount))
    : 0;

  return {
    state: "warning",
    shortLabel: pieceCount > 0 ? String(pieceCount) : "",
    fullLabel: `Analysis complete: ${pieceCount || "multiple"} face pieces`,
  };
}

function getQueueAnalysisSummary(order) {
  if (!order) {
    return null;
  }

  if (order.analysisState === "running") {
    return {
      state: "running",
      shortLabel: "",
      fullLabel: "Analysis running",
    };
  }

  if (order.status !== "captured" && order.status !== "exported") {
    return order.analysisBadge;
  }

  const cachedBuild = getSavedCachedBuild(order);
  const analysis = cachedBuild?.analysis;
  if (!analysis) {
    return order.analysisBadge;
  }

  return buildCompletedAnalysisBadge(analysis);
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
  const readyToExportCount = orders.filter(isOrderReadyForExport).length;
  const allExportableOrdersReady = exportableCount > 0 && readyToExportCount === exportableCount;

  orderCountOutput.textContent = String(orders.length);
  completeCountOutput.textContent = String(completeCount);
  progressCountOutput.textContent = String(progressCount);
  notStartedCountOutput.textContent = String(notStartedCount);
  clearQueueButton.disabled = orders.length === 0;
  exportCompletedButton.disabled = !allExportableOrdersReady;
  copyCompletedButton.disabled = !allExportableOrdersReady || !canCopySvgToClipboard();
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

    const analysisSummary = getQueueAnalysisSummary(order);
    const analysisIndicator = document.createElement("span");
    analysisIndicator.className = `order-analysis-indicator${analysisSummary ? ` ${analysisSummary.state}` : ""}${analysisSummary ? "" : " is-hidden"}`;
    analysisIndicator.setAttribute("aria-hidden", analysisSummary ? "false" : "true");

    if (analysisSummary?.state === "running") {
      const spinner = document.createElement("span");
      spinner.className = "order-analysis-spinner";
      spinner.setAttribute("aria-hidden", "true");
      analysisIndicator.append(spinner);
    } else if (analysisSummary?.state === "ok") {
      const icon = document.createElement("span");
      icon.className = "order-analysis-icon";
      icon.textContent = "\u2713";
      analysisIndicator.append(icon);
    } else if (analysisSummary?.state === "warning") {
      const icon = document.createElement("span");
      icon.className = "order-analysis-icon";
      icon.textContent = "\u26A0";
      analysisIndicator.append(icon);

      const count = document.createElement("span");
      count.className = "order-analysis-count";
      count.textContent = analysisSummary.shortLabel;
      analysisIndicator.append(count);
    }

    if (analysisSummary?.fullLabel) {
      analysisIndicator.setAttribute("title", analysisSummary.fullLabel);
      analysisIndicator.setAttribute("aria-label", analysisSummary.fullLabel);
    }

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

    header.append(title, analysisIndicator, status);
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
  renderImportedColor(activeOrder);
  activeOrderName.textContent = activeOrder ? buildQueueOrderNumber(activeOrder) : "No design selected";
  activeOrderMeta.textContent = buildActiveMeta(activeOrder);
  captureButton.disabled = !canCompleteActiveOrder(activeOrder);
  downloadButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder);
  copyButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder) || !canCopySvgToClipboard();
}

function selectOrder(orderId) {
  const selectionScrollState = captureSelectionScrollState();
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
  restoreSelectionScrollState(selectionScrollState);
  requestAnimationFrame(() => {
    render();
    restoreSelectionScrollState(selectionScrollState);
  });
}

function addOrder() {
  const order = createQueueItem({
    text: "",
    status: "in-progress",
    presetId: getDefaultPresetId(),
    source: null,
  });

  orders.push(order);
  orderSequence += 1;
  selectOrder(order.id);
}

function resetEditorToEmptyState() {
  const defaultPresetId = getDefaultPresetId();
  const presetBaseSettings = getPresetBaseSettings(defaultPresetId);

  applySettings({
    text: "",
    presetId: defaultPresetId,
    backingMm: presetBaseSettings.backingMm,
    weldExportedDesign: presetBaseSettings.weldExportedDesign,
    lines: [],
  });
  renderImportedColor(null);
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

async function captureActiveOrder() {
  const order = getActiveOrder();
  if (!order || !textInput.value.trim()) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  const layout = buildOrderLayout(order.settings);
  const signature = buildSettingsSignature(order.settings);
  const requestId = crypto.randomUUID();
  const previousCompletedBuild = getSavedCachedBuild(order);

  order.previousCompletedBuild = previousCompletedBuild ? structuredClone(previousCompletedBuild) : null;
  order.capturedLayout = structuredClone(layout);
  order.analysisState = "running";
  order.pendingAnalysisSignature = signature;
  order.pendingAnalysisRequestId = requestId;
  order.analysisBadge = {
    state: "running",
    shortLabel: "",
    fullLabel: "Analysis running",
  };
  order.status = "captured";
  persistQueueState();
  renderOrderList();

  updateConnectionStatus(
    "pending",
    "Analyzing completed layout...",
    "Running face analysis and caching the export-ready geometry for this completed design.",
  );

  const activeIndex = orders.findIndex((candidate) => candidate.id === order.id);
  const orderedCandidates = [...orders.slice(activeIndex + 1), ...orders.slice(0, activeIndex)];
  const nextUncaptured = orderedCandidates.find((candidate) => candidate.status !== "captured" && candidate.status !== "exported");
  if (nextUncaptured) {
    selectOrder(nextUncaptured.id);
  }

  try {
    const analysis = await analyzeLayout(layout);
    const isLatestAnalysisRequest = order.pendingAnalysisRequestId === requestId;
    const shouldApplyCompletedAnalysis = isLatestAnalysisRequest
      && buildSettingsSignature(order.settings) === signature;

    if (isLatestAnalysisRequest) {
      storeCachedBuild(order, signature, layout, analysis);
      order.analysisState = "idle";
      order.pendingAnalysisSignature = null;
      order.pendingAnalysisRequestId = null;
    }

    if (shouldApplyCompletedAnalysis) {
      order.savedSettingsSignature = signature;
      order.capturedLayout = {
        ...cloneSerializableData(layout),
        analysis: cloneSerializableData(analysis),
      };
      order.status = "captured";
      order.analysisBadge = buildCompletedAnalysisBadge(analysis);
      if (order.previousCompletedBuild?.signature === signature) {
        order.previousCompletedBuild = null;
      }
    }

    persistQueueState();

    if (
      shouldApplyCompletedAnalysis
      && activeOrderId === order.id
      && buildSettingsSignature(getCurrentSettings()) === signature
    ) {
      renderPreviewFromLayout({
        ...layout,
        analysis,
      });
      updateConnectionStatusFromAnalysis(analysis);
    }

    renderOrderList();
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    const isLatestAnalysisRequest = order.pendingAnalysisRequestId === requestId;
    const shouldApplyFailedAnalysis = isLatestAnalysisRequest
      && buildSettingsSignature(order.settings) === signature;

    if (isLatestAnalysisRequest) {
      order.analysisState = "idle";
      order.pendingAnalysisSignature = null;
      order.pendingAnalysisRequestId = null;
    }
    if (shouldApplyFailedAnalysis) {
      order.status = "in-progress";
      order.analysisBadge = null;
    }
    if (shouldApplyFailedAnalysis && activeOrderId === order.id) {
      updateConnectionStatus(
        "warning",
        "Analysis failed",
        `Face analysis could not complete, so this completed design is not ready for export yet.${detail}`,
      );
    }
    persistQueueState();
    renderOrderList();
  } finally {
    if (order.pendingAnalysisRequestId === requestId || order.pendingAnalysisRequestId == null) {
      order.analysisState = order.pendingAnalysisRequestId ? "running" : "idle";
    }
    persistQueueState();
    renderOrderList();
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

function drawScaledText(context, character, x, y, fontSizePx, fontId, verticalScale, mode = "fill") {
  context.save();
  context.font = getCanvasFont(fontSizePx, fontId);
  context.textBaseline = "alphabetic";
  context.translate(x, y);
  context.scale(1, verticalScale);

  if (mode === "stroke" || mode === "both") {
    context.strokeText(character, 0, 0);
  }

  if (mode === "fill" || mode === "both") {
    context.fillText(character, 0, 0);
  }

  context.restore();
}

function createGlyphMask(character, fontSizeMm, fontId, verticalScale) {
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
  const scaledAscent = Math.ceil(ascent * verticalScale);
  const scaledDescent = Math.ceil(descent * verticalScale);
  const height = Math.max(1, scaledAscent + scaledDescent + MASK_PADDING_PX * 2);
  const baseline = MASK_PADDING_PX + scaledAscent;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.fillStyle = "#000";
  drawScaledText(maskContext, character, MASK_PADDING_PX + left, baseline, fontSizePx, fontId, verticalScale);

  const imageData = maskContext.getImageData(0, 0, width, height);

  return {
    character,
    data: imageData.data,
    width,
    height,
    baseline,
    leftMm: left / MASK_SCALE / PX_PER_MM,
    rightMm: right / MASK_SCALE / PX_PER_MM,
    ascentMm: scaledAscent / MASK_SCALE / PX_PER_MM,
    descentMm: scaledDescent / MASK_SCALE / PX_PER_MM,
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

function createEmptyLineMask(fontSizeMm, verticalScale) {
  const scale = PX_PER_MM * MASK_SCALE;
  const height = Math.ceil(fontSizeMm * 1.35 * verticalScale * scale) + MASK_PADDING_PX * 2;
  const baseline = MASK_PADDING_PX + Math.ceil(fontSizeMm * verticalScale * scale);
  const scaledHeightMm = fontSizeMm * verticalScale;

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
    bottomMm: scaledHeightMm,
    widthMm: 0,
    heightMm: scaledHeightMm,
    baselineMm: baseline / scale,
    hasInk: false,
  };
}

function createLineMask(letters, fontSizeMm, fontId, verticalScale) {
  if (!letters.length) {
    return createEmptyLineMask(fontSizeMm, verticalScale);
  }

  const scale = PX_PER_MM * MASK_SCALE;
  const minLeft = Math.min(...letters.map((letter) => letter.leftEdge), 0);
  const maxRight = Math.max(...letters.map((letter) => letter.rightEdge), fontSizeMm);
  const width = Math.ceil((maxRight - minLeft) * scale) + MASK_PADDING_PX * 2;
  const height = Math.ceil(fontSizeMm * 1.35 * verticalScale * scale) + MASK_PADDING_PX * 2;
  const baseline = MASK_PADDING_PX + Math.ceil(fontSizeMm * verticalScale * scale);
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.fillStyle = "#000";

  letters.forEach((letter) => {
    drawScaledText(
      maskContext,
      letter.character,
      MASK_PADDING_PX + (letter.x - minLeft) * scale,
      baseline,
      fontSizeMm * scale,
      fontId,
      verticalScale,
    );
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
  const visualBottomMm = hasInk ? (inkBottom - MASK_PADDING_PX) / scale : fontSizeMm * verticalScale;

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

function layoutCharacters(text, fontSizeMm, bridgeMm, fontId, verticalScale) {
  const characters = [...text];
  if (!characters.length) {
    return [];
  }

  const masks = characters.map((character) => createGlyphMask(character, fontSizeMm, fontId, verticalScale));
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
    const letters = layoutCharacters(
      lineText,
      settings.fontSizeMm,
      settings.bridgeMm,
      settings.fontId,
      settings.verticalScale,
    );
    return {
      index,
      text: lineText,
      settings,
      letters,
      mask: createLineMask(letters, settings.fontSizeMm, settings.fontId, settings.verticalScale),
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

function measureTextLayoutForFit(text, lineSettings) {
  const lines = layoutTextLines(text, lineSettings);
  if (!lines.length) {
    return {
      lines,
      baseTextWidthMm: 1,
      lineBounds: [],
      minLeftMm: 0,
      maxRightMm: 1,
      minTopMm: 0,
      maxBottomMm: 1,
      textWidthMm: 1,
      textHeightMm: 1,
      fitScale: 1,
    };
  }

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

  return {
    lines,
    baseTextWidthMm,
    lineBounds,
    minLeftMm,
    maxRightMm,
    minTopMm,
    maxBottomMm,
    textWidthMm,
    textHeightMm,
    fitScale: computeTextFitScale(textWidthMm, textHeightMm),
  };
}

function buildScaledLineSettings(lines, fitScale) {
  return lines.map((line) => {
    const lockTextHeight = Boolean(line?.settings?.lockTextHeight);
    return normalizeLineSettings({
      ...line.settings,
      bridgeMm: Number(line.settings.bridgeMm) * fitScale,
      lineBridgeMm: Number(line.settings.lineBridgeMm) * fitScale,
      offsetXMm: Number(line.settings.offsetXMm) * fitScale,
      fontSizeMm: Number(line.settings.fontSizeMm) * (lockTextHeight ? 1 : fitScale),
    });
  });
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
    const detail = await response.text();
    throw new Error(detail ? `Layout analysis failed: ${detail}` : "Layout analysis failed");
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
    backingContext.lineWidth = backingMm * 2 * scale;
    drawScaledText(
      backingContext,
      letter.character,
      letter.x * scale,
      letter.y * scale,
      letter.fontSizeMm * scale,
      letter.fontId,
      letter.verticalScale ?? 1,
      "both",
    );
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
    drawScaledText(
      faceContext,
      letter.character,
      letter.x * scale,
      letter.y * scale,
      letter.fontSizeMm * scale,
      letter.fontId,
      letter.verticalScale ?? 1,
    );
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

  const savedBuild = getSavedCachedBuild(activeOrder);
  if (savedBuild && savedBuild.signature === signature) {
    renderPreviewFromLayout({
      ...savedBuild.layout,
      analysis: savedBuild.analysis,
    });
    updateConnectionStatusFromAnalysis(savedBuild.analysis);
    return;
  }

  const layout = buildOrderLayout(settings);
  renderPreviewFromLayout(layout);
  if (layout.fit.overflowsGuide) {
    updateConnectionStatus(
      "warning",
      "Guide overflow",
      "One or more locked lines are preserving their text height, so this design extends beyond the 2.2 in by 1.5 in guide.",
    );
    return;
  }
  updateConnectionStatus(
    "pending",
    "Complete to analyze connectedness",
    "Face analysis and cached export geometry run only when you click Complete.",
  );
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
    const cachedBuild = getSavedCachedBuild(order);
    if (!cachedBuild) {
      updateConnectionStatus(
        "warning",
        "Complete before exporting",
        "Click Complete to run face analysis and cache the export-ready geometry for this design.",
      );
      return;
    }

    await requestSvgExport({
      layout: buildExportPayload(cachedBuild.layout, cachedBuild.analysis, order.source),
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

async function copyCurrentSvg() {
  const order = getActiveOrder();
  if (!order || !lastLayout || !canCopySvgToClipboard()) {
    return;
  }

  copyButton.disabled = true;
  copyButton.textContent = "Copying...";
  copyButton.setAttribute("aria-busy", "true");

  try {
    order.text = textInput.value;
    order.settings = getCurrentSettings();
    const cachedBuild = getSavedCachedBuild(order);
    if (!cachedBuild) {
      updateConnectionStatus(
        "warning",
        "Complete before copying",
        "Click Complete to run face analysis and cache the export-ready geometry for this design.",
      );
      return;
    }

    const svgSource = await requestSvgSource({
      layout: buildExportPayload(cachedBuild.layout, cachedBuild.analysis, order.source),
    });
    await copySvgToClipboard(svgSource);
  } catch {
  } finally {
    copyButton.disabled = !order.text.trim() || !canCopySvgToClipboard();
    copyButton.textContent = "Copy This Design";
    copyButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

async function requestSvgSource({ layout = null, layouts = null }) {
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

  return response.text();
}

async function requestSvgExport({ layout = null, layouts = null, filename }) {
  const svgSource = await requestSvgSource({ layout, layouts });
  const blob = new Blob([svgSource], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function canCopySvgToClipboard() {
  if (!navigator.clipboard) {
    return false;
  }

  return Boolean(navigator.clipboard.write || navigator.clipboard.writeText);
}

async function copySvgToClipboard(svgSource) {
  if (!canCopySvgToClipboard()) {
    throw new Error("Clipboard copy is not available in this browser context.");
  }

  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    const clipboardItem = new ClipboardItem({
      "image/svg+xml": new Blob([svgSource], { type: "image/svg+xml" }),
      "text/plain": new Blob([svgSource], { type: "text/plain" }),
    });
    await navigator.clipboard.write([clipboardItem]);
    return;
  }

  await navigator.clipboard.writeText(svgSource);
}

async function exportAllOrders() {
  saveActiveOrderDraft();
  renderOrderList();

  const exportableOrders = orders.filter((order) => order.text.trim());
  if (!exportableOrders.length) {
    return;
  }

  const unsavedOrders = exportableOrders.filter((order) => !isOrderReadyForExport(order));
  if (unsavedOrders.length) {
    updateImportStatus(
      `Complete ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch export. Face analysis now runs only on Complete.`,
      "error",
    );
    renderOrderList();
    return;
  }

  exportCompletedButton.disabled = true;
  exportCompletedButton.textContent = "Exporting...";
  exportCompletedButton.setAttribute("aria-busy", "true");

  try {
    const builtLayouts = exportableOrders.map((order) => {
      const cachedBuild = getSavedCachedBuild(order);
      return {
        order,
        layout: cachedBuild.layout,
        analysis: cachedBuild.analysis,
      };
    });

    await requestSvgExport({
      layouts: builtLayouts.map(({ order, layout, analysis }) => buildExportPayload(layout, analysis, order.source)),
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

async function copyAllOrders() {
  saveActiveOrderDraft();
  renderOrderList();

  const exportableOrders = orders.filter((order) => order.text.trim());
  if (!exportableOrders.length || !canCopySvgToClipboard()) {
    return;
  }

  const unsavedOrders = exportableOrders.filter((order) => !isOrderReadyForExport(order));
  if (unsavedOrders.length) {
    updateImportStatus(
      `Complete ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch copy. Face analysis now runs only on Complete.`,
      "error",
    );
    renderOrderList();
    return;
  }

  copyCompletedButton.disabled = true;
  copyCompletedButton.textContent = "Copying...";
  copyCompletedButton.setAttribute("aria-busy", "true");

  try {
    const builtLayouts = exportableOrders.map((order) => {
      const cachedBuild = getSavedCachedBuild(order);
      return {
        order,
        layout: cachedBuild.layout,
        analysis: cachedBuild.analysis,
      };
    });

    const svgSource = await requestSvgSource({
      layouts: builtLayouts.map(({ order, layout, analysis }) => buildExportPayload(layout, analysis, order.source)),
    });
    await copySvgToClipboard(svgSource);
  } catch {
  } finally {
    copyCompletedButton.disabled = exportableOrders.length === 0 || !canCopySvgToClipboard();
    copyCompletedButton.textContent = "Copy All Designs";
    copyCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

function buildOrderLayout(settings) {
  const normalized = normalizeSettings(settings);
  const text = normalized.text.trim();
  const { lines } = measureTextLayoutForFit(normalized.text, normalized.lines);
  const fitScale = computeMixedFitScale(lines);
  const lineScaleFactors = computeLineScaleFactors(lines, fitScale);
  const scaledLineSettings = buildScaledLineSettings(lines, fitScale);
  const {
    lines: fittedLines,
    baseTextWidthMm,
    lineBounds,
    minLeftMm,
    minTopMm,
    textWidthMm,
    textHeightMm,
  } = measureTextLayoutForFit(normalized.text, scaledLineSettings);
  const scaledBackingMm = normalized.backingMm * fitScale;
  const scaledBleedMm = DESIGN_BLEED_MM * fitScale;
  const overflowsGuide = computeTextFitScale(textWidthMm, textHeightMm) < 1 - 1e-6;
  const widthMm = textWidthMm + scaledBackingMm * 2 + scaledBleedMm * 2;
  const heightMm = textHeightMm + scaledBackingMm * 2 + scaledBleedMm * 2;
  const absoluteLetters = lineBounds.flatMap(({ line, centeredLeftMm }) => {
    const font = getFontOption(line.settings.fontId);
    const rawLineX = scaledBleedMm + scaledBackingMm + centeredLeftMm - minLeftMm - line.mask.leftMm;
    const rawBaselineY = scaledBleedMm + scaledBackingMm + (line.y - minTopMm) + line.mask.baselineMm;

    return line.letters.map((letter) => ({
      character: letter.character,
      x: rawLineX + letter.x,
      y: rawBaselineY,
      fontId: line.settings.fontId,
      fontPath: font.exportPath,
      fontSizeMm: line.settings.fontSizeMm,
      verticalScale: line.settings.verticalScale,
    }));
  });

  return {
    text,
    widthMm,
    heightMm,
    backingMm: scaledBackingMm,
    weldExportedDesign: normalized.weldExportedDesign,
    textBoundsMm: {
      left: scaledBleedMm + scaledBackingMm,
      top: scaledBleedMm + scaledBackingMm,
      width: textWidthMm,
      height: textHeightMm,
    },
    fit: {
      fitScale,
      lineScaleFactors,
      overflowsGuide,
    },
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
copyCompletedButton.addEventListener("click", copyAllOrders);
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", captureActiveOrder);
downloadButton.addEventListener("click", downloadSvg);
copyButton.addEventListener("click", copyCurrentSvg);
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
await loadPresetRegistry();
renderPresetOptions();
updateBackingOutput();
const restoredQueue = loadPersistedQueueState();
if (restoredQueue) {
  updateImportStatus(`Restored ${orders.length} design${orders.length === 1 ? "" : "s"} from browser storage.`, "success");
} else {
  updateImportStatus("Import Etsy clipboard data copied from the browser helper.", "pending");
}
const defaultPresetId = getDefaultPresetId();
const defaultPresetBaseSettings = getPresetBaseSettings(defaultPresetId);

renderLineControls(normalizeSettings({
  text: "",
  presetId: defaultPresetId,
  backingMm: defaultPresetBaseSettings.backingMm,
  weldExportedDesign: defaultPresetBaseSettings.weldExportedDesign,
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
