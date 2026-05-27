import {
  computeGuideOverflow,
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
  getPresetDefinitionForEditor,
  getPresetGlobalDefaults,
  getPresetIdForListingId,
  getPresetOptions,
  getPresetSnapshot,
  hasPresetMappingForListingId,
  inferPresetDefinitionFromSettings,
  isValidPresetId,
  loadPresetRegistry,
  removeListingAssignment,
  savePresetDefinitionLocally,
  upsertListingAssignment,
} from "./presets.js";
import { savePresetSnapshot } from "./preset-api.js";
import { computeLineMaskMetrics } from "./text-metrics.js";
import {
  buildSettingsSignature,
  getSettingsSignatureCandidates,
} from "./order-signatures.js";
import {
  isQueueSnapshotEmpty,
} from "./queue-sync.js";
import { buildQueueSyncStatus } from "./queue-sync-status.js";
import {
  applyLayoutControlsSnapshot,
  buildLayoutControlsSnapshot,
} from "./layout-controls-clipboard.js";
import { buildReloadedPresetSettings } from "./preset-selection.js";
import {
  fetchSharedQueueSnapshot,
  fetchSharedSession,
  SharedQueueConflictError,
  saveSharedQueueSnapshot,
} from "./shared-queue-api.js";
import {
  chooseSharedQueueStartupState,
  createSharedQueueSnapshot,
} from "./shared-queue-model.js";

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
const PREVIEW_INNER_GUIDE_WIDTH_MM = 1.6 * 25.4;
const PREVIEW_INNER_GUIDE_HEIGHT_MM = 1.1 * 25.4;
const PREVIEW_INNER_GUIDE_INSET_X_MM = (PREVIEW_BOX_WIDTH_MM - PREVIEW_INNER_GUIDE_WIDTH_MM) / 2;
const PREVIEW_INNER_GUIDE_INSET_Y_MM = (PREVIEW_BOX_HEIGHT_MM - PREVIEW_INNER_GUIDE_HEIGHT_MM) / 2;
const DEFAULT_ZOOM = 3;
const DEFAULT_WELD_EXPORTED_DESIGN = true;
const WORKFLOW_ALERT_AUTOHIDE_MS = Object.freeze({
  pending: 3200,
  success: 3200,
  error: 4500,
});
const DEFAULT_LINE_SETTINGS = Object.freeze({
  fontId: "candlepin",
  bridgeMm: 0.5,
  lineBridgeMm: 0.5,
  offsetXMm: 0,
  fontSizeMm: 34,
  horizontalScale: 1,
  verticalScale: 1,
  lockTextHeight: false,
});
const PRESET_SYNC_LINE_SETTING_KEYS = Object.freeze([
  "fontId",
  "bridgeMm",
  "lineBridgeMm",
  "offsetXMm",
  "fontSizeMm",
  "horizontalScale",
  "verticalScale",
  "lockTextHeight",
]);

const appShell = document.querySelector(".app-shell");
const ordersWorkspace = document.querySelector("#ordersWorkspace");
const presetsWorkspace = document.querySelector("#presetsWorkspace");
const orderWorkspaceButton = document.querySelector("#orderWorkspaceButton");
const presetWorkspaceButton = document.querySelector("#presetWorkspaceButton");
const navCollapseButton = document.querySelector("#navCollapseButton");
const addOrderButton = document.querySelector("#addOrderButton");
const importClipboardButton = document.querySelector("#importClipboardButton");
const clearQueueButton = document.querySelector("#clearQueueButton");
const workflowAlert = document.querySelector("#importStatus");
const queueSyncStatus = document.querySelector("#queueSyncStatus");
const queueSyncStatusLabel = document.querySelector("#queueSyncStatusLabel");
const queueSyncStatusDetail = document.querySelector("#queueSyncStatusDetail");
const exportCompletedButton = document.querySelector("#exportCompletedButton");
const showColorCountsButton = document.querySelector("#showColorCountsButton");
const copyCompletedButton = document.querySelector("#copyCompletedButton");
const queueToolsMenu = document.querySelector(".queue-tools-menu");
const queueActionLabelByButton = new Map(
  [addOrderButton, importClipboardButton, clearQueueButton, showColorCountsButton, exportCompletedButton, copyCompletedButton]
    .filter(Boolean)
    .map((button) => [button, button.querySelector(".queue-tool-label")]),
);
const colorCountsDialog = document.querySelector("#colorCountsDialog");
const closeColorCountsButton = document.querySelector("#closeColorCountsButton");
const presetAssignmentDialog = document.querySelector("#presetAssignmentDialog");
const presetAssignmentDescription = document.querySelector("#presetAssignmentDescription");
const closePresetAssignmentDialogButton = document.querySelector("#closePresetAssignmentDialogButton");
const colorCountsTableBody = document.querySelector("#colorCountsTableBody");
const colorCountsTableWrap = document.querySelector("#colorCountsTableWrap");
const colorCountsEmptyState = document.querySelector("#colorCountsEmptyState");
const confirmationDialogElement = document.querySelector("#confirmationDialog");
const confirmationDialogTitle = document.querySelector("#confirmationDialogTitle");
const confirmationDialogDescription = document.querySelector("#confirmationDialogDescription");
const confirmationDialogCloseButton = document.querySelector("#confirmationDialogCloseButton");
const confirmationDialogCancelButton = document.querySelector("#confirmationDialogCancelButton");
const confirmationDialogConfirmButton = document.querySelector("#confirmationDialogConfirmButton");
const orderSearchInput = document.querySelector("#orderSearchInput");
const orderCountOutput = document.querySelector("#orderCountOutput");
const completeCountOutput = document.querySelector("#completeCountOutput");
const progressCountOutput = document.querySelector("#progressCountOutput");
const notStartedCountOutput = document.querySelector("#notStartedCountOutput");
const orderList = document.querySelector("#orderList");
const activeOrderName = document.querySelector("#activeOrderName");
const activeOrderMeta = document.querySelector("#activeOrderMeta");
const saveQueueButton = document.querySelector("#saveQueueButton");
const sharedQueueBanner = document.querySelector("#sharedQueueBanner");
const sharedQueueBannerLabel = document.querySelector("#sharedQueueBannerLabel");
const sharedQueueBannerDetail = document.querySelector("#sharedQueueBannerDetail");
const sharedQueueBannerAudit = document.querySelector("#sharedQueueBannerAudit");
const sharedQueueBannerReloadButton = document.querySelector("#sharedQueueBannerReloadButton");
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
const globalHorizontalScaleInput = document.querySelector("#globalHorizontalScaleInput");
const globalHorizontalScaleOutput = document.querySelector("#globalHorizontalScaleOutput");
const globalVerticalScaleInput = document.querySelector("#globalVerticalScaleInput");
const globalVerticalScaleOutput = document.querySelector("#globalVerticalScaleOutput");
const lineControls = document.querySelector("#lineControls");
const lineControlCards = document.querySelector("#lineControlCards");
const backingInput = document.querySelector("#backingInput");
const backingOutput = document.querySelector("#backingOutput");
const preview = document.querySelector("#preview");
const previewPanel = document.querySelector(".preview-panel");
const connectionStatus = document.querySelector("#connectionStatus");
const connectionStatusIndicator = document.querySelector("#connectionStatusIndicator");
const connectionStatusLabel = document.querySelector("#connectionStatusLabel");
const connectionStatusDetail = document.querySelector("#connectionStatusDetail");
const downloadButton = document.querySelector("#downloadButton");
const copyButton = document.querySelector("#copyButton");
const copyLayoutControlsButton = document.querySelector("#copyLayoutPlacementButton");
const pasteLayoutControlsButton = document.querySelector("#pasteLayoutPlacementButton");
const saveAsNewPresetButton = document.querySelector("#saveAsNewPresetButton");
const assignPresetToListingButton = document.querySelector("#assignPresetToListingButton");
const reloadPresetButton = document.querySelector("#reloadPresetButton");
const captureButton = document.querySelector("#captureButton");
const completeNextButton = document.querySelector("#completeNextButton");
const presetEditorSelect = document.querySelector("#presetEditorSelect");
const presetDraftNameInput = document.querySelector("#presetDraftName");
const savePresetButton = document.querySelector("#savePresetButton");
const presetWeldExportedDesignInput = document.querySelector("#presetWeldExportedDesignInput");
const presetGlobalHorizontalScaleInput = document.querySelector("#presetGlobalHorizontalScaleInput");
const presetGlobalHorizontalScaleOutput = document.querySelector("#presetGlobalHorizontalScaleOutput");
const presetGlobalVerticalScaleInput = document.querySelector("#presetGlobalVerticalScaleInput");
const presetGlobalVerticalScaleOutput = document.querySelector("#presetGlobalVerticalScaleOutput");
const presetBackingInput = document.querySelector("#presetBackingInput");
const presetBackingOutput = document.querySelector("#presetBackingOutput");
const presetLineRuleControls = document.querySelector("#presetLineRuleControls");
const presetAssignmentsList = document.querySelector("#presetAssignmentsList");
const presetAssignmentsEmptyState = document.querySelector("#presetAssignmentsEmptyState");
const presetEditorStatus = document.querySelector("#presetEditorStatus");
const editorActionLabelByButton = new Map(
  [saveQueueButton, captureButton, completeNextButton, copyButton, copyLayoutControlsButton, pasteLayoutControlsButton, downloadButton]
    .filter(Boolean)
    .map((button) => [button, button.querySelector(".editor-action-label")]),
);
let workflowAlertHideTimer = null;
let workflowAlertToken = 0;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const MASK_SCALE = 3;
const MASK_PADDING_PX = 12;
const measuredLineCache = new Map();
let lastLayout = null;
let zoom = DEFAULT_ZOOM;
let previewMiddlePan = null;
let orderSequence = 1;
let activeOrderId = null;
const orders = [];
let queuePersistenceTimeoutId = null;
let orderListRenderFrameId = null;
let deferredPreviewRenderToken = 0;
let suppressQueueSyncLocalNotice = false;
let copiedLayoutControlsSnapshot = null;
let activeWorkspace = "orders";
let navCollapsed = false;
let presetEditorDraft = null;
let activeConfirmationRequest = null;
let confirmationDialogRestoreFocusTarget = null;
let sharedSessionContext = null;
let sharedQueueContext = null;
let sharedQueueRecoveryDraft = null;
let sharedQueueAutosaveTimeoutId = null;
let sharedQueueAutosaveInFlight = false;
let sharedQueueAutosavePending = false;
let suppressSharedQueueAutosave = false;
let lastSharedQueueSaveKey = null;
let sharedQueueSyncState = "disabled";
let sharedQueueSyncDetail = "";
let sharedQueueConflictState = null;
let sharedQueueRecoveryState = null;
let sharedQueueRecoveryMarker = null;

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
    horizontalScale: DEFAULT_LINE_SETTINGS.horizontalScale,
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
    horizontalScale: Number.isFinite(Number(lineSettings.horizontalScale))
      ? Number(lineSettings.horizontalScale)
      : DEFAULT_LINE_SETTINGS.horizontalScale,
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

function buildPresetDraftNameFromOrder(order) {
  const summary = summarizeOrderText(order?.text || "");
  return summary === "No text entered"
    ? ""
    : summary.replaceAll("/", " ").replace(/\s+/g, " ").trim();
}

function generatePresetId() {
  const rawId = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    || `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `preset-${rawId.slice(0, 12)}`;
}

function createPresetEditorDraft(preset, options = {}) {
  const nextPreset = preset && typeof preset === "object"
    ? structuredClone(preset)
    : inferPresetDefinitionFromSettings({
        name: "",
        settings: {
          backingMm: DEFAULT_BACKING_MM,
          weldExportedDesign: DEFAULT_WELD_EXPORTED_DESIGN,
          lines: [],
        },
      });
  const resolvedPreset = options.generateNewId
    ? {
        ...nextPreset,
        id: generatePresetId(),
      }
    : nextPreset;
  const previousId = Object.hasOwn(options, "previousId")
    ? (typeof options.previousId === "string" && options.previousId.trim() ? options.previousId.trim() : null)
    : (typeof resolvedPreset.id === "string" && resolvedPreset.id.trim() ? resolvedPreset.id.trim() : null);

  return {
    previousId,
    preset: resolvedPreset,
  };
}

function setPresetEditorStatus(message, state = "pending") {
  if (!presetEditorStatus) {
    return;
  }

  presetEditorStatus.textContent = message;
  presetEditorStatus.dataset.state = state;
}

function updatePresetBackingOutput() {
  if (!presetBackingInput || !presetBackingOutput) {
    return;
  }

  presetBackingOutput.textContent = `${Number(presetBackingInput.value).toFixed(1)} mm`;
}

function updatePresetGlobalHorizontalScaleOutput() {
  if (!presetGlobalHorizontalScaleInput || !presetGlobalHorizontalScaleOutput) {
    return;
  }

  presetGlobalHorizontalScaleOutput.textContent = lineValueText("horizontalScale", presetGlobalHorizontalScaleInput.value);
}

function updatePresetGlobalVerticalScaleOutput() {
  if (!presetGlobalVerticalScaleInput || !presetGlobalVerticalScaleOutput) {
    return;
  }

  presetGlobalVerticalScaleOutput.textContent = lineValueText("verticalScale", presetGlobalVerticalScaleInput.value);
}

function normalizePresetGlobalDefaults(globalDefaults = {}) {
  return {
    backingMm: Number.isFinite(Number(globalDefaults.backingMm)) ? Number(globalDefaults.backingMm) : DEFAULT_BACKING_MM,
    weldExportedDesign: typeof globalDefaults.weldExportedDesign === "boolean"
      ? globalDefaults.weldExportedDesign
      : DEFAULT_WELD_EXPORTED_DESIGN,
  };
}

function mergePresetLineSettings(...sources) {
  return normalizeLineSettings(Object.assign({}, createDefaultLineSettings(), ...sources));
}

function findPresetRule(preset, match) {
  return (preset?.lineRules || []).find((rule) => {
    if (rule?.match?.kind !== match.kind) {
      return false;
    }

    if (match.kind === "index") {
      return Number(rule.match.lineIndex) === Number(match.lineIndex);
    }

    return true;
  }) || null;
}

function getPresetEditorLineGroups(preset) {
  const allRuleSettings = findPresetRule(preset, { kind: "all" })?.settings || {};
  const lineDefaults = mergePresetLineSettings(preset?.lineDefaults || {}, allRuleSettings);
  const first = mergePresetLineSettings(lineDefaults, findPresetRule(preset, { kind: "first" })?.settings || {});
  const remaining = mergePresetLineSettings(lineDefaults, findPresetRule(preset, { kind: "remaining" })?.settings || {});
  const indexOverrides = (preset?.lineRules || [])
    .filter((rule) => rule?.match?.kind === "index")
    .sort((left, right) => Number(left.match.lineIndex) - Number(right.match.lineIndex))
    .map((rule) => {
      const lineIndex = Number(rule.match.lineIndex);
      const base = lineIndex === 0 ? first : remaining;

      return {
        lineIndex,
        settings: mergePresetLineSettings(base, rule.settings || {}),
      };
    });

  return {
    lineDefaults,
    first,
    remaining,
    indexOverrides,
  };
}

function createPresetEditorFontField(ruleKey, fontId) {
  const label = document.createElement("label");
  label.className = "field compact-field";

  const span = document.createElement("span");
  span.textContent = "Font";

  const select = document.createElement("select");
  select.dataset.presetRuleKey = ruleKey;
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

function createPresetEditorRangeField(ruleKey, setting, labelText, min, max, step, value) {
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
  input.dataset.presetRuleKey = ruleKey;
  input.dataset.setting = setting;

  const output = document.createElement("output");
  output.textContent = lineValueText(setting, value);

  row.append(input, output);
  label.append(span, row);

  return label;
}

function createPresetEditorCheckboxField(ruleKey, setting, labelText, checked) {
  const label = document.createElement("label");
  label.className = "check-field line-control-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.dataset.presetRuleKey = ruleKey;
  input.dataset.setting = setting;

  const span = document.createElement("span");
  span.textContent = labelText;

  label.append(input, span);
  return label;
}

function createPresetEditorLineCard({ ruleKey, title, summary, settings, includeLineBridge }) {
  const card = document.createElement("section");
  card.className = "line-control-card";
  card.dataset.presetRuleKey = ruleKey;

  const header = document.createElement("div");
  header.className = "line-control-header";

  const titleNode = document.createElement("h3");
  titleNode.className = "preset-line-control-title";
  titleNode.textContent = title;

  const summaryNode = document.createElement("span");
  summaryNode.className = "line-control-text";
  summaryNode.textContent = summary;

  header.append(titleNode, summaryNode);
  card.append(header);

  const grid = document.createElement("div");
  grid.className = "line-control-grid";
  const fields = [
    createPresetEditorFontField(ruleKey, settings.fontId),
    createPresetEditorRangeField(ruleKey, "bridgeMm", "Letter Bridge", 0, 4, 0.1, settings.bridgeMm),
    createPresetEditorRangeField(ruleKey, "offsetXMm", "Horizontal Offset", -20, 20, 0.1, settings.offsetXMm),
    createPresetEditorRangeField(ruleKey, "fontSizeMm", "Text Height", 18, 55, 1, settings.fontSizeMm),
    createPresetEditorRangeField(ruleKey, "horizontalScale", "Horizontal Stretch", 0.75, 2, 0.01, settings.horizontalScale),
    createPresetEditorRangeField(ruleKey, "verticalScale", "Vertical Stretch", 0.75, 1.5, 0.01, settings.verticalScale),
    createPresetEditorCheckboxField(ruleKey, "lockTextHeight", "Lock Text Height", settings.lockTextHeight),
  ];

  if (includeLineBridge) {
    fields.splice(2, 0, createPresetEditorRangeField(ruleKey, "lineBridgeMm", "Line Bridge", 0, 8, 0.1, settings.lineBridgeMm));
  }

  grid.append(...fields);
  card.append(grid);

  return card;
}

function renderPresetEditorLineControls() {
  if (!presetLineRuleControls) {
    return;
  }

  presetLineRuleControls.replaceChildren();
  const groups = getPresetEditorLineGroups(presetEditorDraft?.preset || {});
  const cards = [
    createPresetEditorLineCard({
      ruleKey: "first",
      title: "First Line",
      summary: "Overrides applied to line 1",
      settings: groups.first,
      includeLineBridge: false,
    }),
    createPresetEditorLineCard({
      ruleKey: "remaining",
      title: "Remaining Lines",
      summary: "Overrides applied after line 1",
      settings: groups.remaining,
      includeLineBridge: true,
    }),
    ...groups.indexOverrides.map(({ lineIndex, settings }) => createPresetEditorLineCard({
      ruleKey: `index:${lineIndex}`,
      title: `Line ${lineIndex + 1} Override`,
      summary: `Exact override for line ${lineIndex + 1}`,
      settings,
      includeLineBridge: lineIndex > 0,
    })),
  ];

  presetLineRuleControls.append(...cards);
}

function readPresetEditorLineSettings(ruleKey) {
  const card = presetLineRuleControls?.querySelector(`[data-preset-rule-key="${ruleKey}"]`);
  if (!card) {
    return createDefaultLineSettings();
  }

  const fontSelect = card.querySelector('[data-setting="fontId"]');
  const bridgeInput = card.querySelector('[data-setting="bridgeMm"]');
  const lineBridgeInput = card.querySelector('[data-setting="lineBridgeMm"]');
  const offsetXInput = card.querySelector('[data-setting="offsetXMm"]');
  const fontSizeInput = card.querySelector('[data-setting="fontSizeMm"]');
  const horizontalScaleInput = card.querySelector('[data-setting="horizontalScale"]');
  const verticalScaleInput = card.querySelector('[data-setting="verticalScale"]');
  const lockTextHeightInput = card.querySelector('[data-setting="lockTextHeight"]');

  return normalizeLineSettings({
    fontId: fontSelect?.value,
    bridgeMm: bridgeInput?.value,
    lineBridgeMm: lineBridgeInput?.value,
    offsetXMm: offsetXInput?.value,
    fontSizeMm: fontSizeInput?.value,
    horizontalScale: horizontalScaleInput?.value,
    verticalScale: verticalScaleInput?.value,
    lockTextHeight: lockTextHeightInput?.checked,
  });
}

function diffPresetLineSettings(base, next) {
  return PRESET_SYNC_LINE_SETTING_KEYS.reduce((result, key) => {
    if (base[key] !== next[key]) {
      result[key] = next[key];
    }
    return result;
  }, {});
}

function syncPresetEditorDraftFromControls() {
  if (!presetEditorDraft) {
    return;
  }

  const currentPreset = presetEditorDraft.preset || {};
  const first = readPresetEditorLineSettings("first");
  const remaining = readPresetEditorLineSettings("remaining");
  const lineDefaults = normalizeLineSettings({
    ...remaining,
    horizontalScale: presetGlobalHorizontalScaleInput?.value ?? remaining.horizontalScale,
    verticalScale: presetGlobalVerticalScaleInput?.value ?? remaining.verticalScale,
  });
  const indexOverrides = Array.from(presetLineRuleControls?.querySelectorAll("[data-preset-rule-key^=\"index:\"]") || [])
    .map((card) => Number(card.dataset.presetRuleKey.split(":")[1]))
    .filter((lineIndex) => Number.isInteger(lineIndex))
    .sort((left, right) => left - right)
    .map((lineIndex) => ({
      lineIndex,
      settings: readPresetEditorLineSettings(`index:${lineIndex}`),
    }));

  const lineRules = [];
  const firstDiff = diffPresetLineSettings(lineDefaults, first);
  const remainingDiff = diffPresetLineSettings(lineDefaults, remaining);
  if (Object.keys(firstDiff).length) {
    lineRules.push({
      match: { kind: "first" },
      settings: firstDiff,
    });
  }
  if (Object.keys(remainingDiff).length) {
    lineRules.push({
      match: { kind: "remaining" },
      settings: remainingDiff,
    });
  }

  indexOverrides.forEach(({ lineIndex, settings }) => {
    const base = lineIndex === 0 ? first : remaining;
    const diff = diffPresetLineSettings(base, settings);
    if (Object.keys(diff).length) {
      lineRules.push({
        match: { kind: "index", lineIndex },
        settings: diff,
      });
    }
  });

  presetEditorDraft = {
    ...presetEditorDraft,
    preset: {
      ...currentPreset,
      globalDefaults: {
        ...currentPreset.globalDefaults,
        ...normalizePresetGlobalDefaults({
          backingMm: presetBackingInput?.value,
          weldExportedDesign: presetWeldExportedDesignInput?.checked,
        }),
      },
      lineDefaults,
      lineRules: lineRules.length
        ? lineRules
        : [{ match: { kind: "all" }, settings: {} }],
    },
  };
}

function renderPresetEditorOptions(selectedPresetId = "") {
  if (!presetEditorSelect) {
    return;
  }

  presetEditorSelect.replaceChildren();

  const draftOption = document.createElement("option");
  draftOption.value = "";
  draftOption.textContent = "New preset draft";
  presetEditorSelect.append(draftOption);

  getPresetOptions().forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    presetEditorSelect.append(option);
  });

  presetEditorSelect.value = selectedPresetId && isValidPresetId(selectedPresetId)
    ? selectedPresetId
    : "";
}

function renderPresetEditorDraft() {
  if (!presetEditorDraft) {
    presetEditorDraft = createPresetEditorDraft(null, { previousId: null, generateNewId: true });
  }

  const selectedPresetId = presetEditorDraft.previousId && isValidPresetId(presetEditorDraft.previousId)
    ? presetEditorDraft.previousId
    : "";

  renderPresetEditorOptions(selectedPresetId);

  const draftName = typeof presetEditorDraft.preset?.name === "string"
    ? presetEditorDraft.preset.name
    : "";
  const globalDefaults = normalizePresetGlobalDefaults(presetEditorDraft.preset?.globalDefaults || {});
  const lineGroups = getPresetEditorLineGroups(presetEditorDraft.preset || {});
  presetDraftNameInput.value = draftName;
  if (presetWeldExportedDesignInput) {
    presetWeldExportedDesignInput.checked = globalDefaults.weldExportedDesign;
  }
  if (presetGlobalHorizontalScaleInput) {
    presetGlobalHorizontalScaleInput.value = String(lineGroups.lineDefaults.horizontalScale);
  }
  if (presetGlobalVerticalScaleInput) {
    presetGlobalVerticalScaleInput.value = String(lineGroups.lineDefaults.verticalScale);
  }
  if (presetBackingInput) {
    presetBackingInput.value = String(globalDefaults.backingMm);
  }
  updatePresetGlobalHorizontalScaleOutput();
  updatePresetGlobalVerticalScaleOutput();
  updatePresetBackingOutput();
  renderPresetEditorLineControls();
  savePresetButton.disabled = false;
  renderPresetAssignmentList();
}

function renderPresetAssignmentList() {
  if (!presetAssignmentsList || !presetAssignmentsEmptyState) {
    return;
  }

  presetAssignmentsList.replaceChildren();
  const assignments = Array.isArray(presetEditorDraft?.preset?.listingAssignments)
    ? presetEditorDraft.preset.listingAssignments
    : [];

  if (!assignments.length) {
    presetAssignmentsEmptyState.hidden = false;
    return;
  }

  presetAssignmentsEmptyState.hidden = true;

  assignments.forEach((assignment) => {
    const row = document.createElement("article");
    row.className = "preset-assignment-row";

    const copy = document.createElement("div");
    copy.className = "preset-assignment-copy";

    const name = document.createElement("p");
    name.className = "preset-assignment-name";
    name.textContent = assignment.name?.trim() || `Listing ${assignment.listingId}`;

    const listingId = document.createElement("p");
    listingId.className = "preset-assignment-id";
    listingId.textContent = `Listing ID ${assignment.listingId}`;

    copy.append(name, listingId);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button preset-assignment-button";
    button.dataset.listingAssignmentId = assignment.listingId;
    button.textContent = "Unassign";
    button.setAttribute("aria-label", `Unassign listing ${assignment.listingId}`);

    row.append(copy, button);
    presetAssignmentsList.append(row);
  });
}

function lineSettingsMatch(left = {}, right = {}) {
  return PRESET_SYNC_LINE_SETTING_KEYS.every((key) => left[key] === right[key]);
}

function rewriteSignaturePresetId(signature, previousId, nextId) {
  if (typeof signature !== "string" || !signature || !previousId || !nextId || previousId === nextId) {
    return signature;
  }

  try {
    const parsed = JSON.parse(signature);
    if (!parsed || typeof parsed !== "object" || parsed.presetId !== previousId) {
      return signature;
    }

    return JSON.stringify({
      ...parsed,
      presetId: nextId,
    });
  } catch {
    return signature;
  }
}

function migrateOrderPresetReference(order, previousId, nextId) {
  if (!order || !previousId || !nextId || previousId === nextId) {
    return false;
  }

  const rawPresetId = typeof order.settings?.presetId === "string"
    ? order.settings.presetId
    : "";

  if (rawPresetId !== previousId) {
    return false;
  }

  order.settings = {
    ...normalizeSettings({
      ...order.settings,
      presetId: previousId,
    }),
    presetId: nextId,
  };
  order.savedSettingsSignature = rewriteSignaturePresetId(order.savedSettingsSignature, previousId, nextId);
  order.completedSettingsSignature = rewriteSignaturePresetId(order.completedSettingsSignature, previousId, nextId);
  order.pendingAnalysisSignature = rewriteSignaturePresetId(order.pendingAnalysisSignature, previousId, nextId);
  if (order.cachedBuild?.signature) {
    order.cachedBuild.signature = rewriteSignaturePresetId(order.cachedBuild.signature, previousId, nextId);
  }
  if (order.previousCompletedBuild?.signature) {
    order.previousCompletedBuild.signature = rewriteSignaturePresetId(order.previousCompletedBuild.signature, previousId, nextId);
  }
  return true;
}

function migratePresetReferences(previousId, nextId) {
  if (!previousId || !nextId || previousId === nextId) {
    return false;
  }

  let activeOrderChanged = false;

  orders.forEach((order) => {
    if (migrateOrderPresetReference(order, previousId, nextId) && order.id === activeOrderId) {
      activeOrderChanged = true;
    }
  });

  if (activeOrderChanged) {
    const activeOrder = getActiveOrder();
    if (activeOrder) {
      applySettings(activeOrder.settings);
    }
  } else if (presetInput.value === previousId) {
    presetInput.value = nextId;
  }

  return activeOrderChanged;
}

function syncPresetEditorDraftFromInputs() {
  if (!presetEditorDraft) {
    return;
  }

  const name = presetDraftNameInput.value;
  presetEditorDraft = {
    ...presetEditorDraft,
    preset: {
      ...presetEditorDraft.preset,
      name,
    },
  };
}

function loadPresetEditorDraftFromRegistry(presetId) {
  const preset = getPresetDefinitionForEditor(presetId);
  if (!preset) {
    setPresetEditorStatus("Choose a saved preset to edit.", "error");
    return;
  }

  presetEditorDraft = createPresetEditorDraft(preset, { previousId: presetId });
  renderPresetEditorDraft();
  setPresetEditorStatus(`Editing ${preset.name}.`, "pending");
}

function openPresetEditorForNewPreset() {
  const activeOrder = getActiveOrder();
  if (!activeOrder) {
    updateWorkflowAlert("Add or select a design before saving a preset.", "error");
    return;
  }

  const draftName = buildPresetDraftNameFromOrder(activeOrder);
  const preset = inferPresetDefinitionFromSettings({
    name: draftName,
    settings: getCurrentSettings(),
  });

  presetEditorDraft = createPresetEditorDraft({
    ...preset,
    name: draftName,
  }, { previousId: null, generateNewId: true });
  renderPresetEditorDraft();
  setActiveWorkspace("presets");
  setPresetEditorStatus("Preset draft ready from the current order settings.", "pending");
}

async function persistPresetEditorDraft({ syncInputs = false, successMessage } = {}) {
  if (!presetEditorDraft) {
    return false;
  }

  const previousId = presetEditorDraft.previousId;
  if (syncInputs) {
    syncPresetEditorDraftFromInputs();
  }
  syncPresetEditorDraftFromControls();
  const preset = presetEditorDraft.preset;

  if (!preset.name.trim()) {
    setPresetEditorStatus("Preset name is required.", "error");
    return false;
  }

  if (!preset.id) {
    setPresetEditorStatus("Preset id must include at least one letter or number.", "error");
    return false;
  }

  savePresetButton.disabled = true;
  setPresetEditorStatus("Saving preset...", "pending");

  try {
    const localPayload = savePresetDefinitionLocally({
      preset,
      previousId,
    });
    const savedPresetId = localPayload?.preset?.id || preset.id;
    const activeOrderChanged = migratePresetReferences(previousId, savedPresetId);
    renderPresetOptions();
    presetEditorDraft = createPresetEditorDraft(
      getPresetDefinitionForEditor(savedPresetId) || { ...preset, id: savedPresetId },
      { previousId: savedPresetId },
    );
    renderPresetEditorDraft();
    if (activeOrderChanged) {
      const activeOrder = getActiveOrder();
      if (activeOrder) {
        applySettings(activeOrder.settings);
      }
    }
    renderOrderList();
    persistQueueState();
    render();
    try {
      await savePresetSnapshot(getPresetSnapshot());
      setPresetEditorStatus(successMessage || `Saved ${presetEditorDraft.preset.name}.`, "success");
    } catch (error) {
      setPresetEditorStatus(
        error instanceof Error
          ? `Saved locally. Neon sync failed: ${error.message}`
          : "Saved locally, but Neon sync failed.",
        "error",
      );
    }
    return true;
  } catch (error) {
    setPresetEditorStatus(error instanceof Error ? error.message : "Unable to save preset.", "error");
    savePresetButton.disabled = false;
    return false;
  }
}

async function savePresetEditorDraft() {
  await persistPresetEditorDraft({ syncInputs: true });
}

async function unassignListingFromPreset(listingId) {
  if (!presetEditorDraft?.previousId || !listingId) {
    return;
  }

  const previousDraft = structuredClone(presetEditorDraft);
  const nextPreset = removeListingAssignment({
    preset: presetEditorDraft.preset,
    listingId,
  });
  presetEditorDraft = {
    ...presetEditorDraft,
    preset: nextPreset,
  };
  renderPresetEditorDraft();
  setPresetEditorStatus(`Saving listing assignment changes for ${nextPreset.name}...`, "pending");
  const saved = await persistPresetEditorDraft({
    successMessage: `Unassigned listing ${listingId} from ${nextPreset.name}.`,
  });
  if (!saved) {
    presetEditorDraft = previousDraft;
    renderPresetEditorDraft();
    return;
  }

  if (syncOrdersForListingAssignmentChange(listingId)) {
    renderOrderList();
    persistQueueState();
    render();
  }
}

async function assignSelectedPresetToActiveListing() {
  const activeOrder = getActiveOrder();
  const listingId = activeOrder?.source?.listingId?.trim();
  if (!activeOrder || !listingId) {
    updateWorkflowAlert("Import an Etsy listing before assigning a preset.", "error");
    return;
  }

  const selectedPresetId = presetInput.value;
  const draftName = buildPresetDraftNameFromOrder(activeOrder) || `Listing ${listingId}`;
  const basePreset = getPresetDefinitionForEditor(selectedPresetId)
    || inferPresetDefinitionFromSettings({
      name: draftName,
      settings: getCurrentSettings(),
    });
  const normalizedPreset = {
    ...basePreset,
    id: basePreset.id || generatePresetId(),
    name: (basePreset.name || draftName).trim(),
  };
  const assignedPreset = upsertListingAssignment({
    preset: normalizedPreset,
    assignment: {
      listingId,
      name: activeOrder.source?.listingTitle?.trim() || `Listing ${listingId}`,
    },
  });

  try {
    savePresetDefinitionLocally({
      preset: assignedPreset,
      previousId: getPresetDefinitionForEditor(selectedPresetId) ? selectedPresetId : null,
    });
    renderPresetOptions();
    if (presetEditorDraft?.previousId === selectedPresetId) {
      presetEditorDraft = createPresetEditorDraft(assignedPreset, { previousId: assignedPreset.id });
      renderPresetEditorDraft();
    }
    activeOrder.source.manualPresetOverride = false;
    activeOrder.settings = buildPresetSynchronizedSettings(activeOrder.settings, assignedPreset.id, {
      listingId,
    });
    applySettings(activeOrder.settings);
    updateActiveOrderFromControls();
    render();
    try {
      await savePresetSnapshot(getPresetSnapshot());
      showPresetAssignmentDialog({
        presetName: assignedPreset.name,
        listingId,
      });
      updateWorkflowAlert(`Assigned ${assignedPreset.name} to listing ${listingId}.`, "success");
    } catch (error) {
      updateWorkflowAlert(
        error instanceof Error
          ? `Assigned ${assignedPreset.name} locally. Neon sync failed: ${error.message}`
          : `Assigned ${assignedPreset.name} locally, but Neon sync failed.`,
        "error",
      );
    }
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to assign preset.", "error");
  }
}

function buildManualDesignName(order) {
  const index = orders.findIndex((candidate) => candidate.id === order?.id);
  return `Design ${index >= 0 ? index + 1 : orderSequence}`;
}

function buildAuditActorLabel(actor) {
  const name = actor?.name?.trim();
  const email = actor?.email?.trim();
  return name || email || "";
}

function formatAuditTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(timestamp);
}

function buildLastUpdatedText(source) {
  const actorLabel = buildAuditActorLabel(source?.updatedBy);
  const timestampLabel = formatAuditTimestamp(source?.updatedAt);

  if (actorLabel && timestampLabel) {
    return `Last updated by ${actorLabel} at ${timestampLabel}.`;
  }

  if (actorLabel) {
    return `Last updated by ${actorLabel}.`;
  }

  if (timestampLabel) {
    return `Last updated at ${timestampLabel}.`;
  }

  return "";
}

function getSharedQueueAuditSource(order = getActiveOrder()) {
  if (order && (order.updatedBy || order.updatedAt)) {
    return order;
  }

  if (sharedQueueContext && (sharedQueueContext.updatedBy || sharedQueueContext.updatedAt)) {
    return sharedQueueContext;
  }

  return null;
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
  const listingTitle = order?.source?.listingTitle?.trim();
  if (listingTitle) {
    return listingTitle;
  }

  const listingId = order?.source?.listingId?.trim();
  return listingId ? `Listing ${listingId}` : buildActiveMeta(order);
}

function buildQueuePersonalization(order) {
  const personalization = summarizeOrderText(order?.text || "");
  return personalization && personalization !== "No text entered"
    ? personalization
    : "No personalization entered";
}

function parseColorCountQuantity(order) {
  const quantityText = order?.source?.quantity?.trim() || "";
  const quantity = Number.parseInt(quantityText, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function buildBatchColorCounts() {
  const countsByColor = new Map();

  orders.forEach((order) => {
    const colorName = order?.source?.colorName?.trim() || "";
    if (!colorName) {
      return;
    }

    const nextCount = (countsByColor.get(colorName) || 0) + parseColorCountQuantity(order);
    countsByColor.set(colorName, nextCount);
  });

  return [...countsByColor.entries()]
    .map(([colorName, count]) => ({ colorName, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.colorName.localeCompare(right.colorName);
    });
}

function renderBatchColorCountsDialog() {
  if (!colorCountsTableBody || !colorCountsTableWrap || !colorCountsEmptyState) {
    return [];
  }

  const colorCounts = buildBatchColorCounts();
  colorCountsTableBody.replaceChildren();

  colorCounts.forEach(({ colorName, count }) => {
    const row = document.createElement("tr");
    const colorCell = document.createElement("td");
    const countCell = document.createElement("td");

    colorCell.textContent = colorName;
    countCell.textContent = String(count);
    countCell.className = "queue-summary-count";

    row.append(colorCell, countCell);
    colorCountsTableBody.append(row);
  });

  const hasCounts = colorCounts.length > 0;
  colorCountsTableWrap.hidden = !hasCounts;
  colorCountsEmptyState.hidden = hasCounts;
  return colorCounts;
}

function openBatchColorCountsDialog() {
  if (!(colorCountsDialog instanceof HTMLDialogElement)) {
    return;
  }

  renderBatchColorCountsDialog();
  colorCountsDialog.showModal();
}

function closeBatchColorCountsDialog() {
  if (!(colorCountsDialog instanceof HTMLDialogElement) || !colorCountsDialog.open) {
    return;
  }

  colorCountsDialog.close();
}

function showInlineConfirmationDialog() {
  if (!confirmationDialogElement) {
    return;
  }

  confirmationDialogRestoreFocusTarget = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  confirmationDialogElement.setAttribute("aria-hidden", "false");
  confirmationDialogCancelButton?.focus();
}

function hideInlineConfirmationDialog({ restoreFocus = true } = {}) {
  if (!confirmationDialogElement) {
    return;
  }

  confirmationDialogElement.setAttribute("aria-hidden", "true");
  if (restoreFocus && confirmationDialogRestoreFocusTarget instanceof HTMLElement) {
    confirmationDialogRestoreFocusTarget.focus();
  }
  confirmationDialogRestoreFocusTarget = null;
}

function finishConfirmationDialog(result, { hide = true } = {}) {
  if (!activeConfirmationRequest) {
    return;
  }

  const { resolve } = activeConfirmationRequest;
  activeConfirmationRequest = null;
  confirmationDialogConfirmButton?.classList.remove("confirmation-dialog-confirm-danger");

  if (hide) {
    hideInlineConfirmationDialog();
  }

  resolve(result);
}

function showConfirmationDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
}) {
  if (!confirmationDialogElement
    || !confirmationDialogTitle
    || !confirmationDialogDescription
    || !confirmationDialogCloseButton
    || !confirmationDialogCancelButton
    || !confirmationDialogConfirmButton) {
    return Promise.resolve(window.confirm(description));
  }

  if (activeConfirmationRequest) {
    finishConfirmationDialog(false);
  }

  confirmationDialogTitle.textContent = title;
  confirmationDialogDescription.textContent = description;
  confirmationDialogCancelButton.textContent = cancelLabel;
  confirmationDialogConfirmButton.textContent = confirmLabel;
  confirmationDialogConfirmButton.classList.toggle("confirmation-dialog-confirm-danger", isDanger);

  return new Promise((resolve) => {
    activeConfirmationRequest = { resolve };
    showInlineConfirmationDialog();
  });
}

function showPresetAssignmentDialog({ presetName, listingId }) {
  if (!(presetAssignmentDialog instanceof HTMLDialogElement)) {
    return;
  }

  if (presetAssignmentDescription) {
    presetAssignmentDescription.textContent = `${presetName} linked to listing ${listingId}.`;
  }

  presetAssignmentDialog.showModal();
}

function closePresetAssignmentDialog() {
  if (!(presetAssignmentDialog instanceof HTMLDialogElement) || !presetAssignmentDialog.open) {
    return;
  }

  presetAssignmentDialog.close();
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

function normalizeStoredAuditActor(actor) {
  if (!actor || typeof actor !== "object") {
    return null;
  }

  const name = typeof actor.name === "string" ? actor.name.trim() : "";
  const email = typeof actor.email === "string" ? actor.email.trim() : "";

  if (!name && !email) {
    return null;
  }

  return {
    ...(structuredClone(actor)),
    name,
    email,
  };
}

function normalizeStoredRevision(revision) {
  const parsedRevision = Number(revision);
  return Number.isFinite(parsedRevision) ? parsedRevision : null;
}

function normalizeStoredUpdatedAt(updatedAt) {
  if (typeof updatedAt !== "string" || !updatedAt.trim()) {
    return null;
  }

  const normalized = updatedAt.trim();
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function normalizeSharedQueueRecoveryMarker(marker) {
  if (!marker || typeof marker !== "object") {
    return null;
  }

  if (marker.reason !== "shared-queue-conflict") {
    return null;
  }

  const preservedAt = normalizeStoredUpdatedAt(marker.preservedAt);
  const conflictOrderId = typeof marker.conflictOrderId === "string" ? marker.conflictOrderId.trim() : "";
  const queueId = typeof marker.queueId === "string" ? marker.queueId.trim() : "";
  const workspaceId = typeof marker.workspaceId === "string" ? marker.workspaceId.trim() : "";

  return {
    reason: "shared-queue-conflict",
    preservedAt,
    conflictOrderId,
    queueId,
    workspaceId,
  };
}

function doesRecoveryMarkerMatchQueue(marker, queue) {
  if (!marker || !queue) {
    return false;
  }

  const markerQueueId = typeof marker.queueId === "string" ? marker.queueId.trim() : "";
  const markerWorkspaceId = typeof marker.workspaceId === "string" ? marker.workspaceId.trim() : "";
  const queueId = typeof queue.id === "string" ? queue.id.trim() : "";
  const workspaceId = typeof queue.workspaceId === "string" ? queue.workspaceId.trim() : "";

  return Boolean(
    markerQueueId
    && markerWorkspaceId
    && queueId
    && workspaceId
    && markerQueueId === queueId
    && markerWorkspaceId === workspaceId
  );
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
  let completedSettingsSignature = normalizeStoredSignature(order.completedSettingsSignature);
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
  const completedSettingsBuild = getStoredBuildForSignature(
    cachedBuild,
    previousCompletedBuild,
    completedSettingsSignature,
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

    if (completedSettingsSignature === abandonedPendingSignature) {
      completedSettingsSignature = pendingCompletedBuild?.signature || null;
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

  if (!completedSettingsSignature && (status === "captured" || status === "exported")) {
    completedSettingsSignature = savedSettingsSignature || currentSignature;
  }

  if (
    completedSettingsSignature
    && !settingsSignatureMatches(settings, completedSettingsSignature)
    && status === "not-started"
  ) {
    completedSettingsSignature = null;
  }

  if (
    status === "in-progress"
    && completedSettingsSignature
    && settingsSignatureMatches(settings, completedSettingsSignature)
    && !completedSettingsBuild
  ) {
    completedSettingsSignature = null;
  }

  return {
    id: typeof order.id === "string" && order.id.trim() ? order.id : crypto.randomUUID(),
    revision: normalizeStoredRevision(order.revision),
    updatedAt: normalizeStoredUpdatedAt(order.updatedAt),
    updatedBy: normalizeStoredAuditActor(order.updatedBy),
    text,
    status,
    settings,
    source: normalizeStoredSource(order.source),
    capturedLayout: null,
    cachedBuild: effectiveCachedBuild,
    previousCompletedBuild: effectivePreviousCompletedBuild,
    savedSettingsSignature,
    completedSettingsSignature,
    analysisBadge,
    analysisState: "idle",
    pendingAnalysisSignature: null,
    pendingAnalysisRequestId: null,
  };
}

function normalizeSharedQueueContext(queue) {
  if (!queue || typeof queue !== "object") {
    return null;
  }

  const id = typeof queue.id === "string" ? queue.id.trim() : "";
  const workspaceId = typeof queue.workspaceId === "string" ? queue.workspaceId.trim() : "";

  if (!id || !workspaceId) {
    return null;
  }

  return {
    ...structuredClone(queue),
    id,
    workspaceId,
  };
}

function setSharedQueueContext(queue) {
  sharedQueueContext = normalizeSharedQueueContext(queue);
}

function buildSerializedQueueOrders() {
  return orders.map((order) => ({
    id: order.id,
    revision: order.revision,
    updatedAt: order.updatedAt,
    updatedBy: order.updatedBy ? structuredClone(order.updatedBy) : null,
    text: order.text,
    status: order.status,
    settings: normalizeSettings(order.settings),
    source: order.source ? { ...order.source } : null,
    cachedBuild: order.cachedBuild ? structuredClone(order.cachedBuild) : null,
    previousCompletedBuild: order.previousCompletedBuild ? structuredClone(order.previousCompletedBuild) : null,
    savedSettingsSignature: order.savedSettingsSignature,
    completedSettingsSignature: order.completedSettingsSignature,
    analysisBadge: order.analysisBadge ? structuredClone(order.analysisBadge) : null,
    pendingAnalysisSignature: order.pendingAnalysisSignature,
  }));
}

function buildPersistedQueueState() {
  return {
    version: STORAGE_VERSION,
    orderSequence,
    queue: sharedQueueContext ? structuredClone(sharedQueueContext) : null,
    recoveryDraftMeta: sharedQueueRecoveryMarker ? structuredClone(sharedQueueRecoveryMarker) : null,
    recoveryDraftSnapshot: sharedQueueRecoveryDraft ? structuredClone(sharedQueueRecoveryDraft) : null,
    activeOrderId,
    orders: buildSerializedQueueOrders(),
  };
}

function buildSharedQueueSnapshot() {
  return createSharedQueueSnapshot({
    queue: sharedQueueContext ? structuredClone(sharedQueueContext) : null,
    activeOrderId,
    orders: buildSerializedQueueOrders(),
  });
}

function applySharedQueueAuditToOrder(order, auditSource) {
  if (!order || !auditSource || typeof auditSource !== "object") {
    return;
  }

  order.revision = normalizeStoredRevision(auditSource.revision);
  order.updatedAt = normalizeStoredUpdatedAt(auditSource.updatedAt);
  order.updatedBy = normalizeStoredAuditActor(auditSource.updatedBy);
}

function mergeSharedQueueAuditFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.orders)) {
    return;
  }

  for (const remoteOrder of snapshot.orders) {
    const localOrder = orders.find((order) => order.id === remoteOrder?.id);
    if (!localOrder) {
      continue;
    }

    applySharedQueueAuditToOrder(localOrder, remoteOrder);
  }
}

function setSharedQueueSyncState(mode, detail = "") {
  sharedQueueSyncState = mode;
  sharedQueueSyncDetail = typeof detail === "string" ? detail.trim() : "";

  if (mode !== "enabled") {
    clearSharedQueueAutosaveTimeout();
    sharedQueueAutosavePending = false;
  }
}

function enableSharedQueueSync(queue = sharedQueueContext) {
  if (queue) {
    setSharedQueueContext(queue);
  }

  if (hasSharedQueueSyncContext()) {
    setSharedQueueSyncState("enabled");
    return true;
  }

  setSharedQueueSyncState("disabled");
  return false;
}

function disableSharedQueueSync(detail = "Shared queue sync is unavailable.") {
  setSharedQueueSyncState("local-recovery", detail);
}

function isSharedQueueSyncEnabled() {
  return sharedQueueSyncState === "enabled" && hasSharedQueueSyncContext();
}

function canAttemptSharedQueueSave() {
  return hasSharedQueueSyncContext()
    && (sharedQueueSyncState === "enabled" || sharedQueueSyncState === "recovery-review");
}

function hasSharedQueueSyncContext() {
  return Boolean(sharedQueueContext?.id && sharedQueueContext?.workspaceId);
}

function buildSharedQueueSaveKey(snapshot) {
  if (!snapshot) {
    return null;
  }

  try {
    return JSON.stringify(snapshot);
  } catch {
    return null;
  }
}

function hasPendingSharedQueueChanges() {
  if (!isSharedQueueSyncEnabled()) {
    return false;
  }

  const snapshotKey = buildSharedQueueSaveKey(buildSharedQueueSnapshot());
  return Boolean(snapshotKey && snapshotKey !== lastSharedQueueSaveKey);
}

function clearSharedQueueAutosaveTimeout() {
  if (sharedQueueAutosaveTimeoutId != null) {
    window.clearTimeout(sharedQueueAutosaveTimeoutId);
    sharedQueueAutosaveTimeoutId = null;
  }
}

async function flushSharedQueueAutosave(options = {}) {
  const { force = false, keepalive = false } = options;
  const allowConcurrentKeepalive = force && keepalive;
  clearSharedQueueAutosaveTimeout();

  if (
    ((!sharedQueueAutosavePending && !force) || (sharedQueueAutosaveInFlight && !allowConcurrentKeepalive) || suppressSharedQueueAutosave || !isSharedQueueSyncEnabled())
  ) {
    if (!sharedQueueAutosaveInFlight) {
      sharedQueueAutosavePending = false;
    }
    return;
  }

  sharedQueueAutosavePending = false;
  const autosaveWasAlreadyInFlight = sharedQueueAutosaveInFlight;
  if (!autosaveWasAlreadyInFlight) {
    sharedQueueAutosaveInFlight = true;
  }

  try {
    await saveQueueSnapshotToRemote({
      persistActiveDraft: false,
      successMessage: false,
      keepalive,
      degradeOnFailure: !keepalive,
    });
  } finally {
    if (!autosaveWasAlreadyInFlight) {
      sharedQueueAutosaveInFlight = false;
    }
    if (sharedQueueAutosavePending && !autosaveWasAlreadyInFlight) {
      triggerSharedQueueAutosave();
    }
  }
}

function triggerSharedQueueAutosave(options = {}) {
  const { immediate = false } = options;

  if (suppressSharedQueueAutosave || !isSharedQueueSyncEnabled()) {
    return;
  }

  sharedQueueAutosavePending = true;

  if (sharedQueueAutosaveInFlight) {
    return;
  }

  clearSharedQueueAutosaveTimeout();

  if (immediate) {
    void flushSharedQueueAutosave();
    return;
  }

  sharedQueueAutosaveTimeoutId = window.setTimeout(() => {
    sharedQueueAutosaveTimeoutId = null;
    void flushSharedQueueAutosave();
  }, 150);
}

function updateQueueSyncStatus(kind, options = {}) {
  if (!queueSyncStatus || !queueSyncStatusLabel || !queueSyncStatusDetail) {
    return;
  }

  const status = buildQueueSyncStatus(kind, options);
  if (!status) {
    queueSyncStatus.hidden = true;
    queueSyncStatusLabel.textContent = "";
    queueSyncStatusDetail.textContent = "";
    queueSyncStatus.classList.remove("status-ok", "status-warning", "status-pending");
    return;
  }

  queueSyncStatus.hidden = false;
  queueSyncStatus.classList.remove("status-ok", "status-warning", "status-pending");
  queueSyncStatus.classList.add(`status-${status.tone}`);
  queueSyncStatusLabel.textContent = status.label;
  queueSyncStatusDetail.textContent = status.detail;
}

function renderSharedQueueBanner(activeOrder = getActiveOrder()) {
  if (!sharedQueueBanner || !sharedQueueBannerLabel || !sharedQueueBannerDetail || !sharedQueueBannerAudit || !sharedQueueBannerReloadButton) {
    return;
  }

  const auditSource = sharedQueueConflictState?.auditSource || getSharedQueueAuditSource(activeOrder);
  const auditText = buildLastUpdatedText(auditSource);
  let tone = "pending";
  let label = "";
  let detail = "";
  let actionLabel = "";

  if (sharedQueueConflictState) {
    tone = "warning";
    label = "Save conflict";
    detail = sharedQueueConflictState.detail;
    actionLabel = "Reload Shared Queue";
  } else if (sharedQueueRecoveryState === "available" && sharedQueueRecoveryDraft) {
    tone = "warning";
    label = "Local recovery draft available";
    detail = "A newer shared revision was loaded. Review your saved local draft if you still need those edits.";
    actionLabel = "Review Local Draft";
  } else if (sharedQueueRecoveryState === "active") {
    tone = "warning";
    label = "Recovered local draft";
    detail = "Review this local draft, then click Save to retry it against the shared queue.";
  } else if (sharedQueueSyncState === "local-recovery") {
    tone = "warning";
    label = "Local recovery only";
    detail = sharedQueueSyncDetail || "Shared queue sync is unavailable in this browser right now.";
  } else if (isSharedQueueSyncEnabled()) {
    label = "Shared queue connected";
    detail = "Save pushes this queue back to the shared workspace.";
  } else {
    sharedQueueBanner.hidden = true;
    sharedQueueBannerLabel.textContent = "";
    sharedQueueBannerDetail.textContent = "";
    sharedQueueBannerAudit.textContent = "";
    sharedQueueBannerReloadButton.hidden = true;
    sharedQueueBanner.classList.remove("status-ok", "status-warning", "status-pending");
    return;
  }

  sharedQueueBanner.hidden = false;
  sharedQueueBanner.classList.remove("status-ok", "status-warning", "status-pending");
  sharedQueueBanner.classList.add(`status-${tone}`);
  sharedQueueBannerLabel.textContent = label;
  sharedQueueBannerDetail.textContent = detail;
  sharedQueueBannerAudit.textContent = auditText;
  sharedQueueBannerAudit.hidden = !auditText;
  sharedQueueBannerReloadButton.hidden = !actionLabel;
  sharedQueueBannerReloadButton.textContent = actionLabel;
}

function applyPersistedQueueState(parsed) {
  if (!parsed || !Array.isArray(parsed.orders)) {
    return false;
  }

  sharedQueueRecoveryMarker = normalizeSharedQueueRecoveryMarker(parsed.recoveryDraftMeta);
  setSharedQueueContext(parsed.queue || sharedQueueContext || sharedSessionContext?.queue || null);
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
}

function persistQueueState(options = {}) {
  const { skipRemoteSave = false } = options;

  try {
    if (!orders.length) {
      localStorage.removeItem(STORAGE_KEY);
      if (!suppressQueueSyncLocalNotice) {
        updateQueueSyncStatus("empty");
      }
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistedQueueState()));
      if (!suppressQueueSyncLocalNotice) {
        if (sharedQueueSyncState === "local-recovery") {
          updateQueueSyncStatus("local-recovery", { count: orders.length, detail: sharedQueueSyncDetail });
        } else if (!isSharedQueueSyncEnabled()) {
          updateQueueSyncStatus("local-only", { count: orders.length });
        }
      }
    }
  } catch {
    // Ignore storage failures and continue with in-memory editing.
  }

  if (!skipRemoteSave) {
    triggerSharedQueueAutosave();
  }
}

function schedulePersistQueueState(options = {}) {
  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
  }

  queuePersistenceTimeoutId = window.setTimeout(() => {
    queuePersistenceTimeoutId = null;
    persistQueueState(options);
  }, 150);
}

function flushPersistQueueState(options = {}) {
  const { keepalive = false } = options;

  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
    queuePersistenceTimeoutId = null;
  }

  persistQueueState({ skipRemoteSave: true });
  if (keepalive && hasPendingSharedQueueChanges()) {
    void flushSharedQueueAutosave({ force: true, keepalive: true });
    return;
  }

  triggerSharedQueueAutosave({ immediate: true });
}

function flushLocalQueuePersistence() {
  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
    queuePersistenceTimeoutId = null;
  }

  persistQueueState({ skipRemoteSave: true });
}

function restoreSharedQueueRecoveryDraft() {
  if (!sharedQueueRecoveryDraft || !applyPersistedQueueState(sharedQueueRecoveryDraft)) {
    return;
  }

  sharedQueueConflictState = null;
  sharedQueueRecoveryState = "active";
  sharedQueueRecoveryMarker = null;
  sharedQueueRecoveryDraft = null;
  setSharedQueueSyncState("recovery-review");

  const activeOrder = getActiveOrder();
  if (activeOrder) {
    applySettings(activeOrder.settings);
  } else {
    resetEditorToEmptyState();
  }

  suppressQueueSyncLocalNotice = true;
  suppressSharedQueueAutosave = true;
  persistQueueState({ skipRemoteSave: true });
  suppressSharedQueueAutosave = false;
  suppressQueueSyncLocalNotice = false;

  renderOrderList();
  scheduleDeferredPreviewRender();
}

async function saveCurrentQueueManually() {
  const activeOrder = getActiveOrder();
  if (!activeOrder || !saveQueueButton) {
    return;
  }

  saveQueueButton.disabled = true;
  saveQueueButton.setAttribute("aria-busy", "true");
  setEditorActionLabel(saveQueueButton, "Saving...");

  try {
    saveActiveOrderDraft();
    clearSharedQueueAutosaveTimeout();
    sharedQueueAutosavePending = false;
    flushLocalQueuePersistence();

    if (!canAttemptSharedQueueSave()) {
      updateWorkflowAlert("Saved in this browser. Shared queue sync is currently unavailable.", "pending");
      return;
    }

    await saveQueueSnapshotToRemote({
      persistActiveDraft: false,
      successMessage: "Shared queue saved.",
    });
  } finally {
    saveQueueButton.removeAttribute("aria-busy");
    setEditorActionLabel(saveQueueButton, "Save");
    saveQueueButton.disabled = !getActiveOrder();
    renderSharedQueueBanner();
  }
}

function reloadSharedQueueFromBanner() {
  if (sharedQueueRecoveryState === "available") {
    restoreSharedQueueRecoveryDraft();
    return;
  }

  saveActiveOrderDraft();
  clearSharedQueueAutosaveTimeout();
  sharedQueueAutosavePending = false;
  flushLocalQueuePersistence();
  window.location.reload();
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

function scheduleDeferredPreviewRender() {
  const renderToken = ++deferredPreviewRenderToken;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (renderToken !== deferredPreviewRenderToken) {
        return;
      }

      render();
    });
  });
}

function clearPersistedQueueState() {
  if (queuePersistenceTimeoutId != null) {
    window.clearTimeout(queuePersistenceTimeoutId);
    queuePersistenceTimeoutId = null;
  }
  clearSharedQueueAutosaveTimeout();
  sharedQueueAutosavePending = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures and continue with in-memory editing.
  }
}

function readPersistedQueueState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.orders)) {
      clearPersistedQueueState();
      return null;
    }

    return parsed;
  } catch {
    clearPersistedQueueState();
    return null;
  }
}

function loadPersistedQueueState() {
  return applyPersistedQueueState(readPersistedQueueState());
}

async function saveQueueSnapshotToRemote(options = {}) {
  const {
    persistActiveDraft = true,
    successMessage = null,
    keepalive = false,
    degradeOnFailure = true,
  } = options;
  let snapshot = null;

  if (persistActiveDraft) {
    saveActiveOrderDraft();
  }

  try {
    snapshot = buildSharedQueueSnapshot();
    const snapshotKey = buildSharedQueueSaveKey(snapshot);

    if (!canAttemptSharedQueueSave() || !snapshot.queue?.id || !snapshot.queue?.workspaceId) {
      return;
    }

    if (snapshotKey && snapshotKey === lastSharedQueueSaveKey) {
      return;
    }

    const savedSnapshot = await saveSharedQueueSnapshot(snapshot, { keepalive });
    if (savedSnapshot?.queue) {
      enableSharedQueueSync(savedSnapshot.queue);
    }
    mergeSharedQueueAuditFromSnapshot(savedSnapshot);
    sharedQueueConflictState = null;
    sharedQueueRecoveryState = null;
    sharedQueueRecoveryMarker = null;
    sharedQueueRecoveryDraft = null;
    lastSharedQueueSaveKey = buildSharedQueueSaveKey(buildSharedQueueSnapshot());
    suppressQueueSyncLocalNotice = true;
    suppressSharedQueueAutosave = true;
    persistQueueState({ skipRemoteSave: true });
    suppressSharedQueueAutosave = false;
    suppressQueueSyncLocalNotice = false;

    if (isQueueSnapshotEmpty(savedSnapshot || snapshot)) {
      updateQueueSyncStatus("empty");
      return;
    }

    if (typeof successMessage === "string" && successMessage.trim()) {
      updateWorkflowAlert(successMessage.trim(), "success");
    }
    updateQueueSyncStatus("saved-remote", { count: (savedSnapshot || snapshot).orders.length });
  } catch (error) {
    suppressSharedQueueAutosave = false;
    suppressQueueSyncLocalNotice = false;
    const isConflictError = error instanceof SharedQueueConflictError;
    if (isConflictError) {
      const conflictingOrder = orders.find((order) => order.id === error.details?.orderId) || getActiveOrder();
      if (conflictingOrder) {
        applySharedQueueAuditToOrder(conflictingOrder, error.details);
      }
      sharedQueueRecoveryMarker = {
        reason: "shared-queue-conflict",
        preservedAt: new Date().toISOString(),
        conflictOrderId: typeof error.details?.orderId === "string" ? error.details.orderId : "",
        queueId: typeof snapshot.queue?.id === "string" ? snapshot.queue.id : "",
        workspaceId: typeof snapshot.queue?.workspaceId === "string" ? snapshot.queue.workspaceId : "",
      };
      sharedQueueRecoveryDraft = structuredClone(buildPersistedQueueState());
      sharedQueueRecoveryState = null;
      sharedQueueConflictState = {
        detail: "Another browser or user updated this design first. Reload the shared queue to compare the newer revision with your local draft.",
        auditSource: error.details && typeof error.details === "object" ? structuredClone(error.details) : null,
      };
      persistQueueState({ skipRemoteSave: true });
      renderSharedQueueBanner();
      return;
    }

    if (degradeOnFailure && !isConflictError) {
      disableSharedQueueSync(
        error instanceof Error && error.message
          ? `Shared queue sync is unavailable. ${error.message}`
          : "Shared queue sync is unavailable.",
      );
      persistQueueState({ skipRemoteSave: true });
    }
    sharedQueueConflictState = null;
    sharedQueueRecoveryState = null;
    sharedQueueRecoveryMarker = null;
    renderSharedQueueBanner();
    updateWorkflowAlert(
      error instanceof Error ? error.message : "Unable to save the shared queue.",
      "error",
    );
  }
}

async function restoreInitialQueueState() {
  const localSnapshot = readPersistedQueueState();
  const localRecoveryMarker = normalizeSharedQueueRecoveryMarker(localSnapshot?.recoveryDraftMeta);
  let sharedSession = null;
  let remoteSnapshot = null;
  let sharedSyncUnavailable = false;
  sharedQueueConflictState = null;
  sharedQueueRecoveryState = null;

  try {
    sharedSession = await fetchSharedSession();
    sharedSessionContext = sharedSession;
    if (sharedSession?.queue) {
      enableSharedQueueSync(sharedSession.queue);
    } else {
      setSharedQueueContext(localSnapshot?.queue || null);
      setSharedQueueSyncState("disabled");
    }
  } catch (error) {
    sharedSessionContext = null;
    setSharedQueueContext(localSnapshot?.queue || null);
    disableSharedQueueSync(
      error instanceof Error && error.message
        ? `Shared queue sync is unavailable. ${error.message}`
        : "Shared queue sync is unavailable.",
    );
    sharedSyncUnavailable = true;
  }

  if (sharedSession?.queue?.id) {
    try {
      remoteSnapshot = await fetchSharedQueueSnapshot(sharedSession.queue.id);
    } catch (error) {
      disableSharedQueueSync(
        error instanceof Error && error.message
          ? `Shared queue sync is unavailable. ${error.message}`
          : "Shared queue sync is unavailable.",
      );
      sharedSyncUnavailable = true;
    }
  }

  const startupState = chooseSharedQueueStartupState({
    remoteSnapshot,
    localCache: localSnapshot,
  });
  const initialSnapshot = startupState.snapshot;
  const currentRecoveryQueue = sharedSession?.queue || initialSnapshot?.queue || null;
  const hasMatchingRecoveryMarker = doesRecoveryMarkerMatchQueue(localRecoveryMarker, currentRecoveryQueue);
  const storedRecoveryDraftSnapshot = localSnapshot?.recoveryDraftSnapshot;
  sharedQueueRecoveryDraft = hasMatchingRecoveryMarker
    ? structuredClone(storedRecoveryDraftSnapshot || startupState.recoveryDraft)
    : null;
  if (startupState.source === "remote" && sharedQueueRecoveryDraft) {
    sharedQueueRecoveryState = "available";
    sharedQueueRecoveryMarker = structuredClone(localRecoveryMarker);
  }

  if (initialSnapshot?.queue) {
    setSharedQueueContext(initialSnapshot.queue);
  }

  if (!initialSnapshot || !applyPersistedQueueState(initialSnapshot)) {
    if (startupState.source === "remote" && sharedQueueRecoveryDraft && localRecoveryMarker) {
      sharedQueueRecoveryMarker = structuredClone(localRecoveryMarker);
    }
    suppressQueueSyncLocalNotice = true;
    persistQueueState({ skipRemoteSave: true });
    suppressQueueSyncLocalNotice = false;
    lastSharedQueueSaveKey = null;
    updateQueueSyncStatus("empty");
    return {
      source: startupState.source,
      count: 0,
    };
  }

  if (startupState.source === "remote" && sharedQueueRecoveryDraft && localRecoveryMarker) {
    sharedQueueRecoveryMarker = structuredClone(localRecoveryMarker);
  }
  suppressQueueSyncLocalNotice = true;
  persistQueueState({ skipRemoteSave: true });
  suppressQueueSyncLocalNotice = false;
  lastSharedQueueSaveKey = startupState.source === "remote"
    ? buildSharedQueueSaveKey(buildSharedQueueSnapshot())
    : null;

  if (startupState.source === "remote") {
    updateQueueSyncStatus("restored-remote", { count: orders.length });
  } else if (sharedQueueSyncState === "local-recovery") {
    updateQueueSyncStatus("local-recovery", { count: orders.length });
  } else if (startupState.source === "local-cache") {
    updateQueueSyncStatus("restored-local", { count: orders.length });
  }

  if (sharedSyncUnavailable && !orders.length) {
    updateWorkflowAlert("Shared queue sync is unavailable. Local recovery mode is ready if you make changes.", "pending");
  }

  return {
    source: startupState.source,
    count: orders.length,
  };
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
    revision: null,
    updatedAt: null,
    updatedBy: null,
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
    completedSettingsSignature: null,
    analysisBadge: null,
    analysisState: "idle",
    pendingAnalysisSignature: null,
    pendingAnalysisRequestId: null,
  };
}

function buildPresetSynchronizedSettings(settings, presetId, options = {}) {
  return buildReloadedPresetSettings({
    settings,
    presetId,
    listingId: options.listingId ?? null,
    normalizeSettings,
    getPresetBaseSettings,
    buildPresetLines,
    createDefaultLineSettings,
    getRawTextLines,
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
  const expectedSettings = buildPresetSynchronizedSettings(order.settings, presetId, {
    listingId: order.source?.listingId,
  });

  if (normalized.presetId !== expectedSettings.presetId) {
    return true;
  }

  if (normalized.backingMm !== expectedSettings.backingMm) {
    return true;
  }

  if (normalized.weldExportedDesign !== expectedSettings.weldExportedDesign) {
    return true;
  }

  if (normalized.lines.length !== expectedSettings.lines.length) {
    return true;
  }

  return expectedSettings.lines.some((expectedLine, index) => !lineSettingsMatch(normalized.lines[index], expectedLine));
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

function syncOrdersForListingAssignmentChange(listingId) {
  if (!listingId) {
    return false;
  }

  let activeOrderChanged = false;
  let queueChanged = false;

  orders.forEach((order) => {
    if (
      order?.source?.listingId !== listingId
      || order.source?.manualPresetOverride
    ) {
      return;
    }

    const nextPresetId = getMappedPresetIdForOrder(order) || getDefaultPresetId();
    const nextSettings = buildPresetSynchronizedSettings(order.settings, nextPresetId, {
      listingId,
    });

    if (settingsSignatureMatches(order.settings, buildSettingsSignature(nextSettings))) {
      return;
    }

    clearOrderCompletionState(order, nextSettings);
    queueChanged = true;
    activeOrderChanged = activeOrderChanged || order.id === activeOrderId;
  });

  if (activeOrderChanged) {
    const activeOrder = getActiveOrder();
    if (activeOrder) {
      applySettings(activeOrder.settings);
    }
  }

  return queueChanged;
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

function updateWorkflowAlert(message, state = "pending", options = {}) {
  const hasMessage = typeof message === "string" && message.trim().length > 0;

  if (workflowAlertHideTimer) {
    window.clearTimeout(workflowAlertHideTimer);
    workflowAlertHideTimer = null;
  }

  workflowAlertToken += 1;
  const currentToken = workflowAlertToken;
  workflowAlert.hidden = !hasMessage;
  workflowAlert.textContent = hasMessage ? message : "";
  workflowAlert.dataset.state = state;

  if (!hasMessage) {
    return;
  }

  const autoHideMs = typeof options.autoHideMs === "number"
    ? options.autoHideMs
    : WORKFLOW_ALERT_AUTOHIDE_MS[state] ?? WORKFLOW_ALERT_AUTOHIDE_MS.pending;

  if (autoHideMs <= 0) {
    return;
  }

  workflowAlertHideTimer = window.setTimeout(() => {
    if (currentToken !== workflowAlertToken) {
      return;
    }

    updateWorkflowAlert("", state, { autoHideMs: 0 });
  }, autoHideMs);
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

function startPreviewMiddlePan(event) {
  if (event.button !== 1) {
    return;
  }

  event.preventDefault();
  previewMiddlePan = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  previewPanel.classList.add("is-middle-panning");
}

function updatePreviewMiddlePan(event) {
  if (!previewMiddlePan) {
    return;
  }

  const deltaX = event.clientX - previewMiddlePan.clientX;
  const deltaY = event.clientY - previewMiddlePan.clientY;
  previewPanel.scrollLeft -= deltaX;
  previewPanel.scrollTop -= deltaY;
  previewMiddlePan.clientX = event.clientX;
  previewMiddlePan.clientY = event.clientY;
}

function endPreviewMiddlePan() {
  if (!previewMiddlePan) {
    return;
  }

  previewMiddlePan = null;
  previewPanel.classList.remove("is-middle-panning");
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
  const leftInnerX = previewBoxX + PREVIEW_INNER_GUIDE_INSET_X_MM;
  const rightInnerX = previewBoxX + PREVIEW_BOX_WIDTH_MM - PREVIEW_INNER_GUIDE_INSET_X_MM;
  const topInnerY = previewBoxY + PREVIEW_INNER_GUIDE_INSET_Y_MM;
  const bottomInnerY = previewBoxY + PREVIEW_BOX_HEIGHT_MM - PREVIEW_INNER_GUIDE_INSET_Y_MM;
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
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: leftInnerX,
      y1: previewBoxY,
      x2: leftInnerX,
      y2: previewBoxY + PREVIEW_BOX_HEIGHT_MM,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: rightInnerX,
      y1: previewBoxY,
      x2: rightInnerX,
      y2: previewBoxY + PREVIEW_BOX_HEIGHT_MM,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: topInnerY,
      x2: previewBoxX + PREVIEW_BOX_WIDTH_MM,
      y2: topInnerY,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: bottomInnerY,
      x2: previewBoxX + PREVIEW_BOX_WIDTH_MM,
      y2: bottomInnerY,
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

function renderAnalysisIndicator(container, analysisSummary) {
  if (!container) {
    return;
  }

  container.replaceChildren();
  container.className = `order-analysis-indicator${analysisSummary ? ` ${analysisSummary.state}` : ""}${analysisSummary ? "" : " is-hidden"}`;
  container.setAttribute("aria-hidden", analysisSummary ? "false" : "true");
  container.removeAttribute("title");
  container.removeAttribute("aria-label");

  if (!analysisSummary) {
    return;
  }

  if (analysisSummary.state === "running") {
    const spinner = document.createElement("span");
    spinner.className = "order-analysis-spinner";
    spinner.setAttribute("aria-hidden", "true");
    container.append(spinner);
  } else if (analysisSummary.state === "ok") {
    const icon = document.createElement("span");
    icon.className = "order-analysis-icon";
    icon.textContent = "\u2713";
    container.append(icon);
  } else if (analysisSummary.state === "warning") {
    const icon = document.createElement("span");
    icon.className = "order-analysis-icon";
    icon.textContent = "\u26A0";
    container.append(icon);

    const count = document.createElement("span");
    count.className = "order-analysis-count";
    count.textContent = analysisSummary.shortLabel;
    container.append(count);
  }

  if (analysisSummary.fullLabel) {
    container.setAttribute("title", analysisSummary.fullLabel);
    container.setAttribute("aria-label", analysisSummary.fullLabel);
  }
}

function updateConnectionStatus(state, label, detail, analysisSummary = null) {
  connectionStatus.className = `status-card status-${state}`;
  connectionStatusLabel.textContent = label;
  connectionStatusDetail.textContent = detail;
  renderAnalysisIndicator(connectionStatusIndicator, analysisSummary);
}

function lineValueText(setting, value) {
  if (setting === "fontSizeMm") {
    return `${Number(value).toFixed(0)} mm`;
  }

  if (setting === "verticalScale") {
    return `${Math.round(Number(value) * 100)}%`;
  }

  if (setting === "horizontalScale") {
    return `${Math.round(Number(value) * 100)}%`;
  }

  return `${Number(value).toFixed(1)} mm`;
}

function updateBackingOutput() {
  backingOutput.textContent = `${Number(backingInput.value).toFixed(1)} mm`;
}

function updateRangeOutputForInput(input) {
  if (!(input instanceof HTMLInputElement) || input.type !== "range") {
    return;
  }

  const output = input.parentElement?.querySelector("output");
  if (!output) {
    return;
  }

  output.textContent = input.id === "presetBackingInput"
    ? `${Number(input.value).toFixed(1)} mm`
    : lineValueText(input.dataset.setting || "", input.value);
}

function summarizeHorizontalScale(lines = []) {
  if (!lines.length) {
    return {
      value: DEFAULT_LINE_SETTINGS.horizontalScale,
      mixed: false,
    };
  }

  const values = lines.map((line) => normalizeLineSettings(line).horizontalScale);
  const first = values[0];

  return {
    value: first,
    mixed: values.some((value) => Math.abs(value - first) > 1e-6),
  };
}

function summarizeVerticalScale(lines = []) {
  if (!lines.length) {
    return {
      value: DEFAULT_LINE_SETTINGS.verticalScale,
      mixed: false,
    };
  }

  const values = lines.map((line) => normalizeLineSettings(line).verticalScale);
  const first = values[0];

  return {
    value: first,
    mixed: values.some((value) => Math.abs(value - first) > 1e-6),
  };
}

function updateGlobalHorizontalScaleControl(settings = getCurrentSettings()) {
  if (!globalHorizontalScaleInput || !globalHorizontalScaleOutput) {
    return;
  }

  const normalized = normalizeSettings(settings);
  const { value, mixed } = summarizeHorizontalScale(normalized.lines);
  globalHorizontalScaleInput.value = String(value);
  globalHorizontalScaleOutput.textContent = mixed ? "Mixed" : lineValueText("horizontalScale", value);
}

function updateGlobalVerticalScaleControl(settings = getCurrentSettings()) {
  if (!globalVerticalScaleInput || !globalVerticalScaleOutput) {
    return;
  }

  const normalized = normalizeSettings(settings);
  const { value, mixed } = summarizeVerticalScale(normalized.lines);
  globalVerticalScaleInput.value = String(value);
  globalVerticalScaleOutput.textContent = mixed ? "Mixed" : lineValueText("verticalScale", value);
}

function setQueueActionLabel(button, label) {
  const labelNode = queueActionLabelByButton.get(button);
  if (labelNode) {
    labelNode.textContent = label;
    return;
  }

  button.textContent = label;
}

function setEditorActionLabel(button, label) {
  const labelNode = editorActionLabelByButton.get(button);
  if (labelNode) {
    labelNode.textContent = label;
    return;
  }

  button.textContent = label;
}

function renderLineControls(settings = getCurrentSettings()) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);
  lineControlCards.replaceChildren();

  if (!rawLines.length) {
    const empty = document.createElement("p");
    empty.className = "line-control-empty";
    empty.textContent = "Add text lines to generate one font and slider group per line.";
    lineControlCards.append(empty);
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
      createRangeField(index, "horizontalScale", "Horizontal Stretch", 0.75, 2, 0.01, line.horizontalScale),
      createRangeField(index, "verticalScale", "Vertical Stretch", 0.75, 1.5, 0.01, line.verticalScale),
      createCheckboxField(index, "lockTextHeight", "Lock Text Height", line.lockTextHeight),
    ];

    if (index > 0) {
      fields.splice(2, 0, createRangeField(index, "lineBridgeMm", "Line Bridge", 0, 8, 0.1, line.lineBridgeMm));
    }

    grid.append(...fields);

    card.append(grid);
    lineControlCards.append(card);
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
    const lineCard = lineControlCards.querySelector(`[data-line-index="${index}"]`);
    if (!lineCard) {
      return createPresetLineSettings(presetId, index, { listingId });
    }

    const fontSelect = lineCard.querySelector('[data-setting="fontId"]');
    const bridgeInput = lineCard.querySelector('[data-setting="bridgeMm"]');
    const lineBridgeInput = lineCard.querySelector('[data-setting="lineBridgeMm"]');
    const offsetXInput = lineCard.querySelector('[data-setting="offsetXMm"]');
    const fontSizeInput = lineCard.querySelector('[data-setting="fontSizeMm"]');
    const horizontalScaleInput = lineCard.querySelector('[data-setting="horizontalScale"]');
    const verticalScaleInput = lineCard.querySelector('[data-setting="verticalScale"]');
    const lockTextHeightInput = lineCard.querySelector('[data-setting="lockTextHeight"]');

    return normalizeLineSettings({
      fontId: fontSelect?.value,
      bridgeMm: bridgeInput?.value,
      lineBridgeMm: lineBridgeInput?.value,
      offsetXMm: offsetXInput?.value,
      fontSizeMm: fontSizeInput?.value,
      horizontalScale: horizontalScaleInput?.value,
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
  updateGlobalHorizontalScaleControl(normalized);
  updateGlobalVerticalScaleControl(normalized);
}

function applyPresetSelection(presetId) {
  const currentSettings = getCurrentSettings();
  const activeOrder = getActiveOrder();
  const nextSettings = buildReloadedPresetSettings({
    settings: currentSettings,
    presetId,
    listingId: activeOrder?.source?.listingId ?? null,
    normalizeSettings,
    getPresetBaseSettings,
    buildPresetLines,
    createDefaultLineSettings,
    getRawTextLines,
  });

  applySettings(nextSettings);
  render();
  updateActiveOrderFromControls();
}

function getActiveOrder() {
  return orders.find((order) => order.id === activeOrderId) || null;
}

function getNextIncompleteOrder(orderId) {
  const activeIndex = orders.findIndex((candidate) => candidate.id === orderId);
  if (activeIndex < 0) {
    return null;
  }

  const orderedCandidates = [...orders.slice(activeIndex + 1), ...orders.slice(0, activeIndex)];
  return orderedCandidates.find((candidate) => candidate.status !== "captured" && candidate.status !== "exported") || null;
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

function clearOrderCompletionState(order, settings = order?.settings) {
  if (!order) {
    return;
  }

  order.settings = normalizeSettings(settings);
  order.text = order.settings.text;
  order.status = "in-progress";
  order.capturedLayout = null;
  order.cachedBuild = null;
  order.previousCompletedBuild = null;
  order.savedSettingsSignature = null;
  order.completedSettingsSignature = null;
  order.analysisBadge = null;
  order.analysisState = "idle";
  order.pendingAnalysisSignature = null;
  order.pendingAnalysisRequestId = null;
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
  schedulePersistQueueState();
}

function canCopyLayoutControls(order) {
  return Boolean(order);
}

function canPasteLayoutControls(order) {
  return Boolean(
    order
    && copiedLayoutControlsSnapshot
    && copiedLayoutControlsSnapshot.sourceOrderId !== order.id,
  );
}

function buildLayoutControlsPasteAlert({
  changed,
  sourceLabel,
  targetLabel,
  sourceLineCount,
  targetLineCount,
  appliedLineCount,
}) {
  const baseMessage = changed
    ? `Pasted layout controls from ${sourceLabel} onto ${targetLabel}.`
    : `Layout controls already match on ${targetLabel}.`;

  if (sourceLineCount > targetLineCount) {
    return `${baseMessage} Applied ${appliedLineCount} of ${sourceLineCount} source lines; extra source lines were not pasted.`;
  }

  return baseMessage;
}

function copyActiveLayoutControls() {
  const order = getActiveOrder();
  if (!canCopyLayoutControls(order)) {
    return;
  }

  order.text = textInput.value;
  order.settings = normalizeSettings(getCurrentSettings());
  copiedLayoutControlsSnapshot = buildLayoutControlsSnapshot({
    id: order.id,
    label: buildQueueOrderNumber(order),
    settings: order.settings,
  });
  updateWorkflowAlert(`Copied layout controls from ${buildQueueOrderNumber(order)}.`, "success");
  renderOrderList();
}

function pasteLayoutControlsIntoActiveOrder() {
  const order = getActiveOrder();
  if (!canPasteLayoutControls(order)) {
    return;
  }

  const currentSettings = normalizeSettings(getCurrentSettings());
  const { settings: nextSettings, appliedLineCount } = applyLayoutControlsSnapshot(currentSettings, copiedLayoutControlsSnapshot);
  const sourceLabel = copiedLayoutControlsSnapshot.sourceOrderLabel || "the copied design";
  const sourceLineCount = Array.isArray(copiedLayoutControlsSnapshot?.settings?.lines)
    ? copiedLayoutControlsSnapshot.settings.lines.length
    : 0;
  const targetLineCount = currentSettings.lines.length;
  const changed = buildSettingsSignature(nextSettings) !== buildSettingsSignature(currentSettings);
  const alertMessage = buildLayoutControlsPasteAlert({
    changed,
    sourceLabel,
    targetLabel: buildQueueOrderNumber(order),
    sourceLineCount,
    targetLineCount,
    appliedLineCount,
  });

  if (order.source) {
    order.source.manualPresetOverride = true;
  }

  order.text = currentSettings.text;
  order.settings = nextSettings;
  applySettings(order.settings);
  updateActiveOrderFromControls();
  render();
  updateWorkflowAlert(alertMessage, "success");
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
  const savedCompletedBuild = getBuildForSignature(order, order.savedSettingsSignature);
  const preservesPendingGeometry = order.pendingAnalysisSignature === currentSignature && !matchingCompletedBuild;

  if (matchingCompletedBuild) {
    order.savedSettingsSignature = matchingCompletedBuild.signature;
    order.completedSettingsSignature = matchingCompletedBuild.signature;
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
    order.completedSettingsSignature = currentSignature;
    order.analysisBadge = {
      state: "running",
      shortLabel: "",
      fullLabel: "Analysis running",
    };
  } else {
    order.status = "in-progress";
    order.analysisState = "idle";
    order.analysisBadge = null;
    if (
      order.completedSettingsSignature
      && settingsSignatureMatches(order.settings, order.completedSettingsSignature)
    ) {
      order.completedSettingsSignature = savedCompletedBuild?.signature || null;
    }
    if (!savedCompletedBuild) {
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

function getPendingAnalysisCompletionSignature(order, fallbackSignature = null) {
  if (!order) {
    return normalizeStoredSignature(fallbackSignature);
  }

  return normalizeStoredSignature(order.pendingAnalysisSignature)
    || normalizeStoredSignature(fallbackSignature);
}

function hasCompletedEditingState(order, settings = getCurrentSettings()) {
  return Boolean(
    order
    && typeof order.completedSettingsSignature === "string"
    && settingsSignatureMatches(settings, order.completedSettingsSignature),
  );
}

function canCompleteActiveOrder(order) {
  if (!order || !order.text.trim()) {
    return false;
  }

  return !hasCompletedEditingState(order);
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

function updateSaveButtonState(activeOrder) {
  if (!saveQueueButton) {
    return;
  }

  if (saveQueueButton.getAttribute("aria-busy") === "true") {
    return;
  }

  setEditorActionLabel(saveQueueButton, "Save");
  saveQueueButton.disabled = !activeOrder;
}

function updateCaptureButtonState(activeOrder) {
  setEditorActionLabel(captureButton, "Complete");
  setEditorActionLabel(completeNextButton, "Complete & Next");

  if (!activeOrder) {
    captureButton.disabled = true;
    captureButton.removeAttribute("aria-busy");
    completeNextButton.disabled = true;
    completeNextButton.removeAttribute("aria-busy");
    return;
  }

  if (activeOrder.analysisState === "running") {
    captureButton.disabled = true;
    captureButton.removeAttribute("aria-busy");
    completeNextButton.disabled = true;
    completeNextButton.removeAttribute("aria-busy");
    return;
  }

  captureButton.removeAttribute("aria-busy");
  completeNextButton.removeAttribute("aria-busy");
  const canComplete = canCompleteActiveOrder(activeOrder);
  const hasNextIncompleteOrder = canComplete && Boolean(getNextIncompleteOrder(activeOrder.id));
  captureButton.disabled = !canComplete;
  completeNextButton.disabled = !hasNextIncompleteOrder;
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
  if (notStartedCountOutput) {
    notStartedCountOutput.textContent = String(notStartedCount);
  }
  clearQueueButton.disabled = orders.length === 0;
  if (showColorCountsButton) {
    showColorCountsButton.disabled = orders.length === 0;
  }
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
    renderAnalysisIndicator(analysisIndicator, analysisSummary);

    const status = document.createElement("span");
    status.className = `order-status ${order.status}`;
    status.textContent = statusLabels[order.status];

    const body = document.createElement("div");
    body.className = "order-item-body";

    const recipientText = document.createElement("div");
    recipientText.className = "order-item-recipient";
    recipientText.textContent = `Buyer: ${buildQueueRecipient(order)}`;
    recipientText.title = buildQueueRecipient(order);

    const listingText = document.createElement("div");
    listingText.className = "order-item-listing";
    listingText.textContent = `Listing: ${buildQueueListing(order)}`;
    listingText.title = buildQueueListing(order);

    const personalizationText = document.createElement("div");
    personalizationText.className = "order-item-personalization";
    personalizationText.textContent = `Personalization: ${buildQueuePersonalization(order)}`;
    personalizationText.title = buildQueuePersonalization(order);

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
      void deleteOrder(order.id);
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
  renderSharedQueueBanner(activeOrder);
  updateSaveButtonState(activeOrder);
  updateCaptureButtonState(activeOrder);
  downloadButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder);
  copyButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder) || !canCopySvgToClipboard();
  copyLayoutControlsButton.disabled = !canCopyLayoutControls(activeOrder);
  pasteLayoutControlsButton.disabled = !canPasteLayoutControls(activeOrder);
  saveAsNewPresetButton.disabled = !activeOrder;
  assignPresetToListingButton.disabled = !activeOrder?.source?.listingId;
  reloadPresetButton.disabled = !activeOrder;
}

function setActiveWorkspace(workspace) {
  activeWorkspace = workspace === "presets" ? "presets" : "orders";
  appShell.dataset.workspace = activeWorkspace;
  ordersWorkspace.hidden = activeWorkspace !== "orders";
  presetsWorkspace.hidden = activeWorkspace !== "presets";
  orderWorkspaceButton.classList.toggle("is-active", activeWorkspace === "orders");
  presetWorkspaceButton.classList.toggle("is-active", activeWorkspace === "presets");
  orderWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "orders"));
  presetWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "presets"));
}

function setNavCollapsed(nextCollapsed) {
  navCollapsed = Boolean(nextCollapsed);
  appShell.dataset.navCollapsed = String(navCollapsed);
  navCollapseButton.setAttribute("aria-label", navCollapsed ? "Expand navigation" : "Collapse navigation");
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
  scheduleDeferredPreviewRender();
  window.requestAnimationFrame(() => {
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

async function deleteOrder(orderId) {
  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return;
  }

  saveActiveOrderDraft();

  const confirmed = await showConfirmationDialog({
    title: "Delete Design?",
    description: `Delete ${buildQueueOrderNumber(order)} from the current batch?`,
    confirmLabel: "Confirm",
    cancelLabel: "Keep Design",
    isDanger: true,
  });
  if (!confirmed) {
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
    persistQueueState();
    updateWorkflowAlert(isSharedQueueSyncEnabled() ? "Shared queue cleared." : "Queue cleared.", "pending");
  } else {
    persistQueueState();
  }

  renderOrderList();
  if (activeOrderId) {
    render();
  }
}

async function clearAllOrders() {
  saveActiveOrderDraft();
  if (!orders.length) {
    return;
  }

  const confirmed = await showConfirmationDialog({
    title: "Clear Batch?",
    description: isSharedQueueSyncEnabled()
      ? "Clear the shared queue and refresh the local recovery cache?"
      : "Clear the current batch and delete all saved local designs?",
    confirmLabel: "Confirm",
    cancelLabel: "Keep Batch",
    isDanger: true,
  });
  if (!confirmed) {
    return;
  }

  orders.splice(0, orders.length);
  activeOrderId = null;
  orderSequence = 1;
  resetEditorToEmptyState();
  persistQueueState();
  updateWorkflowAlert(
    isSharedQueueSyncEnabled()
      ? "Batch cleared from the shared queue and local recovery cache updated."
      : "Batch cleared locally.",
    "pending",
  );
  renderOrderList();
}

async function importFromClipboard() {
  if (!navigator.clipboard?.readText) {
    updateWorkflowAlert("Clipboard import is not available in this browser context.", "error");
    return;
  }

  importClipboardButton.disabled = true;
  setQueueActionLabel(importClipboardButton, "Pasting...");

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
      updateWorkflowAlert(`Imported ${createdItems.length} new Etsy design${createdItems.length === 1 ? "" : "s"} and skipped ${skippedCount} already in the queue.`, "success");
    } else if (createdItems.length) {
      updateWorkflowAlert(`Imported ${createdItems.length} Etsy design${createdItems.length === 1 ? "" : "s"} from the clipboard.`, "success");
    } else if (skippedCount) {
      updateWorkflowAlert(`Skipped ${skippedCount} Etsy design${skippedCount === 1 ? "" : "s"} already in the queue. No new designs were added.`, "success");
    } else {
      updateWorkflowAlert("Clipboard data did not include any importable Etsy designs.", "error");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clipboard import failed.";
    updateWorkflowAlert(message, "error");
  } finally {
    importClipboardButton.disabled = false;
    setQueueActionLabel(importClipboardButton, "Paste");
  }
}

async function captureActiveOrder({ advanceToNext = false } = {}) {
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
  order.completedSettingsSignature = signature;
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
    {
      state: "running",
      shortLabel: "",
      fullLabel: "Analysis running",
    },
  );

  if (advanceToNext) {
    const nextUncaptured = getNextIncompleteOrder(order.id);
    if (nextUncaptured) {
      selectOrder(nextUncaptured.id);
    }
  }

  try {
    const analysis = await analyzeLayout(layout);
    const isLatestAnalysisRequest = order.pendingAnalysisRequestId === requestId;
    const completionSignature = getPendingAnalysisCompletionSignature(order, signature);
    const shouldApplyCompletedAnalysis = isLatestAnalysisRequest
      && settingsSignatureMatches(order.settings, completionSignature);

    if (isLatestAnalysisRequest) {
      storeCachedBuild(order, completionSignature, layout, analysis);
      order.analysisState = "idle";
      order.pendingAnalysisSignature = null;
      order.pendingAnalysisRequestId = null;
    }

    if (shouldApplyCompletedAnalysis) {
      order.savedSettingsSignature = completionSignature;
      order.capturedLayout = {
        ...cloneSerializableData(layout),
        analysis: cloneSerializableData(analysis),
      };
      order.status = "captured";
      order.analysisBadge = buildCompletedAnalysisBadge(analysis);
      if (order.previousCompletedBuild?.signature === completionSignature) {
        order.previousCompletedBuild = null;
      }

      await saveQueueSnapshotToRemote({
        persistActiveDraft: false,
        successMessage: false,
      });
    }

    persistQueueState();

    if (
      shouldApplyCompletedAnalysis
      && activeOrderId === order.id
      && settingsSignatureMatches(getCurrentSettings(), completionSignature)
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
    const completionSignature = getPendingAnalysisCompletionSignature(order, signature);
    const shouldApplyFailedAnalysis = isLatestAnalysisRequest
      && settingsSignatureMatches(order.settings, completionSignature);

    if (isLatestAnalysisRequest) {
      order.analysisState = "idle";
      order.pendingAnalysisSignature = null;
      order.pendingAnalysisRequestId = null;
    }
    if (shouldApplyFailedAnalysis) {
      order.status = "in-progress";
      order.analysisBadge = null;
      if (order.completedSettingsSignature === completionSignature) {
        order.completedSettingsSignature = getBuildForSignature(order, completionSignature)?.signature || null;
      }
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

function measureCharacter(character, fontSizeMm, fontId, horizontalScale = 1) {
  const fontSizePx = fontSizeMm * PX_PER_MM;
  ctx.font = getCanvasFont(fontSizePx, fontId);
  const metrics = ctx.measureText(character);
  const left = ((metrics.actualBoundingBoxLeft || 0) / PX_PER_MM) * horizontalScale;
  const right = ((metrics.actualBoundingBoxRight || metrics.width) / PX_PER_MM) * horizontalScale;

  return {
    advance: (metrics.width / PX_PER_MM) * horizontalScale,
    left,
    right,
    inkWidth: left + right,
  };
}

function drawScaledText(context, character, x, y, fontSizePx, fontId, horizontalScale, verticalScale, mode = "fill") {
  context.save();
  context.font = getCanvasFont(fontSizePx, fontId);
  context.textBaseline = "alphabetic";
  context.translate(x, y);
  context.scale(horizontalScale, verticalScale);

  if (mode === "stroke" || mode === "both") {
    context.strokeText(character, 0, 0);
  }

  if (mode === "fill" || mode === "both") {
    context.fillText(character, 0, 0);
  }

  context.restore();
}

function createGlyphMask(character, fontSizeMm, fontId, horizontalScale, verticalScale) {
  const fontSizePx = fontSizeMm * PX_PER_MM * MASK_SCALE;
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskContext.font = getCanvasFont(fontSizePx, fontId);
  const metrics = maskContext.measureText(character);
  const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
  const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSizePx * 0.8);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSizePx * 0.25);
  const scaledLeft = Math.ceil(left * horizontalScale);
  const scaledRight = Math.ceil(right * horizontalScale);
  const width = Math.max(1, scaledLeft + scaledRight + MASK_PADDING_PX * 2);
  const scaledAscent = Math.ceil(ascent * verticalScale);
  const scaledDescent = Math.ceil(descent * verticalScale);
  const height = Math.max(1, scaledAscent + scaledDescent + MASK_PADDING_PX * 2);
  const baseline = MASK_PADDING_PX + scaledAscent;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.fillStyle = "#000";
  drawScaledText(maskContext, character, MASK_PADDING_PX + scaledLeft, baseline, fontSizePx, fontId, horizontalScale, verticalScale);

  const imageData = maskContext.getImageData(0, 0, width, height);

  return {
    character,
    data: imageData.data,
    opaqueRows: buildOpaqueRows(imageData, width, height),
    width,
    height,
    baseline,
    leftMm: scaledLeft / MASK_SCALE / PX_PER_MM,
    rightMm: scaledRight / MASK_SCALE / PX_PER_MM,
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

function buildOpaqueRows(imageData, width, height) {
  const rows = new Array(height).fill(null);

  for (let y = 0; y < height; y += 1) {
    let row = null;

    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] <= 32) {
        continue;
      }

      if (!row) {
        row = [];
        rows[y] = row;
      }

      row.push(x);
    }
  }

  return rows;
}

function getOverlapWidthPx(leftMask, rightMask, dxPx) {
  const baselineDelta = leftMask.baseline - rightMask.baseline;
  let minX = Infinity;
  let maxX = -Infinity;

  for (let rightY = 0; rightY < rightMask.height; rightY += 1) {
    const row = rightMask.opaqueRows?.[rightY];
    if (!row) {
      continue;
    }

    const leftY = rightY + baselineDelta;
    if (leftY < 0 || leftY >= leftMask.height) {
      continue;
    }

    for (const rightX of row) {
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
    opaqueRows: [null],
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

function createLineMask(letters, fontSizeMm, fontId, horizontalScale, verticalScale) {
  if (!letters.length) {
    return createEmptyLineMask(fontSizeMm, verticalScale);
  }

  const scale = PX_PER_MM * MASK_SCALE;
  const minLeft = Math.min(...letters.map((letter) => letter.leftEdge), 0);
  const maxRight = Math.max(...letters.map((letter) => letter.rightEdge), fontSizeMm);
  const lineMaskMetrics = computeLineMaskMetrics(letters, {
    fontSizeMm,
    verticalScale,
    pixelsPerMm: scale,
    paddingPx: MASK_PADDING_PX,
  });
  const width = Math.ceil((maxRight - minLeft) * scale) + MASK_PADDING_PX * 2;
  const height = lineMaskMetrics.heightPx;
  const baseline = lineMaskMetrics.baselinePx;
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
      horizontalScale,
      verticalScale,
    );
  });

  const imageData = maskContext.getImageData(0, 0, width, height);
  let inkLeft = width;
  let inkRight = 0;
  let inkTop = height;
  let inkBottom = 0;
  let hasInk = false;
  const opaqueRows = new Array(height).fill(null);

  for (let y = 0; y < height; y += 1) {
    let row = null;

    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] <= 32) {
        continue;
      }

      if (!row) {
        row = [];
        opaqueRows[y] = row;
      }

      row.push(x);
      inkLeft = Math.min(inkLeft, x);
      inkRight = Math.max(inkRight, x);
      inkTop = Math.min(inkTop, y);
      inkBottom = Math.max(inkBottom, y);
      hasInk = true;
    }
  }

  const visualLeftMm = hasInk ? minLeft + (inkLeft - MASK_PADDING_PX) / scale : minLeft;
  const visualRightMm = hasInk ? minLeft + (inkRight - MASK_PADDING_PX) / scale : maxRight;

  const visualTopMm = hasInk ? (inkTop - MASK_PADDING_PX) / scale : 0;
  const visualBottomMm = hasInk ? (inkBottom - MASK_PADDING_PX) / scale : fontSizeMm * verticalScale;

  return {
    data: imageData.data,
    opaqueRows,
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
    const row = lowerMask.opaqueRows?.[lowerY];
    if (!row) {
      continue;
    }

    const upperY = lowerY + dyPx;
    if (upperY < 0 || upperY >= upperMask.height) {
      continue;
    }

    for (const lowerX of row) {
      const upperX = lowerX + dxPx;
      if (maskHasInk(upperMask, upperX, upperY)) {
        minY = Math.min(minY, upperY);
        maxY = Math.max(maxY, upperY);
      }
    }
  }

  return Number.isFinite(minY) ? maxY - minY + 1 : 0;
}

function buildMeasuredLineCacheKey(text, settings) {
  return JSON.stringify([
    text,
    settings.fontId,
    settings.bridgeMm,
    settings.lineBridgeMm,
    settings.offsetXMm,
    settings.fontSizeMm,
    settings.horizontalScale,
    settings.verticalScale,
    settings.lockTextHeight,
  ]);
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

function layoutCharacters(text, fontSizeMm, bridgeMm, fontId, horizontalScale, verticalScale) {
  const characters = [...text];
  if (!characters.length) {
    return [];
  }

  const masks = characters.map((character) => createGlyphMask(character, fontSizeMm, fontId, horizontalScale, verticalScale));
  const positions = [];

  return characters.map((character, index) => {
    const metrics = measureCharacter(character, fontSizeMm, fontId, horizontalScale);
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
      ascentMm: mask.ascentMm,
      descentMm: mask.descentMm,
      width: metrics.inkWidth,
      advance: metrics.advance,
    };
  });
}

function buildMeasuredLine(text, settings) {
  const letters = layoutCharacters(
    text,
    settings.fontSizeMm,
    settings.bridgeMm,
    settings.fontId,
    settings.horizontalScale,
    settings.verticalScale,
  );

  return {
    text,
    settings,
    letters,
    mask: createLineMask(letters, settings.fontSizeMm, settings.fontId, settings.horizontalScale, settings.verticalScale),
    offsetXMm: settings.offsetXMm,
  };
}

function getMeasuredLine(text, settings) {
  const cacheKey = buildMeasuredLineCacheKey(text, settings);
  let measuredLine = measuredLineCache.get(cacheKey);

  if (!measuredLine) {
    measuredLine = buildMeasuredLine(text, settings);
    measuredLineCache.set(cacheKey, measuredLine);
  }

  return measuredLine;
}

function layoutTextLines(text, lineSettings) {
  const rawLines = getRawTextLines(text);
  const normalizedSettings = normalizeSettings({ text, lines: lineSettings }).lines;
  const lines = rawLines.map((lineText, index) => {
    const settings = normalizedSettings[index] || createDefaultLineSettings();
    const measuredLine = getMeasuredLine(lineText, settings);

    return {
      index,
      text: measuredLine.text,
      settings: measuredLine.settings,
      letters: measuredLine.letters,
      mask: measuredLine.mask,
      offsetXMm: measuredLine.offsetXMm,
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

function hasLockedTextHeight(lines) {
  return Array.isArray(lines) && lines.some((line) => Boolean(line?.settings?.lockTextHeight));
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
      data[offset] = 255;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
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
  backingContext.strokeStyle = "rgb(255, 0, 0)";
  backingContext.fillStyle = "rgb(255, 0, 0)";

  letters.forEach((letter) => {
    backingContext.lineWidth = backingMm * 2 * scale;
    drawScaledText(
      backingContext,
      letter.character,
      letter.x * scale,
      letter.y * scale,
      letter.fontSizeMm * scale,
      letter.fontId,
      letter.horizontalScale ?? 1,
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

function renderFaceCanvas(letters, widthMm, heightMm) {
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
      letter.horizontalScale ?? 1,
      letter.verticalScale ?? 1,
    );
  });

  return {
    canvas: faceCanvas,
    boundsMm: measureCanvasInkBounds(faceCanvas, widthMm, heightMm),
  };
}

function createFaceImage(letters, widthMm, heightMm) {
  const facePreview = renderFaceCanvas(letters, widthMm, heightMm);

  return {
    href: facePreview.canvas.toDataURL("image/png"),
    boundsMm: facePreview.boundsMm,
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
        fill: "rgb(255, 0, 0)",
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
  const analysisBadge = buildCompletedAnalysisBadge(analysis);

  if (analysis.isConnected) {
    updateConnectionStatus(
      "ok",
      "Single connected face piece",
      "The current face-layer analysis reads as one connected acrylic component.",
      analysisBadge,
    );
    return;
  }

  updateConnectionStatus(
    "warning",
    `${analysis.connectedComponentCount} separate face pieces`,
    "The current face-layer analysis still contains disconnected acrylic pieces. Adjust the bridges or line layout before export.",
    analysisBadge,
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
  setEditorActionLabel(downloadButton, "Exporting...");
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
    setEditorActionLabel(downloadButton, "Export This Design");
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
  setEditorActionLabel(copyButton, "Copying...");
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
    setEditorActionLabel(copyButton, "Copy This Design");
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
    updateWorkflowAlert(
      `Complete ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch export. Face analysis now runs only on Complete.`,
      "error",
    );
    renderOrderList();
    return;
  }

  exportCompletedButton.disabled = true;
  setQueueActionLabel(exportCompletedButton, "Exporting...");
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
    setQueueActionLabel(exportCompletedButton, "Export All Designs");
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
    updateWorkflowAlert(
      `Complete ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch copy. Face analysis now runs only on Complete.`,
      "error",
    );
    renderOrderList();
    return;
  }

  copyCompletedButton.disabled = true;
  setQueueActionLabel(copyCompletedButton, "Copying...");
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
    setQueueActionLabel(copyCompletedButton, "Copy All Designs");
    copyCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

function assembleOrderLayout(normalized, sourceLines, fitScale, fitted) {
  const text = normalized.text.trim();
  const lineScaleFactors = computeLineScaleFactors(sourceLines, fitScale);
  const {
    lines: fittedLines,
    baseTextWidthMm,
    lineBounds,
    minLeftMm,
    minTopMm,
    textWidthMm,
    textHeightMm,
  } = fitted;
  const scaledBackingMm = normalized.backingMm * fitScale;
  const scaledBleedMm = DESIGN_BLEED_MM * fitScale;
  const overflowsGuide = computeGuideOverflow(sourceLines, textWidthMm, textHeightMm);
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
      horizontalScale: line.settings.horizontalScale,
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

function buildOrderLayout(settings) {
  const normalized = normalizeSettings(settings);
  const { lines } = measureTextLayoutForFit(normalized.text, normalized.lines);
  let fitScale = computeMixedFitScale(lines);
  let scaledLineSettings = buildScaledLineSettings(lines, fitScale);
  let fitted = measureTextLayoutForFit(normalized.text, scaledLineSettings);
  let layout = assembleOrderLayout(normalized, lines, fitScale, fitted);

  for (let index = 0; index < 3; index += 1) {
    if (layout.fit.overflowsGuide && hasLockedTextHeight(lines)) {
      break;
    }

    const faceBounds = renderFaceCanvas(layout.letters, layout.widthMm, layout.heightMm).boundsMm;
    const residualFitScale = computeTextFitScale(faceBounds.width, faceBounds.height);

    if (!Number.isFinite(residualFitScale) || Math.abs(residualFitScale - 1) < 0.001) {
      break;
    }

    fitScale *= residualFitScale;
    scaledLineSettings = buildScaledLineSettings(lines, fitScale);
    fitted = measureTextLayoutForFit(normalized.text, scaledLineSettings);
    layout = assembleOrderLayout(normalized, lines, fitScale, fitted);
  }

  return layout;
}

function handleTextInput() {
  const nextSettings = normalizeSettings(getCurrentSettings());
  renderLineControls(nextSettings);
  updateGlobalHorizontalScaleControl(nextSettings);
  updateGlobalVerticalScaleControl(nextSettings);
  updateActiveOrderFromControls();
  render();
}

function updatePreviewForControlEvent({ defer = false } = {}) {
  if (defer) {
    scheduleDeferredPreviewRender();
    return;
  }

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

  updateGlobalHorizontalScaleControl();
  updateGlobalVerticalScaleControl();
  const isDeferredSliderInput = target instanceof HTMLInputElement
    && target.type === "range"
    && event.type === "input";
  updatePreviewForControlEvent({ defer: isDeferredSliderInput });
  updateActiveOrderFromControls();
}

function applyGlobalHorizontalScale(value, options = {}) {
  const { deferPreview = false } = options;
  const currentSettings = normalizeSettings(getCurrentSettings());
  const nextValue = Number(value);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    lines: currentSettings.lines.map((line) => ({
      ...line,
      horizontalScale: nextValue,
    })),
  });

  applySettings(nextSettings);
  updatePreviewForControlEvent({ defer: deferPreview });
  updateActiveOrderFromControls();
}

function applyGlobalVerticalScale(value, options = {}) {
  const { deferPreview = false } = options;
  const currentSettings = normalizeSettings(getCurrentSettings());
  const nextValue = Number(value);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    lines: currentSettings.lines.map((line) => ({
      ...line,
      verticalScale: nextValue,
    })),
  });

  applySettings(nextSettings);
  updatePreviewForControlEvent({ defer: deferPreview });
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
reloadPresetButton?.addEventListener("click", () => {
  const order = getActiveOrder();
  if (order?.source) {
    order.source.manualPresetOverride = true;
  }
  applyPresetSelection(presetInput.value);
});
lineControls.addEventListener("input", handleLineControlsChange);
lineControls.addEventListener("change", handleLineControlsChange);
globalHorizontalScaleInput?.addEventListener("input", () => {
  applyGlobalHorizontalScale(globalHorizontalScaleInput.value, { deferPreview: true });
});
globalHorizontalScaleInput?.addEventListener("change", () => {
  applyGlobalHorizontalScale(globalHorizontalScaleInput.value);
});
globalVerticalScaleInput?.addEventListener("input", () => {
  applyGlobalVerticalScale(globalVerticalScaleInput.value, { deferPreview: true });
});
globalVerticalScaleInput?.addEventListener("change", () => {
  applyGlobalVerticalScale(globalVerticalScaleInput.value);
});
backingInput.addEventListener("input", () => {
  updateBackingOutput();
  updatePreviewForControlEvent({ defer: true });
  updateActiveOrderFromControls();
});
backingInput.addEventListener("change", () => {
  updateBackingOutput();
  render();
  updateActiveOrderFromControls();
});
weldExportedDesignInput.addEventListener("input", () => {
  render();
  updateActiveOrderFromControls();
});
orderWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("orders");
});
presetWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("presets");
});
presetEditorSelect?.addEventListener("change", () => {
  if (!presetEditorSelect.value) {
    presetEditorDraft = createPresetEditorDraft(null, { previousId: null, generateNewId: true });
    renderPresetEditorDraft();
    setPresetEditorStatus("Start a new preset draft or choose a saved preset.", "pending");
    return;
  }

  loadPresetEditorDraftFromRegistry(presetEditorSelect.value);
});
presetDraftNameInput?.addEventListener("input", syncPresetEditorDraftFromInputs);
savePresetButton?.addEventListener("click", () => {
  void savePresetEditorDraft();
});
presetBackingInput?.addEventListener("input", () => {
  updatePresetBackingOutput();
});
presetGlobalHorizontalScaleInput?.addEventListener("input", () => {
  updatePresetGlobalHorizontalScaleOutput();
});
presetGlobalVerticalScaleInput?.addEventListener("input", () => {
  updatePresetGlobalVerticalScaleOutput();
});
presetLineRuleControls?.addEventListener("input", (event) => {
  updateRangeOutputForInput(event.target);
});
presetAssignmentsList?.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-listing-assignment-id]")
    : null;
  const listingId = button?.getAttribute("data-listing-assignment-id") || "";
  if (!listingId) {
    return;
  }

  void unassignListingFromPreset(listingId);
});
navCollapseButton.addEventListener("click", () => {
  setNavCollapsed(!navCollapsed);
});

addOrderButton.addEventListener("click", addOrder);
importClipboardButton.addEventListener("click", importFromClipboard);
clearQueueButton.addEventListener("click", clearAllOrders);
showColorCountsButton?.addEventListener("click", openBatchColorCountsDialog);
exportCompletedButton.addEventListener("click", exportAllOrders);
copyCompletedButton.addEventListener("click", copyAllOrders);
saveAsNewPresetButton?.addEventListener("click", openPresetEditorForNewPreset);
assignPresetToListingButton?.addEventListener("click", () => {
  void assignSelectedPresetToActiveListing();
});
[addOrderButton, importClipboardButton, clearQueueButton, showColorCountsButton, exportCompletedButton, copyCompletedButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      queueToolsMenu?.removeAttribute("open");
    });
  });
closeColorCountsButton?.addEventListener("click", closeBatchColorCountsDialog);
colorCountsDialog?.addEventListener("click", (event) => {
  if (event.target === colorCountsDialog) {
    closeBatchColorCountsDialog();
  }
});
confirmationDialogCancelButton?.addEventListener("click", () => {
  finishConfirmationDialog(false);
});
confirmationDialogCloseButton?.addEventListener("click", () => {
  finishConfirmationDialog(false);
});
confirmationDialogConfirmButton?.addEventListener("click", () => {
  finishConfirmationDialog(true);
});
confirmationDialogElement?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-a11y-dialog-hide]") : null;
  if (!target) {
    return;
  }

  finishConfirmationDialog(false);
});
confirmationDialogElement?.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  finishConfirmationDialog(false);
});
closePresetAssignmentDialogButton?.addEventListener("click", closePresetAssignmentDialog);
presetAssignmentDialog?.addEventListener("click", (event) => {
  if (event.target === presetAssignmentDialog) {
    closePresetAssignmentDialog();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!queueToolsMenu?.hasAttribute("open")) {
    return;
  }

  if (event.target instanceof Node && queueToolsMenu.contains(event.target)) {
    return;
  }

  queueToolsMenu.removeAttribute("open");
});
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", () => {
  captureActiveOrder();
});
completeNextButton.addEventListener("click", () => {
  captureActiveOrder({ advanceToNext: true });
});
saveQueueButton?.addEventListener("click", () => {
  void saveCurrentQueueManually();
});
downloadButton.addEventListener("click", downloadSvg);
copyButton.addEventListener("click", copyCurrentSvg);
copyLayoutControlsButton.addEventListener("click", copyActiveLayoutControls);
pasteLayoutControlsButton.addEventListener("click", pasteLayoutControlsIntoActiveOrder);
sharedQueueBannerReloadButton?.addEventListener("click", reloadSharedQueueFromBanner);
previewPanel.addEventListener("mousedown", startPreviewMiddlePan);
previewPanel.addEventListener("auxclick", (event) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});
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
window.addEventListener("mousemove", updatePreviewMiddlePan);
window.addEventListener("mouseup", (event) => {
  if (event.button === 1) {
    endPreviewMiddlePan();
  }
});
window.addEventListener("blur", endPreviewMiddlePan);
window.addEventListener("pagehide", () => {
  flushPersistQueueState({ keepalive: true });
});

setActiveWorkspace(activeWorkspace);
setNavCollapsed(navCollapsed);
await checkFonts();
await loadPresetRegistry();
renderPresetOptions();
renderPresetEditorDraft();
updateBackingOutput();
const restoredQueue = await restoreInitialQueueState();
if ((!restoredQueue.source || restoredQueue.count === 0) && workflowAlert.dataset.state !== "error") {
  updateWorkflowAlert("", "pending");
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
updateGlobalHorizontalScaleControl(normalizeSettings({
  text: "",
  presetId: defaultPresetId,
  backingMm: defaultPresetBaseSettings.backingMm,
  weldExportedDesign: defaultPresetBaseSettings.weldExportedDesign,
  lines: [],
}));
updateGlobalVerticalScaleControl(normalizeSettings({
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
