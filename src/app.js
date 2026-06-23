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
  buildScaledTextBounds,
  measureLineBounds,
} from "./layout-math.js";
import {
  buildPresetLines,
  deleteBoundingSizePresetDefinitionLocally,
  deletePresetDefinitionLocally,
  getBoundingSizePresetDefinitionsForEditor,
  getDefaultPresetId,
  getPresetDefinitionForEditor,
  getPresetFixedItems,
  getPresetFixedDesignText,
  getPresetGlobalDefaults,
  getPresetIdForListingId,
  getPresetOptions,
  getPresetSnapshot,
  hasPresetMappingForListingId,
  inferPresetDefinitionFromSettings,
  isValidPresetId,
  loadPresetRegistry,
  removeListingAssignment,
  saveBoundingSizePresetDefinitionLocally,
  savePresetDefinitionLocally,
  upsertListingAssignment,
} from "./presets.js";
import { savePresetSnapshot } from "./preset-api.js";
import { computeLineMaskMetrics } from "./text-metrics.js";
import { shouldUseRasterTextPreview } from "./preview-rendering.js";
import { findPairOffsetPx } from "./bridge-geometry.js";
import {
  buildSettingsSignature,
  getSettingsSignatureCandidates,
} from "./order-signatures.js";
import {
  isBatchSnapshotEmpty,
} from "./production-batch-sync.js";
import { buildBatchSyncStatus } from "./production-batch-sync-status.js";
import {
  applyLayoutControlsSnapshot,
  buildLayoutControlsSnapshot,
} from "./layout-controls-clipboard.js";
import {
  buildGlyphLayoutRuns,
  resolveNextGlyphMaskOrigin,
  resolveNextLineOffsetMm,
} from "./glyph-layout.js";
import { buildReloadedPresetSettings } from "./preset-selection.js";
import {
  completeProductionBatch,
  fetchProductionBatchSnapshot,
  fetchBatchSession,
  ProductionBatchConflictError,
  removeProductionBatchItem,
  saveProductionBatchSnapshot,
} from "./production-batch-api.js";
import {
  addOrderItemToProductionBatch,
  addOrdersToProductionBatch,
  fetchWorkspaceOrders,
  importWorkspaceOrders,
  updateOrderItemLifecycleStatus,
} from "./orders-api.js";
import {
  filterGroupedOrders,
  getCheckedOrderIdsForBulkAction,
  getCopyableSavedBuild,
  getOrderItemListingText as getDatabaseOrderItemListingText,
  getSelectedGroupedOrder,
  getVisibleOrderSelectionState,
  normalizeOrdersWorkspaceState,
} from "./orders-workspace.js";
import {
  getAccessToken,
  getSignedInSession,
  signOutBrowserSession,
  signInWithPassword as signInOperatorWithPassword,
} from "./auth-session.js";
import {
  buildImportedBatchIdentity,
  parseImportedItems,
} from "./etsy-import.js";
import {
  chooseProductionBatchStartupState,
  createProductionBatchSnapshot,
} from "./production-batch-model.js";
import {
  buildBoundingSizePresetFingerprint,
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  getBoundingSizePresetOptions,
  isBuiltInBoundingSizePresetId,
  isValidBoundingSizePresetId,
  normalizeBoundingSizePresetDefinition,
  resolveBoundingSizePreset,
} from "./bounding-size-presets.js";
import {
  buildFontOptions,
  createWorkspaceFont,
  deleteWorkspaceFont,
  getFontLibraryOptions,
  getSelectableFontOptions,
  loadWorkspaceFontOptions,
  registerBrowserFonts,
  replaceWorkspaceFont,
  resolveFontOption,
  updateWorkspaceFontSettings,
} from "./fonts.js";
import {
  createWorkspaceFixedDesign,
  deleteWorkspaceFixedDesign,
  fetchWorkspaceFixedDesigns,
  replaceWorkspaceFixedDesign,
} from "./fixed-design-api.js";
import {
  normalizeFixedDesignRecord,
  normalizeFixedDesignRecords,
  resolveFixedDesignReference,
  settingsNeedFixedDesignRecords,
} from "./fixed-designs.js";

let FONT_OPTIONS = buildFontOptions();
let FONT_BY_ID = new Map(FONT_OPTIONS.map((font) => [font.id, font]));
const DEFAULT_PREVIEW_WIDTH_MM = PREVIEW_BOX_WIDTH_MM + PREVIEW_MARGIN_MM * 2 + PREVIEW_LABEL_RIGHT_MM;
const DEFAULT_PREVIEW_HEIGHT_MM = PREVIEW_BOX_HEIGHT_MM + PREVIEW_MARGIN_MM * 2;
const PREVIEW_INNER_GUIDE_WIDTH_MM = 1.6 * 25.4;
const PREVIEW_INNER_GUIDE_HEIGHT_MM = 1.1 * 25.4;
const PREVIEW_INNER_GUIDE_INSET_X_MM = (PREVIEW_BOX_WIDTH_MM - PREVIEW_INNER_GUIDE_WIDTH_MM) / 2;
const PREVIEW_INNER_GUIDE_INSET_Y_MM = (PREVIEW_BOX_HEIGHT_MM - PREVIEW_INNER_GUIDE_HEIGHT_MM) / 2;
const DEFAULT_ZOOM = 3;
const DEFAULT_WELD_EXPORTED_DESIGN = true;
const WORKFLOW_ALERT_AUTOHIDE_MS = Object.freeze({
  pending: 3200,
  success: 6000,
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
const WORKSPACE_NAV_COLLAPSED_STORAGE_KEY = "thankfulforyou.workspaceNavCollapsed";
const DEFAULT_WORKSPACE = "databaseOrders";
const WORKSPACE_ROUTE_SEGMENTS = Object.freeze({
  databaseOrders: "orders",
  orders: "production-batch",
  presets: "presets",
  fonts: "fonts",
  fixedDesigns: "fixed-designs",
  sizeGuides: "size-guides",
});
const WORKSPACE_BY_ROUTE_SEGMENT = Object.freeze(
  Object.fromEntries(Object.entries(WORKSPACE_ROUTE_SEGMENTS).map(([workspace, segment]) => [segment, workspace])),
);

const appShell = document.querySelector(".app-shell");
const workspaceStage = document.querySelector("#workspaceStage");
const initialBatchLoading = document.querySelector("#initialBatchLoading");
const productionBatchAuthGate = document.querySelector("#productionBatchAuthGate");
const productionBatchAuthTitle = document.querySelector("#productionBatchAuthTitle");
const productionBatchAuthMessage = document.querySelector("#productionBatchAuthMessage");
const productionBatchSignInForm = document.querySelector("#productionBatchSignInForm");
const productionBatchEmailInput = document.querySelector("#productionBatchEmail");
const productionBatchPasswordInput = document.querySelector("#productionBatchPassword");
const productionBatchSignInButton = document.querySelector("#productionBatchSignInButton");
const productionBatchAuthError = document.querySelector("#productionBatchAuthError");
const ordersWorkspace = document.querySelector("#ordersWorkspace");
const databaseOrdersWorkspace = document.querySelector("#databaseOrdersWorkspace");
const presetsWorkspace = document.querySelector("#presetsWorkspace");
const fontsWorkspace = document.querySelector("#fontsWorkspace");
const fixedDesignsWorkspace = document.querySelector("#fixedDesignsWorkspace");
const sizeGuideWorkspace = document.querySelector("#sizeGuideWorkspace");
const orderWorkspaceButton = document.querySelector("#orderWorkspaceButton");
const databaseOrdersWorkspaceButton = document.querySelector("#databaseOrdersWorkspaceButton");
const presetWorkspaceButton = document.querySelector("#presetWorkspaceButton");
const fontWorkspaceButton = document.querySelector("#fontWorkspaceButton");
const fixedDesignsWorkspaceButton = document.querySelector("#fixedDesignsWorkspaceButton");
const sizeGuideWorkspaceButton = document.querySelector("#sizeGuideWorkspaceButton");
const productionBatchLogoutButton = document.querySelector("#productionBatchLogoutButton");
const navCollapseButton = document.querySelector("#navCollapseButton");
const fontLibraryList = document.querySelector("#fontLibraryList");
const showDeletedFontsInput = document.querySelector("#showDeletedFontsInput");
const newFontUploadButton = document.querySelector("#newFontUploadButton");
const fontFileInput = document.querySelector("#fontFileInput");
const fontDisplayNameInput = document.querySelector("#fontDisplayNameInput");
const saveFontDisplayNameButton = document.querySelector("#saveFontDisplayNameButton");
const fontBridgingEnabledInput = document.querySelector("#fontBridgingEnabledInput");
const fontPreviewTextInput = document.querySelector("#fontPreviewTextInput");
const selectedFontName = document.querySelector("#selectedFontName");
const selectedFontMeta = document.querySelector("#selectedFontMeta");
const selectedFontPreview = document.querySelector("#selectedFontPreview");
const replaceFontButton = document.querySelector("#replaceFontButton");
const deleteFontButton = document.querySelector("#deleteFontButton");
const fontEditorStatus = document.querySelector("#fontEditorStatus");
const fixedDesignUploadButton = document.querySelector("#fixedDesignUploadButton");
const fixedDesignUploadInput = document.querySelector("#fixedDesignUploadInput");
const fixedDesignSearchInput = document.querySelector("#fixedDesignSearchInput");
const fixedDesignList = document.querySelector("#fixedDesignList");
const selectedFixedDesignName = document.querySelector("#selectedFixedDesignName");
const selectedFixedDesignMeta = document.querySelector("#selectedFixedDesignMeta");
const fixedDesignActionsMenu = document.querySelector("#fixedDesignActionsMenu");
const saveFixedDesignButton = document.querySelector("#saveFixedDesignButton");
const loadFixedDesignVersionButton = document.querySelector("#loadFixedDesignVersionButton");
const downloadFixedDesignButton = document.querySelector("#downloadFixedDesignButton");
const deleteFixedDesignButton = document.querySelector("#deleteFixedDesignButton");
const fixedDesignPreviewImage = document.querySelector("#fixedDesignPreviewImage");
const fixedDesignPreviewEmptyState = document.querySelector("#fixedDesignPreviewEmptyState");
const selectedFixedDesignFileName = document.querySelector("#selectedFixedDesignFileName");
const selectedFixedDesignVersion = document.querySelector("#selectedFixedDesignVersion");
const selectedFixedDesignState = document.querySelector("#selectedFixedDesignState");
const fixedDesignEditorStatus = document.querySelector("#fixedDesignEditorStatus");
const fixedDesignVersionDialog = document.querySelector("#fixedDesignVersionDialog");
const fixedDesignVersionDialogTitle = document.querySelector("#fixedDesignVersionDialogTitle");
const closeFixedDesignVersionDialogButton = document.querySelector("#closeFixedDesignVersionDialogButton");
const fixedDesignDropZone = document.querySelector("#fixedDesignDropZone");
const chooseFixedDesignVersionButton = document.querySelector("#chooseFixedDesignVersionButton");
const fixedDesignVersionInput = document.querySelector("#fixedDesignVersionInput");
const fixedDesignVersionPreview = document.querySelector("#fixedDesignVersionPreview");
const fixedDesignVersionPreviewImage = document.querySelector("#fixedDesignVersionPreviewImage");
const fixedDesignVersionStatus = document.querySelector("#fixedDesignVersionStatus");
const cancelFixedDesignVersionButton = document.querySelector("#cancelFixedDesignVersionButton");
const loadFixedDesignVersionConfirmButton = document.querySelector("#loadFixedDesignVersionConfirmButton");
const addOrderButton = document.querySelector("#addOrderButton");
const importClipboardButton = document.querySelector("#importClipboardButton");
const clearBatchButton = document.querySelector("#clearBatchButton");
const workflowAlert = document.querySelector("#importStatus");
const workflowAlertText = document.querySelector("#workflowAlertText");
const workflowAlertActionButton = document.querySelector("#workflowAlertActionButton");
const batchSyncStatus = document.querySelector("#batchSyncStatus");
const batchSyncStatusLabel = document.querySelector("#batchSyncStatusLabel");
const batchSyncStatusDetail = document.querySelector("#batchSyncStatusDetail");
const exportCompletedButton = document.querySelector("#exportCompletedButton");
const showColorCountsButton = document.querySelector("#showColorCountsButton");
const copyCompletedButton = document.querySelector("#copyCompletedButton");
const batchToolsMenu = document.querySelector(".batch-tools-menu");
const ordersToolsMenu = document.querySelector("#ordersToolsMenu");
const pasteOrdersButton = document.querySelector("#pasteOrdersButton");
const databaseOrdersSearchInput = document.querySelector("#databaseOrdersSearchInput");
const databaseOrdersStatusFilter = document.querySelector("#databaseOrdersStatusFilter");
const databaseOrdersBatchFilter = document.querySelector("#databaseOrdersBatchFilter");
const selectVisibleOrdersInput = document.querySelector("#selectVisibleOrdersInput");
const databaseOrdersListShell = document.querySelector(".database-orders-list-shell");
const databaseOrderItemsShell = document.querySelector(".database-order-items-shell");
const selectedDatabaseOrderTitle = document.querySelector(".database-order-items-panel .editor-header h2");
const selectedDatabaseOrderMeta = document.querySelector(".database-order-items-panel .editor-meta");
const selectedOrderActionsMenu = document.querySelector("#selectedOrderActionsMenu");
const addSelectedOrderToBatchButton = document.querySelector("#addSelectedOrderToBatchButton");
const skipSelectedOrderButton = document.querySelector("#skipSelectedOrderButton");
const reopenSelectedOrderButton = document.querySelector("#reopenSelectedOrderButton");
const addCheckedOrdersToBatchButton = document.querySelector("#addCheckedOrdersToBatchButton");
const skipCheckedOrdersButton = document.querySelector("#skipCheckedOrdersButton");
const reopenCheckedOrdersButton = document.querySelector("#reopenCheckedOrdersButton");
const editorToolsMenu = document.querySelector(".editor-tools-menu");
const presetToolsMenu = document.querySelector(".preset-tools-menu");
const batchActionLabelByButton = new Map(
  [addOrderButton, importClipboardButton, clearBatchButton, showColorCountsButton, exportCompletedButton, copyCompletedButton, pasteOrdersButton, addCheckedOrdersToBatchButton, addSelectedOrderToBatchButton, skipCheckedOrdersButton, reopenCheckedOrdersButton, skipSelectedOrderButton, reopenSelectedOrderButton]
    .filter(Boolean)
    .map((button) => [button, button.querySelector(".batch-tool-label")]),
);
const colorCountsDialog = document.querySelector("#colorCountsDialog");
const closeColorCountsButton = document.querySelector("#closeColorCountsButton");
const pasteSummaryDialog = document.querySelector("#pasteSummaryDialog");
const pasteSummaryTarget = document.querySelector("#pasteSummaryTarget");
const pasteSummaryImportedCount = document.querySelector("#pasteSummaryImportedCount");
const pasteSummarySkippedCount = document.querySelector("#pasteSummarySkippedCount");
const pasteSummaryAddedCount = document.querySelector("#pasteSummaryAddedCount");
const closePasteSummaryButton = document.querySelector("#closePasteSummaryButton");
const pasteSummaryDoneButton = document.querySelector("#pasteSummaryDoneButton");
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
const savePresetAsDialog = document.querySelector("#savePresetAsDialog");
const savePresetAsForm = document.querySelector("#savePresetAsForm");
const savePresetAsNameInput = document.querySelector("#savePresetAsNameInput");
const savePresetAsStatus = document.querySelector("#savePresetAsStatus");
const savePresetAsCloseButton = document.querySelector("#savePresetAsCloseButton");
const savePresetAsCancelButton = document.querySelector("#savePresetAsCancelButton");
const orderSearchInput = document.querySelector("#orderSearchInput");
const orderCountOutput = document.querySelector("#orderCountOutput");
const orderItemCountOutput = document.querySelector("#orderItemCountOutput");
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
const presetListingIndicator = document.querySelector("#presetListingIndicator");
const weldExportedDesignInput = document.querySelector("#weldExportedDesignInput");
const boundingSizePresetInput = document.querySelector("#boundingSizePresetInput");
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
const insertFixedDesignButton = document.querySelector("#insertFixedDesignButton");
const saveAsNewPresetButton = document.querySelector("#saveAsNewPresetButton");
const overwritePresetButton = document.querySelector("#overwritePresetButton");
const assignPresetToListingButton = document.querySelector("#assignPresetToListingButton");
const reloadPresetButton = document.querySelector("#reloadPresetButton");
const insertFixedDesignDialog = document.querySelector("#insertFixedDesignDialog");
const closeInsertFixedDesignDialogButton = document.querySelector("#closeInsertFixedDesignDialogButton");
const cancelInsertFixedDesignButton = document.querySelector("#cancelInsertFixedDesignButton");
const insertFixedDesignConfirmButton = document.querySelector("#insertFixedDesignConfirmButton");
const insertFixedDesignSearchInput = document.querySelector("#insertFixedDesignSearchInput");
const insertFixedDesignList = document.querySelector("#insertFixedDesignList");
const insertFixedDesignPreviewImage = document.querySelector("#insertFixedDesignPreviewImage");
const insertFixedDesignPreviewEmptyState = document.querySelector("#insertFixedDesignPreviewEmptyState");
const insertFixedDesignSelectedName = document.querySelector("#insertFixedDesignSelectedName");
const insertFixedDesignSelectedMeta = document.querySelector("#insertFixedDesignSelectedMeta");
const insertFixedDesignSelectedFile = document.querySelector("#insertFixedDesignSelectedFile");
const insertFixedDesignStatus = document.querySelector("#insertFixedDesignStatus");
const captureButton = document.querySelector("#captureButton");
const cancelDesignButton = document.querySelector("#cancelDesignButton");
const completeNextButton = document.querySelector("#completeNextButton");
const presetLibraryList = document.querySelector("#presetLibraryList");
const presetSearchInput = document.querySelector("#presetSearchInput");
const newPresetDraftButton = document.querySelector("#newPresetDraftButton");
const presetDraftNameInput = document.querySelector("#presetDraftName");
const DEFAULT_PRESET_NAME_PLACEHOLDER = presetDraftNameInput?.getAttribute("placeholder") || "";
const savePresetButton = document.querySelector("#savePresetButton");
const cancelPresetButton = document.querySelector("#cancelPresetButton");
const deletePresetButton = document.querySelector("#deletePresetButton");
const presetWeldExportedDesignInput = document.querySelector("#presetWeldExportedDesignInput");
const presetBoundingSizePresetInput = document.querySelector("#presetBoundingSizePresetInput");
const presetGlobalHorizontalScaleInput = document.querySelector("#presetGlobalHorizontalScaleInput");
const presetGlobalHorizontalScaleOutput = document.querySelector("#presetGlobalHorizontalScaleOutput");
const presetGlobalVerticalScaleInput = document.querySelector("#presetGlobalVerticalScaleInput");
const presetGlobalVerticalScaleOutput = document.querySelector("#presetGlobalVerticalScaleOutput");
const presetBackingInput = document.querySelector("#presetBackingInput");
const presetBackingOutput = document.querySelector("#presetBackingOutput");
const presetLineRuleControls = document.querySelector("#presetLineRuleControls");
const presetFixedItemList = document.querySelector("#presetFixedItemList");
const presetFixedItemsEmptyState = document.querySelector("#presetFixedItemsEmptyState");
const presetFixedDesignsList = document.querySelector("#presetFixedDesignsList");
const presetFixedDesignsEmptyState = document.querySelector("#presetFixedDesignsEmptyState");
const presetAssignmentsList = document.querySelector("#presetAssignmentsList");
const presetAssignmentsEmptyState = document.querySelector("#presetAssignmentsEmptyState");
const sizePresetList = document.querySelector("#sizePresetList");
const sizePresetNameInput = document.querySelector("#sizePresetNameInput");
const sizePresetMaxWidthInput = document.querySelector("#sizePresetMaxWidthInput");
const sizePresetMaxHeightInput = document.querySelector("#sizePresetMaxHeightInput");
const sizePresetMinWidthInput = document.querySelector("#sizePresetMinWidthInput");
const sizePresetMinHeightInput = document.querySelector("#sizePresetMinHeightInput");
const sizePresetCircleDiameterInput = document.querySelector("#sizePresetCircleDiameterInput");
const sizePresetPreview = document.querySelector("#sizePresetPreview");
const sizePresetPreviewEmptyState = document.querySelector("#sizePresetPreviewEmptyState");
const newSizePresetButton = document.querySelector("#newSizePresetButton");
const saveSizePresetButton = document.querySelector("#saveSizePresetButton");
const cancelSizePresetButton = document.querySelector("#cancelSizePresetButton");
const deleteSizePresetButton = document.querySelector("#deleteSizePresetButton");
const sizePresetEditorStatus = document.querySelector("#sizePresetEditorStatus");
const presetEditorStatus = document.querySelector("#presetEditorStatus");
const editorActionLabelByButton = new Map(
  [captureButton, cancelDesignButton, completeNextButton, copyButton, copyLayoutControlsButton, pasteLayoutControlsButton, downloadButton]
    .filter(Boolean)
    .map((button) => [button, button.querySelector(".editor-action-label")]),
);
let workflowAlertHideTimer = null;
let workflowAlertToken = 0;
let selectedSizePresetId = null;
let sizePresetEditorBaselineKey = null;
let sizePresetEditorDraftActive = false;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const MASK_SCALE = 3;
const MASK_PADDING_PX = 12;
const OUTLINE_BRIDGE_SAFETY_MM = 1 / (PX_PER_MM * MASK_SCALE);
const measuredLineCache = new Map();
let lastLayout = null;
let zoom = DEFAULT_ZOOM;
let previewMiddlePan = null;
const previewTouchPointers = new Map();
let previewPinchState = null;
let previewTouchPan = null;
let orderSequence = 1;
let activeOrderItemId = null;
const orders = [];
let batchPersistenceTimeoutId = null;
let orderListRenderFrameId = null;
let deferredPreviewRenderToken = 0;
let suppressBatchSyncLocalNotice = false;
let copiedLayoutControlsSnapshot = null;
const initialAppRoute = readAppRoute();
let activeWorkspace = initialAppRoute.workspace;
let databaseOrders = [];
let selectedDatabaseOrderId = initialAppRoute.workspace === "databaseOrders" ? initialAppRoute.itemId : null;
let checkedDatabaseOrderIds = new Set();
let databaseOrdersLoading = false;
let databaseOrdersImporting = false;
let ordersDatabaseMutationInFlight = false;
let databaseOrdersMutationVersion = 0;
let loadedDatabaseOrdersKey = null;
let databaseOrdersSearchTerm = "";
let databaseOrdersStatusFilterValue = "open";
let databaseOrdersBatchFilterValue = "all";
let selectedFontId = "candlepin";
let showDeletedFonts = false;
let fixedDesignRecords = [];
let selectedFixedDesignId = initialAppRoute.workspace === "fixedDesigns" ? initialAppRoute.itemId : null;
let fixedDesignSearchTerm = "";
let fixedDesignsLoading = false;
let fixedDesignsLoaded = false;
let fixedDesignsLoadRequestId = 0;
let insertFixedDesignSearchTerm = "";
let insertFixedDesignSelectedId = null;
let insertFixedDesignStatusMessage = "";
let insertFixedDesignStatusState = "pending";
let stagedFixedDesignVersionFile = null;
let stagedFixedDesignVersionPreviewUrl = null;
let fixedDesignVersionDialogMode = "replace";
let navCollapsed = readNavCollapsedPreference();
let presetEditorDraft = null;
let presetEditorBaselineKey = null;
let presetLibrarySearchTerm = "";
let activeConfirmationRequest = null;
let confirmationDialogRestoreFocusTarget = null;
let activeSavePresetAsRequest = null;
let batchSessionContext = null;
let productionBatchContext = null;
let productionBatchAutosaveTimeoutId = null;
let productionBatchAutosaveInFlight = false;
let productionBatchAutosavePending = false;
let suppressProductionBatchAutosave = false;
let lastProductionBatchSaveKey = null;
let productionBatchSyncState = "disabled";
let productionBatchSyncDetail = "";
let productionBatchConflictState = null;
let productionBatchAccessToken = null;
let workflowAlertActionHandler = null;
let appRouteWriteCount = 0;

function readProductionBatchAccessTokenOverride() {
  return globalThis.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ ?? null;
}

function safeDecodeRouteSegment(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readAppRoute() {
  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodeRouteSegment);
  const workspace = WORKSPACE_BY_ROUTE_SEGMENT[segments[0]] || DEFAULT_WORKSPACE;

  return {
    workspace,
    itemId: typeof segments[1] === "string" && segments[1] ? segments[1] : null,
  };
}

function buildAppPath(workspace = activeWorkspace, itemId = null) {
  const routeSegment = WORKSPACE_ROUTE_SEGMENTS[workspace] || WORKSPACE_ROUTE_SEGMENTS[DEFAULT_WORKSPACE];
  const normalizedItemId = typeof itemId === "string" && itemId.trim() ? itemId.trim() : "";
  return normalizedItemId
    ? `/${routeSegment}/${encodeURIComponent(normalizedItemId)}`
    : `/${routeSegment}`;
}

function getWorkspaceRouteItemId(workspace = activeWorkspace) {
  if (workspace === "databaseOrders") {
    return selectedDatabaseOrderId;
  }
  if (workspace === "orders") {
    return activeOrderItemId;
  }
  if (workspace === "presets") {
    return presetEditorDraft?.preset?.id || null;
  }
  if (workspace === "fonts") {
    return selectedFontId;
  }
  if (workspace === "fixedDesigns") {
    return selectedFixedDesignId;
  }
  if (workspace === "sizeGuides") {
    return selectedSizePresetId;
  }

  return null;
}

function writeAppRoute({ replace = false, workspace = activeWorkspace, itemId = getWorkspaceRouteItemId(workspace) } = {}) {
  const nextPath = buildAppPath(workspace, itemId);
  if (window.location.pathname === nextPath) {
    return;
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextPath);
  appRouteWriteCount += 1;
}

function applyRouteWorkspace(route, options = {}) {
  setActiveWorkspace(route?.workspace || DEFAULT_WORKSPACE, {
    updateRoute: false,
    ...options,
  });
}

function applyRouteSelection(route, options = {}) {
  const { replaceRoute = false } = options;
  const workspace = route?.workspace || DEFAULT_WORKSPACE;
  const itemId = route?.itemId || null;

  applyRouteWorkspace({ workspace }, { updateRoute: false });

  if (workspace === "databaseOrders") {
    if (itemId) {
      selectDatabaseOrder(itemId, { updateRoute: false });
    } else {
      renderDatabaseOrdersWorkspace();
    }
    writeAppRoute({ replace: replaceRoute, workspace, itemId: itemId && selectedDatabaseOrderId === itemId ? itemId : null });
    return;
  }

  if (workspace === "orders") {
    if (itemId && activeOrderItemId === itemId) {
      const activeOrder = getActiveOrder();
      if (activeOrder) {
        applySettings(activeOrder.settings);
        renderOrderList();
      }
    } else if (itemId) {
      selectOrder(itemId, { updateRoute: false, persistSelection: false });
    } else {
      renderOrderList();
    }
    writeAppRoute({ replace: replaceRoute, workspace, itemId: itemId && activeOrderItemId === itemId ? itemId : null });
    return;
  }

  if (workspace === "presets") {
    if (itemId && getPresetDefinitionForEditor(itemId)) {
      selectPresetEditorRow(itemId, { updateRoute: false });
      writeAppRoute({ replace: replaceRoute, workspace, itemId });
      return;
    }
    selectFirstPresetEditorRowIfNeeded();
    writeAppRoute({ replace: replaceRoute, workspace, itemId: null });
    return;
  }

  if (workspace === "fonts") {
    if (itemId && FONT_BY_ID.has(itemId)) {
      selectedFontId = itemId;
    }
    renderFontWorkspace();
    writeAppRoute({
      replace: replaceRoute,
      workspace,
      itemId: itemId && selectedFontId === itemId ? itemId : null,
    });
    return;
  }

  if (workspace === "fixedDesigns") {
    if (itemId) {
      selectedFixedDesignId = itemId;
    }
    renderFixedDesignWorkspace();
    writeAppRoute({
      replace: replaceRoute,
      workspace,
      itemId: itemId && selectedFixedDesignId === itemId ? itemId : null,
    });
    return;
  }

  if (workspace === "sizeGuides") {
    if (itemId && getBoundingSizePresetDefinitionsForEditor().some((preset) => preset.id === itemId)) {
      selectSizePresetForEditing(itemId, { updateRoute: false });
      writeAppRoute({ replace: replaceRoute, workspace, itemId });
      return;
    }
    selectFirstSizePresetIfNeeded();
    writeAppRoute({ replace: replaceRoute, workspace, itemId: null });
  }
}

async function applyCurrentAppRoute(options = {}) {
  const { replaceRoute = false, route = readAppRoute() } = options;

  if (route.workspace === "databaseOrders" && route.itemId) {
    selectedDatabaseOrderId = route.itemId;
  }

  if (route.workspace === "databaseOrders" && productionBatchAccessToken) {
    await loadDatabaseOrders();
  }

  applyRouteSelection(route, { replaceRoute });
}

function setProductionBatchAuthError(message) {
  if (!productionBatchAuthError) {
    return;
  }

  const normalized = typeof message === "string" ? message.trim() : "";
  productionBatchAuthError.textContent = normalized;
  productionBatchAuthError.hidden = !normalized;
}

function renderProductionBatchLogoutButton() {
  if (!productionBatchLogoutButton) {
    return;
  }

  const hasProductionBatchSession = typeof productionBatchAccessToken === "string" && productionBatchAccessToken.trim().length > 0;
  productionBatchLogoutButton.hidden = !hasProductionBatchSession;
  productionBatchLogoutButton.disabled = !hasProductionBatchSession;
}

function showProductionBatchAuthGate({ title, message, error = "", allowSignIn = true }) {
  productionBatchAccessToken = null;
  if (productionBatchAuthTitle) {
    productionBatchAuthTitle.textContent = title;
  }
  if (productionBatchAuthMessage) {
    productionBatchAuthMessage.textContent = message;
  }
  if (productionBatchSignInForm) {
    productionBatchSignInForm.hidden = !allowSignIn;
  }
  if (productionBatchSignInButton) {
    productionBatchSignInButton.disabled = !allowSignIn;
  }
  if (workspaceStage) {
    workspaceStage.hidden = true;
  }
  if (productionBatchAuthGate) {
    productionBatchAuthGate.hidden = false;
  }
  setProductionBatchAuthError(error);
  renderProductionBatchLogoutButton();
}

function hideProductionBatchAuthGate() {
  if (productionBatchAuthGate) {
    productionBatchAuthGate.hidden = true;
  }
  if (workspaceStage) {
    workspaceStage.hidden = false;
  }
  setProductionBatchAuthError("");
  renderProductionBatchLogoutButton();
}

function showProductionBatchConfigError(error) {
  const detail = error instanceof Error && error.message
    ? error.message
    : "Production batch configuration is missing.";
  showProductionBatchAuthGate({
    title: "Production batch configuration is missing.",
    message: "This app cannot load or save shared designs until Supabase browser settings are configured.",
    error: detail,
    allowSignIn: false,
  });
}

function showProductionBatchSignIn(error = "") {
  showProductionBatchAuthGate({
    title: "Sign in to production batch",
    message: "Use your invited operator account to continue. Contact your admin if you still need access.",
    error,
    allowSignIn: true,
  });
}

function isProductionBatchAuthenticationError(error) {
  return Boolean(
    error instanceof Error
      && typeof error.message === "string"
      && /authentication required/i.test(error.message),
  );
}

function handleProductionBatchAuthenticationRequired(detail = "Production batch session expired. Sign in again to continue.") {
  batchSessionContext = null;
  productionBatchAccessToken = null;
  disableProductionBatchSync(detail);
  showProductionBatchSignIn(detail);
  renderProductionBatchToast();
}

async function bootstrapProductionBatchAccess() {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });

  const accessTokenOverride = readProductionBatchAccessTokenOverride();
  if (accessTokenOverride) {
    productionBatchAccessToken = accessTokenOverride;
    hideProductionBatchAuthGate();
    return productionBatchAccessToken;
  }

  let session = null;

  try {
    session = await getSignedInSession();
  } catch (error) {
    showProductionBatchConfigError(error);
    return null;
  }

  if (!session?.access_token) {
    showProductionBatchSignIn();
    return null;
  }

  productionBatchAccessToken = session.access_token;
  hideProductionBatchAuthGate();
  return productionBatchAccessToken;
}

async function handleProductionBatchSignInSubmit(event) {
  event.preventDefault();

  const email = typeof productionBatchEmailInput?.value === "string" ? productionBatchEmailInput.value.trim() : "";
  const password = typeof productionBatchPasswordInput?.value === "string" ? productionBatchPasswordInput.value : "";

  if (!email || !password) {
    showProductionBatchSignIn("Enter your email and password to continue.");
    return;
  }

  if (productionBatchSignInButton) {
    productionBatchSignInButton.disabled = true;
  }
  setProductionBatchAuthError("");

  try {
    const session = await signInOperatorWithPassword(email, password);
    productionBatchAccessToken = session?.access_token ?? null;
    if (!productionBatchAccessToken) {
      throw new Error("Sign-in succeeded, but no production batch session is available yet.");
    }
    hideProductionBatchAuthGate();
    window.location.reload();
  } catch (error) {
    showProductionBatchSignIn(
      error instanceof Error && error.message
        ? error.message
        : "Unable to sign in to the production batch.",
    );
  } finally {
    if (productionBatchSignInButton) {
      productionBatchSignInButton.disabled = false;
    }
  }
}

async function handleProductionBatchSignOut() {
  if (productionBatchLogoutButton) {
    productionBatchLogoutButton.disabled = true;
  }

  try {
    await signOutBrowserSession();
    batchSessionContext = null;
    productionBatchAccessToken = null;
    if (productionBatchEmailInput) {
      productionBatchEmailInput.value = "";
    }
    if (productionBatchPasswordInput) {
      productionBatchPasswordInput.value = "";
    }
    disableProductionBatchSync("You signed out of the production batch.");
    window.location.reload();
  } catch (error) {
    showProductionBatchSignIn(
      error instanceof Error && error.message
        ? error.message
        : "Unable to sign out of the production batch.",
    );
  } finally {
    renderProductionBatchLogoutButton();
  }
}

const statusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  captured: "Complete",
  exported: "Exported",
};
const DEFAULT_FONT_PREVIEW_TEXT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz";
let fontPreviewText = DEFAULT_FONT_PREVIEW_TEXT;

function getFontOption(fontId) {
  return resolveFontOption(fontId, FONT_OPTIONS);
}

function getCanvasFont(fontSizePx, fontId) {
  return `${fontSizePx}px "${getFontOption(fontId).family}", "Segoe Script", cursive`;
}

function setFontOptions(fontOptions) {
  FONT_OPTIONS = fontOptions.length ? fontOptions : buildFontOptions();
  FONT_BY_ID = new Map(FONT_OPTIONS.map((font) => [font.id, font]));
  if (!FONT_BY_ID.has(selectedFontId)) {
    selectedFontId = FONT_OPTIONS[0]?.id || "candlepin";
  }
}

async function refreshWorkspaceFonts(accessToken = null) {
  try {
    setFontOptions(await loadWorkspaceFontOptions({ accessToken, includeDeleted: true }));
    await registerBrowserFonts(FONT_OPTIONS.filter((font) => font.isUploaded && !font.isDeleted));
  } catch {
    setFontOptions(buildFontOptions());
  }
  renderFontWorkspace();
}

async function buildFontUploadPayload(file, displayName = "") {
  const buffer = Array.from(new Uint8Array(await file.arrayBuffer()));
  return {
    displayName,
    file: {
      name: file.name,
      type: file.type,
      size: file.size,
      buffer,
    },
  };
}

function setFontEditorStatus(message, state = "pending") {
  if (!fontEditorStatus) {
    return;
  }
  fontEditorStatus.textContent = message;
  fontEditorStatus.dataset.state = state;
}

function getFontDisplayNameDraft() {
  return fontDisplayNameInput?.value.trim() || "";
}

function updateSaveFontDisplayNameButton() {
  if (!saveFontDisplayNameButton) {
    return;
  }

  const selectedFont = getFontOption(selectedFontId);
  const persistedDisplayName = String(selectedFont.displayName || selectedFont.label || "").trim();
  const draftDisplayName = getFontDisplayNameDraft();
  saveFontDisplayNameButton.disabled = !draftDisplayName || draftDisplayName === persistedDisplayName;
}

function createDefaultLineSettings() {
  return {
    kind: "text",
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

function createFixedDesignLineSettings(fixedDesign) {
  return {
    kind: "fixedSvg",
    fixedDesignId: fixedDesign.id,
    fixedDesignName: fixedDesign.displayName,
    fixedDesignVersion: fixedDesign.version,
    svgSizeMm: 32,
    offsetXMm: 0,
    offsetYMm: 0,
  };
}

function getPresetBaseSettings(presetId) {
  const globalDefaults = getPresetGlobalDefaults(presetId);

  return {
    boundingSizePresetId: isValidBoundingSizePresetId(globalDefaults.boundingSizePresetId)
      ? globalDefaults.boundingSizePresetId
      : DEFAULT_BOUNDING_SIZE_PRESET_ID,
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
  if (lineSettings.kind === "fixedSvg") {
    return {
      kind: "fixedSvg",
      fixedDesignId: typeof lineSettings.fixedDesignId === "string" ? lineSettings.fixedDesignId : null,
      fixedDesignName: typeof lineSettings.fixedDesignName === "string" ? lineSettings.fixedDesignName : "",
      fixedDesignVersion: Number.isFinite(Number(lineSettings.fixedDesignVersion))
        ? Number(lineSettings.fixedDesignVersion)
        : null,
      svgSizeMm: Number.isFinite(Number(lineSettings.svgSizeMm)) ? Number(lineSettings.svgSizeMm) : 32,
      offsetXMm: Number.isFinite(Number(lineSettings.offsetXMm)) ? Number(lineSettings.offsetXMm) : 0,
      offsetYMm: Number.isFinite(Number(lineSettings.offsetYMm)) ? Number(lineSettings.offsetYMm) : 0,
    };
  }

  return {
    kind: "text",
    fontId: typeof lineSettings.fontId === "string" && lineSettings.fontId.trim() ? lineSettings.fontId.trim() : DEFAULT_LINE_SETTINGS.fontId,
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

function applyFontBridgePolicy(lineSettings) {
  if (!lineSettings || lineSettings.kind === "fixedSvg") {
    return lineSettings;
  }

  const font = getFontOption(lineSettings.fontId);
  const fontBridgingEnabled = font.bridgingEnabled !== false;
  return {
    ...lineSettings,
    bridgeMm: fontBridgingEnabled ? lineSettings.bridgeMm : 0,
    lineBridgeMm: fontBridgingEnabled ? lineSettings.lineBridgeMm : 0,
    fontBridgingEnabled,
  };
}

function buildNormalizedLineSettings(rawLines, configuredLines, presetId) {
  if (!Array.isArray(configuredLines)) {
    return rawLines.map((_, index) => normalizeLineSettings({
      kind: "text",
      fontId: DEFAULT_LINE_SETTINGS.fontId,
      bridgeMm: configuredLines?.bridgeMm,
      lineBridgeMm: configuredLines?.lineBridgeMm,
      offsetXMm: configuredLines?.offsetXMm,
      fontSizeMm: configuredLines?.fontSizeMm,
    }));
  }

  const normalizedLines = [];
  let textLineIndex = 0;

  configuredLines.forEach((lineSettings) => {
    if (lineSettings?.kind === "fixedSvg") {
      normalizedLines.push(normalizeLineSettings(lineSettings));
      return;
    }

    if (textLineIndex < rawLines.length) {
      normalizedLines.push(normalizeLineSettings(lineSettings));
      textLineIndex += 1;
    }
  });

  while (textLineIndex < rawLines.length) {
    normalizedLines.push(normalizeLineSettings(createPresetLineSettings(presetId, textLineIndex)));
    textLineIndex += 1;
  }

  return normalizedLines;
}

function isFixedSvgLineSettings(lineSettings) {
  return lineSettings?.kind === "fixedSvg";
}

function settingsIncludeFixedSvg(settings = {}) {
  return normalizeSettings(settings).lines.some(isFixedSvgLineSettings);
}

function orderHasRenderableDesign(order) {
  return Boolean(order?.text?.trim() || settingsIncludeFixedSvg(order?.settings));
}

function restoredOrdersIncludeFixedSvgs() {
  return orders.some((order) => settingsIncludeFixedSvg(order.settings));
}

async function ensureFixedDesignRecordsForSettings(settings = getCurrentSettings()) {
  if (!settingsNeedFixedDesignRecords(settings, { recordsLoaded: fixedDesignsLoaded })) {
    return false;
  }

  const accessToken = productionBatchAccessToken || readProductionBatchAccessTokenOverride() || await getAccessToken();
  if (!accessToken) {
    return false;
  }

  productionBatchAccessToken = accessToken;
  await refreshWorkspaceFixedDesigns(accessToken);
  return fixedDesignsLoaded;
}

function countFixedSvgLines(settings = {}) {
  return normalizeSettings(settings).lines.filter(isFixedSvgLineSettings).length;
}

function parseSvgViewBoxAspectRatio(fixedDesign) {
  const metadataAspectRatio = Number(fixedDesign?.metadata?.aspectRatio);
  if (Number.isFinite(metadataAspectRatio) && metadataAspectRatio > 0) {
    return metadataAspectRatio;
  }

  const metadataWidth = Number(fixedDesign?.metadata?.width);
  const metadataHeight = Number(fixedDesign?.metadata?.height);
  if (Number.isFinite(metadataWidth) && metadataWidth > 0 && Number.isFinite(metadataHeight) && metadataHeight > 0) {
    return metadataWidth / metadataHeight;
  }

  const viewBox = typeof fixedDesign?.metadata?.viewBox === "string"
    ? fixedDesign.metadata.viewBox
    : "";
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
    return parts[2] / parts[3];
  }

  return 1;
}

function buildFixedSvgLayoutItems(lines, layoutWidthMm, layoutHeightMm) {
  const centerX = layoutWidthMm / 2;
  const centerY = layoutHeightMm / 2;

  return lines
    .filter(isFixedSvgLineSettings)
    .map((line) => {
      const fixedDesign = resolveFixedDesignReference(line, fixedDesignRecords);
      const sizeMm = Math.max(1, Number(line.svgSizeMm) || 32);
      const aspectRatio = parseSvgViewBoxAspectRatio(fixedDesign);
      const heightMm = sizeMm;
      const widthMm = sizeMm * aspectRatio;

      return {
        id: fixedDesign.id || line.fixedDesignId || "",
        name: fixedDesign.displayName || line.fixedDesignName || "Fixed design",
        version: fixedDesign.version || line.fixedDesignVersion || 1,
        publicUrl: fixedDesign.publicUrl || null,
        state: fixedDesign.state || "missing",
        stateLabel: fixedDesign.stateLabel || "Missing",
        xMm: centerX + Number(line.offsetXMm || 0) - widthMm / 2,
        yMm: centerY + Number(line.offsetYMm || 0) - heightMm / 2,
        widthMm,
        heightMm,
        svgSizeMm: sizeMm,
        offsetXMm: Number(line.offsetXMm || 0),
        offsetYMm: Number(line.offsetYMm || 0),
      };
    });
}

function expandLayoutForFixedSvgs({ widthMm, heightMm, textBoundsMm, letters, fixedSvgs }) {
  if (!fixedSvgs.length) {
    return {
      widthMm,
      heightMm,
      textBoundsMm,
      letters,
      fixedSvgs,
    };
  }

  const minX = Math.min(0, ...fixedSvgs.map((item) => item.xMm));
  const minY = Math.min(0, ...fixedSvgs.map((item) => item.yMm));
  const maxX = Math.max(widthMm, ...fixedSvgs.map((item) => item.xMm + item.widthMm));
  const maxY = Math.max(heightMm, ...fixedSvgs.map((item) => item.yMm + item.heightMm));
  const shiftX = -minX;
  const shiftY = -minY;

  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    textBoundsMm: {
      ...textBoundsMm,
      left: textBoundsMm.left + shiftX,
      top: textBoundsMm.top + shiftY,
    },
    letters: letters.map((letter) => ({
      ...letter,
      x: letter.x + shiftX,
      y: letter.y + shiftY,
    })),
    fixedSvgs: fixedSvgs.map((item) => ({
      ...item,
      xMm: item.xMm + shiftX,
      yMm: item.yMm + shiftY,
    })),
  };
}

function layoutNeedsFixedSvgEnrichment(layout, settings = {}) {
  const expectedCount = countFixedSvgLines(settings);
  if (!expectedCount) {
    return false;
  }

  const fixedSvgs = Array.isArray(layout?.fixedSvgs) ? layout.fixedSvgs : [];
  if (fixedSvgs.length < expectedCount) {
    return true;
  }

  return fixedSvgs.some((fixedSvg) => {
    const fixedDesign = fixedDesignRecords.find((record) => record.id === fixedSvg.id);
    return fixedDesign?.publicUrl && fixedSvg.publicUrl !== fixedDesign.publicUrl;
  });
}

function enrichCachedLayoutWithFixedSvgs(layout, settings = {}) {
  if (!layoutNeedsFixedSvgEnrichment(layout, settings)) {
    return layout;
  }

  const normalized = normalizeSettings(settings);
  const widthMm = Number.isFinite(Number(layout?.widthMm)) ? Number(layout.widthMm) : 1;
  const heightMm = Number.isFinite(Number(layout?.heightMm)) ? Number(layout.heightMm) : 1;
  const fixedSvgs = buildFixedSvgLayoutItems(normalized.lines, widthMm, heightMm);
  const expanded = expandLayoutForFixedSvgs({
    widthMm,
    heightMm,
    textBoundsMm: layout?.textBoundsMm && typeof layout.textBoundsMm === "object"
      ? layout.textBoundsMm
      : { left: 0, top: 0, width: widthMm, height: heightMm },
    letters: Array.isArray(layout?.letters) ? layout.letters : [],
    fixedSvgs,
  });

  return {
    ...layout,
    widthMm: expanded.widthMm,
    heightMm: expanded.heightMm,
    textBoundsMm: expanded.textBoundsMm,
    letters: expanded.letters,
    fixedSvgs: expanded.fixedSvgs,
  };
}

function enrichCachedBuildForOrder(order, build) {
  if (!build?.layout) {
    return build;
  }

  return {
    ...build,
    layout: enrichCachedLayoutWithFixedSvgs(build.layout, order?.settings),
  };
}

function getTextLineItemsFromSettings(settings = {}) {
  const normalized = normalizeSettings(settings);
  const rawLines = getRawTextLines(normalized.text);
  let textLineIndex = 0;

  return normalized.lines.flatMap((line, settingsIndex) => {
    if (isFixedSvgLineSettings(line)) {
      return [];
    }

    const item = {
      line,
      settingsIndex,
      textLineIndex,
      text: rawLines[textLineIndex] ?? "",
    };
    textLineIndex += 1;
    return [item];
  });
}

function normalizeSettings(settings = {}) {
  const text = typeof settings.text === "string" ? settings.text : "";
  const rawLines = getRawTextLines(text);
  const defaultPresetId = getDefaultPresetId();
  const presetId = isValidPresetId(settings.presetId)
    ? settings.presetId
    : defaultPresetId;
  const presetBaseSettings = getPresetBaseSettings(presetId);
  const configuredLines = Array.isArray(settings.lines)
    ? settings.lines
    : {
        bridgeMm: settings.bridgeMm,
        lineBridgeMm: settings.lineBridgeMm,
        offsetXMm: settings.offsetXMm,
        fontSizeMm: settings.fontSizeMm,
      };

  return {
    text,
    presetId,
    boundingSizePresetId: isValidBoundingSizePresetId(settings.boundingSizePresetId)
      ? settings.boundingSizePresetId
      : presetBaseSettings.boundingSizePresetId,
    boundingSizePresetFingerprint: buildBoundingSizePresetFingerprint(
      isValidBoundingSizePresetId(settings.boundingSizePresetId)
        ? settings.boundingSizePresetId
        : presetBaseSettings.boundingSizePresetId,
    ),
    backingMm: Number.isFinite(Number(settings.backingMm)) ? Number(settings.backingMm) : presetBaseSettings.backingMm,
    weldExportedDesign: typeof settings.weldExportedDesign === "boolean"
      ? settings.weldExportedDesign
      : presetBaseSettings.weldExportedDesign,
    lines: buildNormalizedLineSettings(rawLines, configuredLines, presetId).map(applyFontBridgePolicy),
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
  if (state !== "running" && state !== "ok" && state !== "warning" && state !== "error") {
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

function normalizeStoredPublishedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const id = typeof snapshot.id === "string" ? snapshot.id.trim() : "";
  if (!id) {
    return null;
  }

  const text = typeof snapshot.text === "string"
    ? snapshot.text
    : typeof snapshot.settings?.text === "string"
      ? snapshot.settings.text
      : "";

  return {
    id,
    revision: normalizeStoredRevision(snapshot.revision),
    updatedAt: normalizeStoredUpdatedAt(snapshot.updatedAt),
    updatedBy: normalizeStoredAuditActor(snapshot.updatedBy),
    text,
    status: isValidOrderStatus(snapshot.status) ? snapshot.status : "in-progress",
    settings: normalizeSettings({
      ...(snapshot.settings && typeof snapshot.settings === "object" ? snapshot.settings : {}),
      text,
    }),
    source: normalizeStoredSource(snapshot.source),
    cachedBuild: normalizeStoredCachedBuild(snapshot.cachedBuild),
    previousCompletedBuild: normalizeStoredCachedBuild(snapshot.previousCompletedBuild),
    savedSettingsSignature: normalizeStoredSignature(snapshot.savedSettingsSignature),
    completedSettingsSignature: normalizeStoredSignature(snapshot.completedSettingsSignature),
    analysisBadge: normalizeStoredAnalysisBadge(snapshot.analysisBadge),
    pendingAnalysisSignature: normalizeStoredSignature(snapshot.pendingAnalysisSignature),
  };
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

  return enrichCachedBuildForOrder(order, getStoredBuildForSignature(order.cachedBuild, null, signature));
}

function getBuildForSignature(order, signature) {
  const signatureCandidates = toSignatureCandidates(signature);
  if (!orderHasRenderableDesign(order) || !signatureCandidates.length) {
    return null;
  }

  const storedBuild = getStoredBuildForSignature(order.cachedBuild, order.previousCompletedBuild, signatureCandidates);
  if (storedBuild) {
    return enrichCachedBuildForOrder(order, storedBuild);
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
      layout: enrichCachedLayoutWithFixedSvgs(layout, order.settings),
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
      fixedSvgs: Array.isArray(layout.fixedSvgs) ? layout.fixedSvgs : [],
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

async function fetchFixedSvgText(fixedSvg) {
  if (!fixedSvg || fixedSvg.svgText || !fixedSvg.publicUrl) {
    return fixedSvg;
  }

  try {
    const response = await fetch(fixedSvg.publicUrl);
    if (!response.ok) {
      return fixedSvg;
    }

    const svgText = await response.text();
    if (!svgText.trim()) {
      return fixedSvg;
    }

    return {
      ...fixedSvg,
      svgText,
    };
  } catch {
    return fixedSvg;
  }
}

async function enrichExportLayoutWithFixedSvgText(layout) {
  if (!layout || !Array.isArray(layout.fixedSvgs) || !layout.fixedSvgs.length) {
    return layout;
  }

  return {
    ...layout,
    fixedSvgs: await Promise.all(layout.fixedSvgs.map(fetchFixedSvgText)),
  };
}

async function enrichExportPayloadWithFixedSvgText(payload) {
  if (!payload) {
    return payload;
  }

  if (Array.isArray(payload.layouts)) {
    return {
      ...payload,
      layouts: await Promise.all(payload.layouts.map(enrichExportLayoutWithFixedSvgText)),
    };
  }

  return enrichExportLayoutWithFixedSvgText(payload);
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

function renderBoundingSizePresetOptions(selectElement) {
  if (!selectElement) {
    return;
  }

  const selectedValue = selectElement.value;
  selectElement.replaceChildren(...getBoundingSizePresetOptions().map((option) => {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    return element;
  }));
  selectElement.value = isValidBoundingSizePresetId(selectedValue)
    ? selectedValue
    : DEFAULT_BOUNDING_SIZE_PRESET_ID;
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
          boundingSizePresetId: DEFAULT_BOUNDING_SIZE_PRESET_ID,
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
    boundingSizePresetId: isValidBoundingSizePresetId(globalDefaults.boundingSizePresetId)
      ? globalDefaults.boundingSizePresetId
      : DEFAULT_BOUNDING_SIZE_PRESET_ID,
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

  getSelectableFontOptions(FONT_OPTIONS, fontId).forEach((font) => {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.label;
    option.selected = font.id === fontId;
    option.disabled = Boolean(font.isDeleted);
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

function createPresetFixedItemCard(item, index) {
  const normalized = normalizeLineSettings({
    ...item,
    kind: "fixedSvg",
  });
  const fixedDesign = resolveFixedDesignReference(normalized, fixedDesignRecords);
  const displayName = fixedDesign.displayName || normalized.fixedDesignName || "Fixed design";
  const version = Number.isFinite(Number(normalized.fixedDesignVersion))
    ? Number(normalized.fixedDesignVersion)
    : Number(fixedDesign.version) || null;

  const card = document.createElement("article");
  card.className = "preset-fixed-item-card line-control-card";
  card.dataset.fixedDesignId = normalized.fixedDesignId || "";
  card.dataset.fixedItemIndex = String(index);

  const header = document.createElement("div");
  header.className = "line-control-header";

  const title = document.createElement("h3");
  title.className = "preset-line-control-title";
  title.textContent = `Fixed Design: ${displayName}`;

  const summary = document.createElement("span");
  summary.className = "line-control-text";
  summary.textContent = version ? `v${version}` : "Fixed SVG";

  header.append(title, summary);

  const grid = document.createElement("div");
  grid.className = "line-control-grid";
  grid.append(
    createPresetEditorRangeField(`fixed:${index}`, "svgSizeMm", "Vertical Size", 5, 80, 0.5, normalized.svgSizeMm),
    createPresetEditorRangeField(`fixed:${index}`, "offsetXMm", "Horizontal Offset", -30, 30, 0.1, normalized.offsetXMm),
    createPresetEditorRangeField(`fixed:${index}`, "offsetYMm", "Vertical Offset From Center", -30, 30, 0.1, normalized.offsetYMm),
  );

  card.append(header, grid);
  return card;
}

function renderPresetEditorFixedItems() {
  if (!presetFixedItemList || !presetFixedItemsEmptyState) {
    return;
  }

  const fixedItems = Array.isArray(presetEditorDraft?.preset?.fixedItems)
    ? presetEditorDraft.preset.fixedItems.filter(isFixedSvgLineSettings)
    : [];
  presetFixedItemList.replaceChildren();
  presetFixedItemsEmptyState.hidden = fixedItems.length > 0;

  if (!fixedItems.length) {
    return;
  }

  presetFixedItemList.append(...fixedItems.map(createPresetFixedItemCard));
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

function readPresetEditorFixedItems(fallbackItems = []) {
  const cards = Array.from(presetFixedItemList?.querySelectorAll("[data-fixed-item-index]") || []);
  if (!cards.length) {
    return Array.isArray(fallbackItems) ? structuredClone(fallbackItems) : [];
  }

  return cards
    .map((card) => {
      const index = Number(card.dataset.fixedItemIndex);
      const fallback = normalizeLineSettings({
        ...(Array.isArray(fallbackItems) ? fallbackItems[index] : {}),
        kind: "fixedSvg",
      });
      const svgSizeInput = card.querySelector('[data-setting="svgSizeMm"]');
      const offsetXInput = card.querySelector('[data-setting="offsetXMm"]');
      const offsetYInput = card.querySelector('[data-setting="offsetYMm"]');

      return {
        kind: "fixedSvg",
        fixedDesignId: fallback.fixedDesignId,
        fixedDesignName: fallback.fixedDesignName,
        fixedDesignVersion: fallback.fixedDesignVersion,
        svgSizeMm: svgSizeInput instanceof HTMLInputElement ? Number(svgSizeInput.value) : fallback.svgSizeMm,
        offsetXMm: offsetXInput instanceof HTMLInputElement ? Number(offsetXInput.value) : fallback.offsetXMm,
        offsetYMm: offsetYInput instanceof HTMLInputElement ? Number(offsetYInput.value) : fallback.offsetYMm,
      };
    })
    .filter((item) => typeof item.fixedDesignId === "string" && item.fixedDesignId.trim());
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
          boundingSizePresetId: presetBoundingSizePresetInput?.value,
          backingMm: presetBackingInput?.value,
          weldExportedDesign: presetWeldExportedDesignInput?.checked,
        }),
      },
      lineDefaults,
      lineRules: lineRules.length
        ? lineRules
        : [{ match: { kind: "all" }, settings: {} }],
      fixedItems: readPresetEditorFixedItems(currentPreset.fixedItems),
    },
  };
}

function buildPresetEditorDirtyKey() {
  if (!presetEditorDraft) {
    return "";
  }

  syncPresetEditorDraftFromInputs();
  syncPresetEditorDraftFromControls();
  return JSON.stringify(presetEditorDraft);
}

function setPresetEditorBaselineToCurrent() {
  presetEditorBaselineKey = presetEditorDraft ? buildPresetEditorDirtyKey() : null;
  updatePresetSaveButtonState();
}

function updatePresetSaveButtonState() {
  if (!savePresetButton && !cancelPresetButton) {
    return;
  }

  if (!presetEditorDraft) {
    if (savePresetButton) {
      savePresetButton.disabled = true;
    }
    if (cancelPresetButton) {
      cancelPresetButton.disabled = true;
    }
    return;
  }

  if (presetEditorBaselineKey === null) {
    if (savePresetButton) {
      savePresetButton.disabled = false;
    }
    if (cancelPresetButton) {
      cancelPresetButton.disabled = false;
    }
    return;
  }

  const isDirty = buildPresetEditorDirtyKey() !== presetEditorBaselineKey;
  if (savePresetButton) {
    savePresetButton.disabled = !isDirty;
  }
  if (cancelPresetButton) {
    cancelPresetButton.disabled = presetEditorDraft.previousId ? !isDirty : false;
  }
}

function selectPresetEditorRow(presetId, options = {}) {
  const { updateRoute = true, replaceRoute = false } = options;
  if (!presetId) {
    presetEditorDraft = createPresetEditorDraft(null, { previousId: null, generateNewId: true });
    renderPresetEditorDraft();
    setPresetEditorBaselineToCurrent();
    setPresetEditorStatus("Start a new preset draft or choose a saved preset.", "pending");
    if (updateRoute) {
      writeAppRoute({ replace: replaceRoute, workspace: "presets", itemId: null });
    }
    presetDraftNameInput?.focus();
    return;
  }

  loadPresetEditorDraftFromRegistry(presetId);
  if (updateRoute) {
    writeAppRoute({ replace: replaceRoute, workspace: "presets", itemId: presetId });
  }
}

function createPresetLibraryRow({ id, label, meta }, selectedPresetId) {
  const row = document.createElement("article");
  row.className = "size-preset-row preset-library-row";
  row.dataset.presetId = id;
  row.role = "button";
  row.tabIndex = 0;
  row.classList.toggle("is-selected", id === selectedPresetId);
  row.addEventListener("click", () => {
    selectPresetEditorRow(id);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectPresetEditorRow(id);
  });

  const name = document.createElement("p");
  name.className = "size-preset-name";
  name.textContent = label;

  const detail = document.createElement("p");
  detail.className = "size-preset-meta";
  detail.textContent = meta;

  row.append(name, detail);
  return row;
}

function getPresetSearchText(definition, option, meta) {
  const listingText = Array.isArray(definition?.listingAssignments)
    ? definition.listingAssignments
      .map((assignment) => [assignment.listingId, assignment.name].filter(Boolean).join(" "))
      .join(" ")
    : "";
  const fixedDesignText = Array.isArray(definition?.fixedDesigns)
    ? definition.fixedDesigns
      .map((design) => [
        design.id,
        design.name,
        design.title,
        design.listingId,
        design.designText,
        design.text,
        design.note,
        ...(Array.isArray(design.textLines) ? design.textLines : []),
      ].filter(Boolean).join(" "))
      .join(" ")
    : "";

  return [option?.label, meta, listingText, fixedDesignText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderPresetLibraryRows(selectedPresetId = "") {
  if (!presetLibraryList) {
    return;
  }

  const shouldShowDraftRow = selectedPresetId === "";
  const searchTerm = presetLibrarySearchTerm.trim().toLowerCase();
  const draftMatchesSearch = !searchTerm || "new preset draft start from default reusable settings".includes(searchTerm);
  const savedRows = getPresetOptions()
    .map((preset) => {
      const definition = getPresetDefinitionForEditor(preset.id);
      const assignmentCount = Array.isArray(definition?.listingAssignments)
        ? definition.listingAssignments.length
        : 0;
      const fixedDesignCount = Array.isArray(definition?.fixedDesigns)
        ? definition.fixedDesigns.length
        : 0;
      const meta = [
        assignmentCount
          ? `${assignmentCount} assigned listing${assignmentCount === 1 ? "" : "s"}`
          : "No assigned listings",
        fixedDesignCount
          ? `${fixedDesignCount} fixed design${fixedDesignCount === 1 ? "" : "s"}`
          : "",
      ].filter(Boolean).join(" · ");

      return {
        definition,
        meta,
        option: preset,
        row: createPresetLibraryRow({
          id: preset.id,
          label: preset.label,
          meta,
        }, selectedPresetId),
      };
    })
    .filter(({ definition, option, meta }) => !searchTerm || getPresetSearchText(definition, option, meta).includes(searchTerm))
    .map(({ row }) => row);
  const rows = [
    ...(shouldShowDraftRow && draftMatchesSearch
      ? [createPresetLibraryRow({
          id: "",
          label: "New preset draft",
          meta: "Start from default reusable settings",
        }, selectedPresetId)]
      : []),
    ...savedRows,
  ];

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "preset-library-empty";
    empty.textContent = "No presets match the current search.";
    presetLibraryList.replaceChildren(empty);
    return;
  }

  presetLibraryList.replaceChildren(...rows);
}

function getFixedDesignText(design) {
  if (Array.isArray(design?.textLines)) {
    return design.textLines.map((line) => String(line).trim()).filter(Boolean).join(" / ");
  }

  if (Array.isArray(design?.lines)) {
    return design.lines.map((line) => String(line?.text ?? line).trim()).filter(Boolean).join(" / ");
  }

  if (typeof design?.designText === "string") {
    return design.designText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" / ");
  }

  if (typeof design?.text === "string") {
    return design.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" / ");
  }

  return "";
}

function createPresetFixedDesignCard(design) {
  const card = document.createElement("article");
  card.className = "preset-fixed-design-card";

  const title = document.createElement("h4");
  title.className = "preset-fixed-design-title";
  title.textContent = design.name || design.title || "Fixed Design";
  card.append(title);

  const text = getFixedDesignText(design);
  if (text) {
    const textNode = document.createElement("p");
    textNode.className = "preset-fixed-design-text";
    textNode.textContent = text;
    card.append(textNode);
  }

  const metaItems = [
    design.listingId ? `Listing ID ${design.listingId}` : "",
    design.id ? `Design ID ${design.id}` : "",
  ].filter(Boolean);
  if (metaItems.length) {
    const meta = document.createElement("p");
    meta.className = "preset-fixed-design-meta";
    meta.textContent = metaItems.join(" · ");
    card.append(meta);
  }

  if (design.note) {
    const note = document.createElement("p");
    note.className = "preset-fixed-design-note";
    note.textContent = design.note;
    card.append(note);
  }

  return card;
}

function renderPresetFixedDesigns() {
  if (!presetFixedDesignsList || !presetFixedDesignsEmptyState) {
    return;
  }

  presetFixedDesignsList.replaceChildren();
  const fixedDesigns = Array.isArray(presetEditorDraft?.preset?.fixedDesigns)
    ? presetEditorDraft.preset.fixedDesigns
    : [];

  if (!fixedDesigns.length) {
    presetFixedDesignsEmptyState.hidden = false;
    return;
  }

  presetFixedDesignsEmptyState.hidden = true;
  presetFixedDesignsList.append(...fixedDesigns.map(createPresetFixedDesignCard));
}

function renderPresetEditorEmptyState() {
  renderPresetLibraryRows(null);
  presetDraftNameInput.value = "";
  presetDraftNameInput.placeholder = DEFAULT_PRESET_NAME_PLACEHOLDER;
  if (presetWeldExportedDesignInput) {
    presetWeldExportedDesignInput.checked = DEFAULT_WELD_EXPORTED_DESIGN;
  }
  if (presetBoundingSizePresetInput) {
    presetBoundingSizePresetInput.value = DEFAULT_BOUNDING_SIZE_PRESET_ID;
  }
  if (presetGlobalHorizontalScaleInput) {
    presetGlobalHorizontalScaleInput.value = "1";
  }
  if (presetGlobalVerticalScaleInput) {
    presetGlobalVerticalScaleInput.value = "1";
  }
  if (presetBackingInput) {
    presetBackingInput.value = String(DEFAULT_BACKING_MM);
  }
  updatePresetGlobalHorizontalScaleOutput();
  updatePresetGlobalVerticalScaleOutput();
  updatePresetBackingOutput();
  renderPresetEditorLineControls();
  renderPresetEditorFixedItems();
  if (savePresetButton) {
    savePresetButton.disabled = true;
  }
  if (cancelPresetButton) {
    cancelPresetButton.disabled = true;
  }
  if (deletePresetButton) {
    deletePresetButton.disabled = true;
  }
  renderPresetAssignmentList();
  renderPresetFixedDesigns();
}

function renderPresetEditorDraft() {
  if (!presetEditorDraft) {
    renderPresetEditorEmptyState();
    return;
  }

  const selectedPresetId = presetEditorDraft.previousId && isValidPresetId(presetEditorDraft.previousId)
    ? presetEditorDraft.previousId
    : "";

  renderPresetLibraryRows(selectedPresetId);

  const draftName = typeof presetEditorDraft.preset?.name === "string"
    ? presetEditorDraft.preset.name
    : "";
  const globalDefaults = normalizePresetGlobalDefaults(presetEditorDraft.preset?.globalDefaults || {});
  const lineGroups = getPresetEditorLineGroups(presetEditorDraft.preset || {});
  presetDraftNameInput.value = draftName;
  presetDraftNameInput.placeholder = selectedPresetId ? DEFAULT_PRESET_NAME_PLACEHOLDER : "Enter preset name";
  if (presetWeldExportedDesignInput) {
    presetWeldExportedDesignInput.checked = globalDefaults.weldExportedDesign;
  }
  if (presetBoundingSizePresetInput) {
    presetBoundingSizePresetInput.value = globalDefaults.boundingSizePresetId;
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
  renderPresetEditorFixedItems();
  updatePresetSaveButtonState();
  if (deletePresetButton) {
    deletePresetButton.disabled = !presetEditorDraft?.previousId
      || !isValidPresetId(presetEditorDraft.previousId)
      || getPresetOptions().length <= 1;
  }
  renderPresetAssignmentList();
  renderPresetFixedDesigns();
}

function selectFirstPresetEditorRowIfNeeded() {
  if (presetEditorDraft) {
    renderPresetEditorDraft();
    return;
  }

  const firstPresetId = getPresetOptions()[0]?.id || "";
  if (firstPresetId) {
    loadPresetEditorDraftFromRegistry(firstPresetId);
    return;
  }

  renderPresetEditorEmptyState();
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
    if (migrateOrderPresetReference(order, previousId, nextId) && order.id === activeOrderItemId) {
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
  setPresetEditorBaselineToCurrent();
  setPresetEditorStatus(`Editing ${preset.name}.`, "pending");
}

function cancelPresetEditorChanges() {
  if (presetEditorDraft?.previousId && isValidPresetId(presetEditorDraft.previousId)) {
    const presetId = presetEditorDraft.previousId;
    const savedPresetName = getPresetDefinitionForEditor(presetId)?.name?.trim() || "preset";
    loadPresetEditorDraftFromRegistry(presetId);
    setPresetEditorStatus(`Canceled changes to ${savedPresetName}.`, "pending");
    return;
  }

  const firstPresetId = getPresetOptions()[0]?.id || "";
  if (firstPresetId) {
    loadPresetEditorDraftFromRegistry(firstPresetId);
  } else {
    presetEditorDraft = null;
    renderPresetEditorEmptyState();
    presetEditorBaselineKey = null;
  }
  setPresetEditorStatus("Canceled preset draft.", "pending");
}

function setSavePresetAsStatus(message = "") {
  if (!savePresetAsStatus) {
    return;
  }

  savePresetAsStatus.textContent = message;
  savePresetAsStatus.hidden = !message;
}

function finishSavePresetAsDialog(result) {
  if (!activeSavePresetAsRequest) {
    return;
  }

  const { resolve, restoreFocusTarget } = activeSavePresetAsRequest;
  activeSavePresetAsRequest = null;
  if (savePresetAsDialog instanceof HTMLDialogElement && savePresetAsDialog.open) {
    savePresetAsDialog.close();
  }
  setSavePresetAsStatus("");
  if (restoreFocusTarget instanceof HTMLElement) {
    restoreFocusTarget.focus();
  }
  resolve(result);
}

function showSavePresetAsDialog(defaultName = "") {
  const fallbackPrompt = globalThis.prompt;
  if (!(savePresetAsDialog instanceof HTMLDialogElement) || !savePresetAsNameInput) {
    const promptedName = typeof fallbackPrompt === "function"
      ? fallbackPrompt("Preset name", defaultName)
      : null;
    const normalizedName = typeof promptedName === "string" ? promptedName.trim() : "";
    return Promise.resolve(normalizedName || null);
  }

  if (activeSavePresetAsRequest) {
    finishSavePresetAsDialog(null);
  }

  savePresetAsNameInput.value = defaultName;
  setSavePresetAsStatus("");

  return new Promise((resolve) => {
    activeSavePresetAsRequest = {
      resolve,
      restoreFocusTarget: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    savePresetAsDialog.showModal();
    savePresetAsNameInput.focus();
    savePresetAsNameInput.select();
  });
}

async function saveActiveOrderAsNewPreset() {
  const activeOrder = getActiveOrder();
  if (!activeOrder) {
    updateWorkflowAlert("Add or select a design before saving a preset.", "error");
    return;
  }

  const presetName = await showSavePresetAsDialog();
  if (!presetName) {
    return;
  }

  if (saveAsNewPresetButton) {
    saveAsNewPresetButton.disabled = true;
  }
  updateWorkflowAlert(`Saving ${presetName}...`, "pending", { autoHideMs: 0 });

  const newPreset = {
    ...inferPresetDefinitionFromSettings({
      name: presetName,
      settings: getCurrentSettings(),
    }),
    id: generatePresetId(),
    name: presetName,
  };

  try {
    const localPayload = savePresetDefinitionLocally({
      preset: newPreset,
      previousId: null,
    });
    const savedPreset = localPayload?.preset || newPreset;
    renderPresetOptions();
    presetInput.value = savedPreset.id;
    updateActiveOrderFromControls();
    renderOrderList();
    persistBatchState();
    render();

    try {
      await savePresetSnapshot(getPresetSnapshot());
      updateWorkflowAlert(`Saved ${savedPreset.name} and selected it for this design.`, "success");
    } catch (error) {
      updateWorkflowAlert(
        error instanceof Error
          ? `Saved ${savedPreset.name} locally, but Supabase save failed: ${error.message}`
          : `Saved ${savedPreset.name} locally, but Supabase save failed.`,
        "error",
      );
    }
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to save preset.", "error");
  } finally {
    if (saveAsNewPresetButton) {
      saveAsNewPresetButton.disabled = !getActiveOrder();
    }
  }
}

function buildOverwrittenPresetDefinition({ preset, settings }) {
  const inferredPreset = inferPresetDefinitionFromSettings({
    name: preset?.name || "",
    settings,
  });

  return {
    ...preset,
    id: preset?.id || inferredPreset.id,
    name: preset?.name || inferredPreset.name,
    description: preset?.description || "",
    globalDefaults: inferredPreset.globalDefaults,
    lineDefaults: inferredPreset.lineDefaults,
    lineRules: inferredPreset.lineRules,
    fixedItems: inferredPreset.fixedItems,
    listingAssignments: Array.isArray(preset?.listingAssignments)
      ? structuredClone(preset.listingAssignments)
      : [],
    fixedDesigns: Array.isArray(preset?.fixedDesigns)
      ? structuredClone(preset.fixedDesigns)
      : [],
  };
}

async function overwriteSelectedPresetFromActiveOrder() {
  const activeOrder = getActiveOrder();
  if (!activeOrder) {
    updateWorkflowAlert("Add or select a design before overwriting a preset.", "error");
    return;
  }

  const selectedPresetId = presetInput.value;
  const existingPreset = getPresetDefinitionForEditor(selectedPresetId);
  if (!existingPreset) {
    updateWorkflowAlert("Choose a saved preset before overwriting it.", "error");
    return;
  }

  if (overwritePresetButton) {
    overwritePresetButton.disabled = true;
  }
  updateWorkflowAlert(`Overwriting ${existingPreset.name}...`, "pending", { autoHideMs: 0 });

  const overwrittenPreset = buildOverwrittenPresetDefinition({
    preset: existingPreset,
    settings: getCurrentSettings(),
  });

  try {
    savePresetDefinitionLocally({
      preset: overwrittenPreset,
      previousId: existingPreset.id,
    });
    renderPresetOptions();
    presetInput.value = overwrittenPreset.id;
    if (presetEditorDraft?.previousId === existingPreset.id) {
      presetEditorDraft = createPresetEditorDraft(overwrittenPreset, { previousId: overwrittenPreset.id });
      renderPresetEditorDraft();
      setPresetEditorBaselineToCurrent();
    }
    persistBatchState();
    render();
    try {
      await savePresetSnapshot(getPresetSnapshot());
      updateWorkflowAlert(`Overwrote ${overwrittenPreset.name} with the current settings.`, "success");
    } catch (error) {
      updateWorkflowAlert(
        error instanceof Error
          ? `Could not save ${overwrittenPreset.name} to Supabase: ${error.message}`
          : `Could not save ${overwrittenPreset.name} to Supabase.`,
        "error",
      );
    }
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to overwrite preset.", "error");
  }
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
    setPresetEditorBaselineToCurrent();
    if (activeOrderChanged) {
      const activeOrder = getActiveOrder();
      if (activeOrder) {
        applySettings(activeOrder.settings);
      }
    }
    renderOrderList();
    persistBatchState();
    render();
    try {
      await savePresetSnapshot(getPresetSnapshot());
      setPresetEditorStatus(successMessage || `Saved ${presetEditorDraft.preset.name}.`, "success");
    } catch (error) {
      setPresetEditorStatus(
        error instanceof Error
          ? `Supabase save failed: ${error.message}`
          : "Supabase save failed.",
        "error",
      );
    }
    return true;
  } catch (error) {
    setPresetEditorStatus(error instanceof Error ? error.message : "Unable to save preset.", "error");
    updatePresetSaveButtonState();
    return false;
  }
}

async function savePresetEditorDraft() {
  await persistPresetEditorDraft({ syncInputs: true });
}

async function deletePresetEditorDraft() {
  const presetId = presetEditorDraft?.previousId;
  if (!presetId || !isValidPresetId(presetId)) {
    setPresetEditorStatus("Choose a saved preset to delete.", "error");
    return;
  }

  const presetName = presetEditorDraft?.preset?.name?.trim() || "this preset";
  const confirmed = await showConfirmationDialog({
    title: "Delete Preset?",
    description: `Delete ${presetName} from the preset library? Any designs using it in this workspace will switch to the current default preset.`,
    confirmLabel: "Delete Preset",
    cancelLabel: "Keep Preset",
    isDanger: true,
  });
  if (!confirmed) {
    return;
  }

  savePresetButton.disabled = true;
  if (deletePresetButton) {
    deletePresetButton.disabled = true;
  }
  setPresetEditorStatus(`Deleting ${presetName}...`, "pending");

  try {
    const result = deletePresetDefinitionLocally(presetId);
    const replacementPresetId = result.snapshot.defaultPresetId;
    migratePresetReferences(presetId, replacementPresetId);
    renderPresetOptions();
    const replacementPreset = getPresetDefinitionForEditor(replacementPresetId);
    presetEditorDraft = createPresetEditorDraft(replacementPreset, { previousId: replacementPresetId });
    renderPresetEditorDraft();
    setPresetEditorBaselineToCurrent();
    renderOrderList();
    persistBatchState();
    render();
    try {
      await savePresetSnapshot(result.snapshot);
      setPresetEditorStatus(`Deleted ${presetName}.`, "success");
    } catch (error) {
      setPresetEditorStatus(
        error instanceof Error
          ? `Supabase delete failed: ${error.message}`
          : "Supabase delete failed.",
        "error",
      );
    }
  } catch (error) {
    setPresetEditorStatus(error instanceof Error ? error.message : "Unable to delete preset.", "error");
    updatePresetSaveButtonState();
    if (deletePresetButton) {
      deletePresetButton.disabled = false;
    }
  }
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
    persistBatchState();
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
  const existingAssignedPresetId = hasPresetMappingForListingId(listingId)
    ? getPresetIdForListingId(listingId)
    : null;

  if (existingAssignedPresetId && existingAssignedPresetId !== normalizedPreset.id) {
    const existingAssignedPreset = getPresetDefinitionForEditor(existingAssignedPresetId);
    const existingPresetName = existingAssignedPreset?.name || "another preset";
    const approved = await showConfirmationDialog({
      title: "Move listing link?",
      description: `Listing ${listingId} is already linked to ${existingPresetName}. Move it to ${normalizedPreset.name} instead?`,
      confirmLabel: "Change Link",
      cancelLabel: "Keep Current",
    });

    if (!approved) {
      updateWorkflowAlert(`Kept listing ${listingId} linked to ${existingPresetName}.`, "pending");
      return;
    }
  }

  const assignmentPayload = {
    listingId,
    name: activeOrder.source?.listingTitle?.trim() || `Listing ${listingId}`,
  };
  const assignedPreset = upsertListingAssignment({
    preset: normalizedPreset,
    assignment: assignmentPayload,
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
      setPresetEditorBaselineToCurrent();
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
          ? `Could not save ${assignedPreset.name} assignment to Supabase: ${error.message}`
          : `Could not save ${assignedPreset.name} assignment to Supabase.`,
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

function getProductionBatchAuditSource(order = getActiveOrder()) {
  if (order && (order.updatedBy || order.updatedAt)) {
    return order;
  }

  if (productionBatchContext && (productionBatchContext.updatedBy || productionBatchContext.updatedAt)) {
    return productionBatchContext;
  }

  return null;
}

function resolveProductionBatchBannerOrderId() {
  if (productionBatchConflictState?.orderId) {
    return productionBatchConflictState.orderId;
  }

  return null;
}

function isProductionBatchBannerRelevantToOrder(order = getActiveOrder()) {
  const affectedOrderId = resolveProductionBatchBannerOrderId();
  if (!affectedOrderId) {
    return true;
  }

  return order?.id === affectedOrderId;
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

  return metaParts.join(" · ") || "Manual batch item";
}

function buildBatchOrderNumber(order) {
  const orderNumber = order?.source?.orderNumber;
  return orderNumber ? `#${orderNumber}` : buildManualDesignName(order);
}

function buildBatchRecipient(order) {
  const buyerName = order?.source?.buyerName?.trim();
  if (buyerName) {
    return buyerName;
  }

  return "Manual design";
}

function buildBatchListing(order) {
  const listingTitle = order?.source?.listingTitle?.trim();
  if (listingTitle) {
    return listingTitle;
  }

  const listingId = order?.source?.listingId?.trim();
  return listingId ? `Listing ${listingId}` : buildActiveMeta(order);
}

function getBatchListingImageUrl(order) {
  const candidates = [
    order?.source?.listingImageUrl75x75,
    order?.source?.listingImageUrl,
    order?.listingImageUrl75x75,
    order?.listingImageUrl,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return match ? match.trim() : "";
}

function createBatchProductImage(order) {
  const imageUrl = getBatchListingImageUrl(order);
  const label = buildBatchListing(order);
  const productImage = imageUrl
    ? document.createElement("img")
    : document.createElement("span");

  productImage.className = imageUrl
    ? "order-item-product-image"
    : "order-item-product-image order-item-product-image-placeholder";

  if (imageUrl) {
    productImage.src = imageUrl;
    productImage.alt = label;
    productImage.loading = "lazy";
  } else {
    productImage.setAttribute("aria-hidden", "true");
  }

  return productImage;
}

function buildBatchPersonalization(order) {
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
    countCell.className = "batch-summary-count";

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
  } else if (!settingsSignatureMatches(settings, savedSettingsSignature)) {
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

  const normalizedOrder = {
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
    saveErrorMessage: null,
    analysisState: "idle",
    pendingAnalysisSignature: null,
    pendingAnalysisRequestId: null,
  };

  normalizedOrder.publishedSnapshot = normalizeStoredPublishedSnapshot(order.publishedSnapshot);
  if (!normalizedOrder.publishedSnapshot && normalizedOrder.revision != null) {
    normalizedOrder.publishedSnapshot = {
      id: normalizedOrder.id,
      revision: normalizedOrder.revision,
      updatedAt: normalizedOrder.updatedAt,
      updatedBy: normalizedOrder.updatedBy ? structuredClone(normalizedOrder.updatedBy) : null,
      text: normalizedOrder.text,
      status: normalizedOrder.status,
      settings: normalizeSettings(normalizedOrder.settings),
      source: normalizedOrder.source ? { ...normalizedOrder.source } : null,
      cachedBuild: normalizedOrder.cachedBuild ? structuredClone(normalizedOrder.cachedBuild) : null,
      previousCompletedBuild: normalizedOrder.previousCompletedBuild ? structuredClone(normalizedOrder.previousCompletedBuild) : null,
      savedSettingsSignature: normalizedOrder.savedSettingsSignature,
      completedSettingsSignature: normalizedOrder.completedSettingsSignature,
      analysisBadge: normalizedOrder.analysisBadge ? structuredClone(normalizedOrder.analysisBadge) : null,
      pendingAnalysisSignature: normalizedOrder.pendingAnalysisSignature,
    };
  }

  return normalizedOrder;
}

function normalizeProductionBatchContext(batch) {
  if (!batch || typeof batch !== "object") {
    return null;
  }

  const id = typeof batch.id === "string" ? batch.id.trim() : "";
  const workspaceId = typeof batch.workspaceId === "string" ? batch.workspaceId.trim() : "";

  if (!id || !workspaceId) {
    return null;
  }

  return {
    ...structuredClone(batch),
    id,
    workspaceId,
  };
}

function setProductionBatchContext(batch) {
  productionBatchContext = normalizeProductionBatchContext(batch);
}

function buildSerializedBatchOrder(order, options = {}) {
  const { includePublishedSnapshot = false } = options;
  const serializedOrder = {
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
  };

  if (includePublishedSnapshot) {
    serializedOrder.publishedSnapshot = order.publishedSnapshot
      ? structuredClone(order.publishedSnapshot)
      : null;
  }

  return serializedOrder;
}

function buildSerializedBatchOrders(options = {}) {
  return orders.map((order) => buildSerializedBatchOrder(order, options));
}

function buildPersistedBatchState() {
  return {
    orderSequence,
    batch: productionBatchContext ? structuredClone(productionBatchContext) : null,
    activeOrderItemId,
    orderItems: buildSerializedBatchOrders({ includePublishedSnapshot: true }),
  };
}

function isOrderAwaitingPublishedSave(order) {
  if (!order) {
    return false;
  }

  return Boolean(
    typeof order.pendingAnalysisSignature === "string"
    && order.pendingAnalysisSignature
    && order.pendingAnalysisSignature !== order.savedSettingsSignature,
  );
}

function buildSerializedDraftOrderForPendingAnalysis(order) {
  const draftOrder = buildSerializedBatchOrder(order);
  draftOrder.status = "in-progress";
  draftOrder.cachedBuild = null;
  draftOrder.previousCompletedBuild = null;
  draftOrder.savedSettingsSignature = null;
  draftOrder.completedSettingsSignature = null;
  draftOrder.analysisBadge = null;
  draftOrder.pendingAnalysisSignature = null;
  return draftOrder;
}

function shouldUsePublishedProductionBatchOrder(order) {
  if (!order?.publishedSnapshot) {
    return false;
  }

  return hasUnsavedPublishedSnapshotChanges(order) || isOrderAwaitingPublishedSave(order);
}

function buildProductionBatchSnapshot(options = {}) {
  const publishOrderIds = Array.isArray(options.publishOrderIds)
    ? new Set(options.publishOrderIds.filter((value) => typeof value === "string" && value))
    : null;

  return createProductionBatchSnapshot({
    batch: productionBatchContext ? structuredClone(productionBatchContext) : null,
    activeOrderItemId,
    orderItems: orders.map((order) => {
      if (publishOrderIds?.has(order.id)) {
        return buildSerializedBatchOrder(order);
      }

      if (shouldUsePublishedProductionBatchOrder(order)) {
        return structuredClone(order.publishedSnapshot);
      }

      if (isOrderAwaitingPublishedSave(order)) {
        return buildSerializedDraftOrderForPendingAnalysis(order);
      }

      return buildSerializedBatchOrder(order);
    }),
  });
}

function applyProductionBatchAuditToOrder(order, auditSource) {
  if (!order || !auditSource || typeof auditSource !== "object") {
    return;
  }

  order.revision = normalizeStoredRevision(auditSource.revision);
  order.updatedAt = normalizeStoredUpdatedAt(auditSource.updatedAt);
  order.updatedBy = normalizeStoredAuditActor(auditSource.updatedBy);
}

function mergeProductionBatchPublishedStateFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.orderItems)) {
    return;
  }

  for (const remoteOrder of snapshot.orderItems) {
    const localOrder = orders.find((order) => order.id === remoteOrder?.id);
    if (!localOrder) {
      continue;
    }

    localOrder.publishedSnapshot = normalizeStoredPublishedSnapshot(remoteOrder);
  }
}

function mergeProductionBatchAuditFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.orderItems)) {
    return;
  }

  for (const remoteOrder of snapshot.orderItems) {
    const localOrder = orders.find((order) => order.id === remoteOrder?.id);
    if (!localOrder) {
      continue;
    }

    applyProductionBatchAuditToOrder(localOrder, remoteOrder);
  }
}

function setProductionBatchSyncState(mode, detail = "") {
  productionBatchSyncState = mode;
  productionBatchSyncDetail = typeof detail === "string" ? detail.trim() : "";

  if (mode !== "enabled") {
    clearProductionBatchAutosaveTimeout();
    productionBatchAutosavePending = false;
  }
}

function enableProductionBatchSync(batch = productionBatchContext) {
  if (batch) {
    setProductionBatchContext(batch);
  }

  if (hasProductionBatchSyncContext()) {
    setProductionBatchSyncState("enabled");
    return true;
  }

  setProductionBatchSyncState("disabled");
  return false;
}

function disableProductionBatchSync(detail = "Production batch sync is unavailable.") {
  setProductionBatchSyncState("disabled", detail);
}

function isProductionBatchSyncEnabled() {
  return productionBatchSyncState === "enabled" && hasProductionBatchSyncContext();
}

function canAttemptProductionBatchSave() {
  return hasProductionBatchSyncContext() && productionBatchSyncState === "enabled";
}

function hasProductionBatchSyncContext() {
  return Boolean(productionBatchContext?.id && productionBatchContext?.workspaceId);
}

function buildProductionBatchSaveKey(snapshot) {
  if (!snapshot) {
    return null;
  }

  try {
    return JSON.stringify(snapshot);
  } catch {
    return null;
  }
}

function hasPendingProductionBatchChanges() {
  if (!isProductionBatchSyncEnabled()) {
    return false;
  }

  const snapshotKey = buildProductionBatchSaveKey(buildProductionBatchSnapshot());
  return Boolean(snapshotKey && snapshotKey !== lastProductionBatchSaveKey);
}

function resolveProductionBatchSaveOrderIds(publishOrderIds) {
  if (Array.isArray(publishOrderIds)) {
    return publishOrderIds.filter((value) => typeof value === "string" && value);
  }

  return orders
    .filter((order) => {
      if (!order.publishedSnapshot) {
        return true;
      }

      if (hasUnsavedPublishedSnapshotChanges(order) || isOrderAwaitingPublishedSave(order)) {
        return false;
      }

      return order.status !== order.publishedSnapshot.status;
    })
    .map((order) => order.id);
}

function markSaveErrorForOrderIds(orderIds, message) {
  const orderIdSet = new Set((Array.isArray(orderIds) ? orderIds : []).filter((value) => typeof value === "string" && value));
  if (!orderIdSet.size) {
    return;
  }

  const saveErrorMessage = typeof message === "string" && message.trim()
    ? message.trim()
    : "Unable to save this design.";
  orders.forEach((order) => {
    if (orderIdSet.has(order.id)) {
      order.saveErrorMessage = saveErrorMessage;
    }
  });
  if (activeOrderItemId && orderIdSet.has(activeOrderItemId)) {
    updateConnectionStatus(
      "warning",
      "Save failed",
      saveErrorMessage,
      {
        state: "error",
        shortLabel: "!",
        fullLabel: `Save failed: ${saveErrorMessage}`,
      },
    );
  }
  scheduleRenderOrderList();
}

function clearSaveErrorsForOrderIds(orderIds) {
  const orderIdSet = new Set((Array.isArray(orderIds) ? orderIds : []).filter((value) => typeof value === "string" && value));
  if (!orderIdSet.size) {
    return;
  }

  orders.forEach((order) => {
    if (orderIdSet.has(order.id)) {
      order.saveErrorMessage = null;
    }
  });
}

function renderSizePresetList() {
  if (!sizePresetList) {
    return;
  }

  const draftDefinition = sizePresetEditorDraftActive
    ? [{
      id: "",
      label: buildSizePresetEditorLabel() || "New guide draft",
      maxWidthIn: readPositiveNumberInput(sizePresetMaxWidthInput),
      maxHeightIn: readPositiveNumberInput(sizePresetMaxHeightInput),
      minWidthIn: readPositiveNumberInput(sizePresetMinWidthInput),
      minHeightIn: readPositiveNumberInput(sizePresetMinHeightInput),
      circleDiameterIn: readPositiveNumberInput(sizePresetCircleDiameterInput),
      isDraft: true,
    }]
    : [];
  const savedDefinitions = getBoundingSizePresetDefinitionsForEditor().map((definition) => {
    const preset = resolveBoundingSizePreset(definition.id);
    return {
      id: definition.id,
      label: preset.label,
      maxWidthIn: preset.maxWidthIn,
      maxHeightIn: preset.maxHeightIn,
      minWidthIn: preset.minWidthIn,
      minHeightIn: preset.minHeightIn,
      circleDiameterIn: preset.circleDiameterIn,
      isDraft: false,
    };
  });

  sizePresetList.replaceChildren(...[...draftDefinition, ...savedDefinitions].map((preset) => {
    const row = document.createElement("article");
    row.className = "size-preset-row";
    row.role = "button";
    row.tabIndex = 0;
    row.classList.toggle("is-selected", preset.isDraft || preset.id === selectedSizePresetId);
    row.addEventListener("click", () => {
      if (!preset.isDraft) {
        selectSizePresetForEditing(preset.id);
      }
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      if (!preset.isDraft) {
        selectSizePresetForEditing(preset.id);
      }
    });

    const content = document.createElement("div");
    const name = document.createElement("p");
    name.className = "size-preset-name";
    name.textContent = preset.label;

    const max = document.createElement("p");
    max.className = "size-preset-meta";
    max.textContent = preset.maxWidthIn !== null && preset.maxHeightIn !== null
      ? `Max ${preset.maxWidthIn} x ${preset.maxHeightIn} in`
      : "Enter max dimensions";

    const min = document.createElement("p");
    min.className = "size-preset-meta";
    min.textContent = preset.minWidthIn !== null && preset.minHeightIn !== null
      ? `Min ${preset.minWidthIn} x ${preset.minHeightIn} in`
      : "Min optional";

    const circle = document.createElement("p");
    circle.className = "size-preset-meta";
    circle.textContent = preset.circleDiameterIn === null
      ? "No circle"
      : `Circle ${preset.circleDiameterIn} in`;

    content.append(name, max, min, circle);
    row.append(content);
    return row;
  }));
}

function setSizePresetEditorStatus(message, state = "pending") {
  if (!sizePresetEditorStatus) {
    return;
  }

  sizePresetEditorStatus.textContent = message;
  sizePresetEditorStatus.dataset.state = state;
}

function readPositiveNumberInput(input) {
  const value = input?.value;
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatSizePresetDimension(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function buildSizePresetEditorLabel() {
  const maxWidthIn = readPositiveNumberInput(sizePresetMaxWidthInput);
  const maxHeightIn = readPositiveNumberInput(sizePresetMaxHeightInput);

  if (maxWidthIn === null && maxHeightIn === null) {
    return "";
  }

  const widthLabel = maxWidthIn === null ? "W" : formatSizePresetDimension(maxWidthIn);
  const heightLabel = maxHeightIn === null ? "H" : formatSizePresetDimension(maxHeightIn);

  return `${widthLabel} x ${heightLabel}`;
}

function syncSizePresetEditorNameFromMaxDimensions() {
  if (!sizePresetNameInput) {
    return;
  }

  sizePresetNameInput.value = buildSizePresetEditorLabel();
}

function readSizePresetEditorMinDimension(input, fallback) {
  return readPositiveNumberInput(input) ?? fallback;
}

function renderSizePresetEditorPreview() {
  if (!sizePresetPreview || !sizePresetPreviewEmptyState) {
    return;
  }

  syncSizePresetEditorNameFromMaxDimensions();

  const maxWidthIn = readPositiveNumberInput(sizePresetMaxWidthInput);
  const maxHeightIn = readPositiveNumberInput(sizePresetMaxHeightInput);
  const minWidthIn = readSizePresetEditorMinDimension(sizePresetMinWidthInput, maxWidthIn);
  const minHeightIn = readSizePresetEditorMinDimension(sizePresetMinHeightInput, maxHeightIn);
  const circleDiameterIn = readPositiveNumberInput(sizePresetCircleDiameterInput);
  const canRender = maxWidthIn !== null
    && maxHeightIn !== null
    && minWidthIn !== null
    && minHeightIn !== null
    && minWidthIn <= maxWidthIn
    && minHeightIn <= maxHeightIn;

  sizePresetPreview.replaceChildren();
  sizePresetPreviewEmptyState.hidden = canRender;

  if (!canRender) {
    sizePresetPreview.removeAttribute("viewBox");
    return;
  }

  const maxWidthMm = maxWidthIn * 25.4;
  const maxHeightMm = maxHeightIn * 25.4;
  const minWidthMm = minWidthIn * 25.4;
  const minHeightMm = minHeightIn * 25.4;
  const marginMm = 8;
  const labelRightMm = 10;
  const previewBoxX = marginMm;
  const previewBoxY = marginMm;
  const guideCenterX = previewBoxX + maxWidthMm / 2;
  const guideCenterY = previewBoxY + maxHeightMm / 2;
  const minBoxX = guideCenterX - minWidthMm / 2;
  const minBoxY = guideCenterY - minHeightMm / 2;
  const topLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: guideCenterX,
    y: previewBoxY - 2.4,
    "text-anchor": "middle",
  });
  const sideLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: previewBoxX + maxWidthMm + 4.5,
    y: guideCenterY,
    "text-anchor": "middle",
    transform: `rotate(90 ${previewBoxX + maxWidthMm + 4.5} ${guideCenterY})`,
  });

  topLabel.textContent = `${maxWidthIn}"`;
  sideLabel.textContent = `${maxHeightIn}"`;
  sizePresetPreview.setAttribute("viewBox", `0 0 ${maxWidthMm + marginMm * 2 + labelRightMm} ${maxHeightMm + marginMm * 2}`);

  const elements = [
    makeSvgElement("rect", {
      class: "preview-guide-box",
      x: previewBoxX,
      y: previewBoxY,
      width: maxWidthMm,
      height: maxHeightMm,
    }),
    makeSvgElement("rect", {
      class: "preview-guide-min-box",
      x: minBoxX,
      y: minBoxY,
      width: minWidthMm,
      height: minHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: minBoxX,
      y1: previewBoxY,
      x2: minBoxX,
      y2: previewBoxY + maxHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: minBoxX + minWidthMm,
      y1: previewBoxY,
      x2: minBoxX + minWidthMm,
      y2: previewBoxY + maxHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: minBoxY,
      x2: previewBoxX + maxWidthMm,
      y2: minBoxY,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: minBoxY + minHeightMm,
      x2: previewBoxX + maxWidthMm,
      y2: minBoxY + minHeightMm,
    }),
  ];

  if (circleDiameterIn !== null) {
    elements.push(makeSvgElement("circle", {
      class: "preview-guide-box",
      cx: guideCenterX,
      cy: guideCenterY,
      r: (circleDiameterIn * 25.4) / 2,
    }));
  }

  sizePresetPreview.append(...elements, topLabel, sideLabel);
}

function clearSizePresetEditor() {
  selectedSizePresetId = null;
  sizePresetEditorDraftActive = false;
  if (sizePresetNameInput) {
    sizePresetNameInput.value = "";
  }
  if (sizePresetMaxWidthInput) {
    sizePresetMaxWidthInput.value = "";
  }
  if (sizePresetMaxHeightInput) {
    sizePresetMaxHeightInput.value = "";
  }
  if (sizePresetMinWidthInput) {
    sizePresetMinWidthInput.value = "";
  }
  if (sizePresetMinHeightInput) {
    sizePresetMinHeightInput.value = "";
  }
  if (sizePresetCircleDiameterInput) {
    sizePresetCircleDiameterInput.value = "";
  }
  if (deleteSizePresetButton) {
    deleteSizePresetButton.disabled = true;
  }
  setSizePresetEditorStatus("Create a size guide or select one below.", "pending");
  renderSizePresetEditorPreview();
  renderSizePresetList();
  setSizePresetEditorBaselineToCurrent();
}

function startNewSizePresetDraft() {
  clearSizePresetEditor();
  sizePresetEditorDraftActive = true;
  setSizePresetEditorStatus("Started a new size guide draft.", "pending");
  renderSizePresetList();
  setSizePresetEditorBaselineToCurrent();
}

function selectSizePresetForEditing(presetId, options = {}) {
  const { updateRoute = true, replaceRoute = false } = options;
  const definition = getBoundingSizePresetDefinitionsForEditor()
    .find((preset) => preset.id === presetId);

  if (!definition) {
    clearSizePresetEditor();
    return;
  }

  selectedSizePresetId = definition.id;
  sizePresetEditorDraftActive = false;
  if (sizePresetNameInput) {
    sizePresetNameInput.value = "";
  }
  if (sizePresetMaxWidthInput) {
    sizePresetMaxWidthInput.value = String(definition.max.widthIn);
  }
  if (sizePresetMaxHeightInput) {
    sizePresetMaxHeightInput.value = String(definition.max.heightIn);
  }
  if (sizePresetMinWidthInput) {
    sizePresetMinWidthInput.value = String(definition.min.widthIn);
  }
  if (sizePresetMinHeightInput) {
    sizePresetMinHeightInput.value = String(definition.min.heightIn);
  }
  if (sizePresetCircleDiameterInput) {
    sizePresetCircleDiameterInput.value = Number.isFinite(definition.circleDiameterIn)
      ? String(definition.circleDiameterIn)
      : "";
  }
  if (deleteSizePresetButton) {
    deleteSizePresetButton.disabled = isBuiltInBoundingSizePresetId(definition.id);
  }
  setSizePresetEditorStatus(`Editing ${definition.label}.`, "pending");
  renderSizePresetEditorPreview();
  renderSizePresetList();
  setSizePresetEditorBaselineToCurrent();
  if (updateRoute) {
    writeAppRoute({
      replace: replaceRoute,
      workspace: "sizeGuides",
      itemId: selectedSizePresetId,
    });
  }
}

function selectFirstSizePresetIfNeeded(options = {}) {
  if (selectedSizePresetId && getBoundingSizePresetDefinitionsForEditor().some((preset) => preset.id === selectedSizePresetId)) {
    selectSizePresetForEditing(selectedSizePresetId, options);
    return;
  }

  const firstSizePresetId = getBoundingSizePresetDefinitionsForEditor()[0]?.id || "";
  if (firstSizePresetId) {
    selectSizePresetForEditing(firstSizePresetId, options);
    return;
  }

  renderSizePresetList();
}

function cancelSizePresetEditorChanges() {
  if (sizePresetEditorDraftActive) {
    const firstSizePresetId = getBoundingSizePresetDefinitionsForEditor()[0]?.id || "";
    sizePresetEditorDraftActive = false;

    if (firstSizePresetId) {
      selectSizePresetForEditing(firstSizePresetId);
    } else {
      clearSizePresetEditor();
    }

    setSizePresetEditorStatus("Canceled size guide draft.", "pending");
    return;
  }

  const currentDefinition = getBoundingSizePresetDefinitionsForEditor()
    .find((definition) => definition.id === selectedSizePresetId);

  if (currentDefinition) {
    selectSizePresetForEditing(currentDefinition.id);
    setSizePresetEditorStatus(`Canceled changes to ${currentDefinition.label}.`, "pending");
    return;
  }

  clearSizePresetEditor();
}

function generateSizePresetId() {
  const rawId = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    || `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `size-${rawId.slice(0, 12)}`;
}

function readSizePresetEditorDefinition() {
  const editingBuiltIn = selectedSizePresetId && isBuiltInBoundingSizePresetId(selectedSizePresetId);
  const label = buildSizePresetEditorLabel();

  return {
    id: editingBuiltIn ? generateSizePresetId() : (selectedSizePresetId || generateSizePresetId()),
    label,
    max: {
      widthIn: sizePresetMaxWidthInput?.value,
      heightIn: sizePresetMaxHeightInput?.value,
    },
    min: {
      widthIn: sizePresetMinWidthInput?.value,
      heightIn: sizePresetMinHeightInput?.value,
    },
    circleDiameterIn: sizePresetCircleDiameterInput?.value,
  };
}

function buildSizePresetEditorDirtyKey() {
  syncSizePresetEditorNameFromMaxDimensions();

  try {
    const definition = normalizeBoundingSizePresetDefinition({
      id: "size-dirty-check",
      label: buildSizePresetEditorLabel(),
      max: {
        widthIn: sizePresetMaxWidthInput?.value,
        heightIn: sizePresetMaxHeightInput?.value,
      },
      min: {
        widthIn: sizePresetMinWidthInput?.value,
        heightIn: sizePresetMinHeightInput?.value,
      },
      circleDiameterIn: sizePresetCircleDiameterInput?.value,
    });

    return JSON.stringify({
      label: definition.label,
      max: definition.max,
      min: definition.min,
      circleDiameterIn: definition.circleDiameterIn ?? null,
    });
  } catch {
    return JSON.stringify({
      label: buildSizePresetEditorLabel(),
      maxWidthIn: sizePresetMaxWidthInput?.value || "",
      maxHeightIn: sizePresetMaxHeightInput?.value || "",
      minWidthIn: sizePresetMinWidthInput?.value || "",
      minHeightIn: sizePresetMinHeightInput?.value || "",
      circleDiameterIn: sizePresetCircleDiameterInput?.value || "",
    });
  }
}

function setSizePresetEditorBaselineToCurrent() {
  sizePresetEditorBaselineKey = buildSizePresetEditorDirtyKey();
  updateSizePresetSaveButtonState();
}

function updateSizePresetSaveButtonState() {
  if (!saveSizePresetButton && !cancelSizePresetButton) {
    return;
  }

  const isDirty = buildSizePresetEditorDirtyKey() !== sizePresetEditorBaselineKey;
  if (saveSizePresetButton) {
    saveSizePresetButton.disabled = !isDirty;
  }
  if (cancelSizePresetButton) {
    cancelSizePresetButton.disabled = !sizePresetEditorDraftActive && !isDirty;
  }
}

function refreshBoundingSizePresetUi(preferredSizePresetId = null) {
  renderBoundingSizePresetOptions(boundingSizePresetInput);
  renderBoundingSizePresetOptions(presetBoundingSizePresetInput);

  if (preferredSizePresetId && isValidBoundingSizePresetId(preferredSizePresetId)) {
    if (boundingSizePresetInput) {
      boundingSizePresetInput.value = preferredSizePresetId;
    }
    if (presetBoundingSizePresetInput) {
      presetBoundingSizePresetInput.value = preferredSizePresetId;
    }
  }

  renderSizePresetList();
  render();
}

function invalidateOrdersUsingSizePreset(sizePresetId) {
  const normalizedSizePresetId = typeof sizePresetId === "string" ? sizePresetId.trim() : "";
  if (!normalizedSizePresetId) {
    return [];
  }

  const affectedOrderIds = [];
  orders.forEach((order) => {
    if (order?.settings?.boundingSizePresetId !== normalizedSizePresetId) {
      return;
    }

    order.settings = normalizeSettings(order.settings);
    order.cachedBuild = null;
    order.previousCompletedBuild = null;
    order.capturedLayout = null;
    order.savedSettingsSignature = null;
    order.completedSettingsSignature = null;
    order.analysisBadge = null;
    order.pendingAnalysisSignature = null;
    order.pendingAnalysisRequestId = null;
    order.saveErrorMessage = null;
    if (order.status === "captured" || order.status === "exported") {
      order.status = "in-progress";
    }
    affectedOrderIds.push(order.id);
  });

  if (affectedOrderIds.includes(activeOrderItemId)) {
    applySettings(getActiveOrder()?.settings || getCurrentSettings());
    render();
  }
  scheduleRenderOrderList();
  return affectedOrderIds;
}

async function saveSizePresetFromEditor() {
  if (saveSizePresetButton) {
    saveSizePresetButton.disabled = true;
  }

  try {
    const definition = readSizePresetEditorDefinition();
    const previousId = selectedSizePresetId && !isBuiltInBoundingSizePresetId(selectedSizePresetId)
      ? selectedSizePresetId
      : null;
    const result = saveBoundingSizePresetDefinitionLocally({ preset: definition, previousId });
    selectedSizePresetId = result.preset.id;
    refreshBoundingSizePresetUi(result.preset.id);
    selectSizePresetForEditing(result.preset.id);

    try {
      await savePresetSnapshot(result.snapshot);
      const affectedOrderIds = invalidateOrdersUsingSizePreset(previousId || result.preset.id);
      if (affectedOrderIds.length) {
        triggerProductionBatchAutosave({ publishOrderIds: affectedOrderIds });
      }
      setSizePresetEditorStatus(`Saved ${result.preset.label}.`, "success");
    } catch (error) {
      setSizePresetEditorStatus(
        error instanceof Error
          ? `Supabase save failed: ${error.message}`
          : "Supabase save failed.",
        "warning",
      );
    }
  } catch (error) {
    setSizePresetEditorStatus(error instanceof Error ? error.message : "Unable to save size guide.", "error");
    updateSizePresetSaveButtonState();
  }
}

async function deleteSelectedSizePreset() {
  if (!selectedSizePresetId) {
    setSizePresetEditorStatus("Select a custom size guide before deleting.", "error");
    return;
  }

  try {
    const designUsageCount = orders.filter((order) => (
      order?.settings?.boundingSizePresetId === selectedSizePresetId
      || order?.publishedSnapshot?.settings?.boundingSizePresetId === selectedSizePresetId
    )).length;
    if (designUsageCount > 0) {
      throw new Error(`Size guide is used by ${designUsageCount} design${designUsageCount === 1 ? "" : "s"} and cannot be deleted.`);
    }

    const deletedDefinition = getBoundingSizePresetDefinitionsForEditor()
      .find((definition) => definition.id === selectedSizePresetId);
    const result = deleteBoundingSizePresetDefinitionLocally(selectedSizePresetId);
    clearSizePresetEditor();
    refreshBoundingSizePresetUi(DEFAULT_BOUNDING_SIZE_PRESET_ID);

    try {
      await savePresetSnapshot(result.snapshot);
      setSizePresetEditorStatus(`Deleted ${deletedDefinition?.label || "size guide"}.`, "success");
    } catch (error) {
      setSizePresetEditorStatus(
        error instanceof Error
          ? `Supabase delete failed: ${error.message}`
          : "Supabase delete failed.",
        "warning",
      );
    }
  } catch (error) {
    setSizePresetEditorStatus(error instanceof Error ? error.message : "Unable to delete size guide.", "error");
  }
}

function canSaveThroughProductionBatchConflict(publishOrderIds) {
  if (!productionBatchConflictState?.orderId) {
    return true;
  }

  return Array.isArray(publishOrderIds)
    && resolveProductionBatchSaveOrderIds(publishOrderIds).includes(productionBatchConflictState.orderId);
}

function clearProductionBatchAutosaveTimeout() {
  if (productionBatchAutosaveTimeoutId != null) {
    window.clearTimeout(productionBatchAutosaveTimeoutId);
    productionBatchAutosaveTimeoutId = null;
  }
}

async function waitForProductionBatchAutosaveIdle() {
  while (productionBatchAutosaveInFlight) {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
}

async function flushProductionBatchAutosave(options = {}) {
  const { force = false, keepalive = false } = options;
  const allowConcurrentKeepalive = force && keepalive;
  clearProductionBatchAutosaveTimeout();

  if (
    ((!productionBatchAutosavePending && !force) || (productionBatchAutosaveInFlight && !allowConcurrentKeepalive) || suppressProductionBatchAutosave || !isProductionBatchSyncEnabled())
  ) {
    if (!productionBatchAutosaveInFlight) {
      productionBatchAutosavePending = false;
    }
    return;
  }

  productionBatchAutosavePending = false;
  const autosaveWasAlreadyInFlight = productionBatchAutosaveInFlight;
  if (!autosaveWasAlreadyInFlight) {
    productionBatchAutosaveInFlight = true;
  }

  try {
    await saveBatchSnapshotToRemote({
      persistActiveDraft: false,
      successMessage: false,
      keepalive,
      degradeOnFailure: !keepalive,
    });
  } finally {
    if (!autosaveWasAlreadyInFlight) {
      productionBatchAutosaveInFlight = false;
    }
    if (productionBatchAutosavePending && !autosaveWasAlreadyInFlight) {
      triggerProductionBatchAutosave();
    }
  }
}

function triggerProductionBatchAutosave(options = {}) {
  const { immediate = false } = options;

  if (suppressProductionBatchAutosave || !isProductionBatchSyncEnabled()) {
    return;
  }

  productionBatchAutosavePending = true;

  if (productionBatchAutosaveInFlight) {
    return;
  }

  clearProductionBatchAutosaveTimeout();

  if (immediate) {
    void flushProductionBatchAutosave();
    return;
  }

  productionBatchAutosaveTimeoutId = window.setTimeout(() => {
    productionBatchAutosaveTimeoutId = null;
    void flushProductionBatchAutosave();
  }, 150);
}

function updateBatchSyncStatus(kind, options = {}) {
  if (!batchSyncStatus || !batchSyncStatusLabel || !batchSyncStatusDetail) {
    return;
  }

  const status = buildBatchSyncStatus(kind, options);
  if (!status) {
    batchSyncStatus.hidden = true;
    batchSyncStatusLabel.textContent = "";
    batchSyncStatusDetail.textContent = "";
    batchSyncStatus.classList.remove("status-ok", "status-warning", "status-pending");
    return;
  }

  batchSyncStatus.hidden = false;
  batchSyncStatus.classList.remove("status-ok", "status-warning", "status-pending");
  batchSyncStatus.classList.add(`status-${status.tone}`);
  batchSyncStatusLabel.textContent = status.label;
  batchSyncStatusDetail.textContent = status.detail;
}

function renderProductionBatchToast(activeOrder = getActiveOrder()) {
  const isOrderRelevant = isProductionBatchBannerRelevantToOrder(activeOrder);
  const auditSource = isOrderRelevant && productionBatchConflictState?.auditSource
    ? productionBatchConflictState.auditSource
    : getProductionBatchAuditSource(activeOrder);
  const auditText = buildLastUpdatedText(auditSource);
  let tone = "error";
  let label = "";
  let detail = "";
  let actionLabel = "";
  let actionHandler = null;
  let includeAuditText = Boolean(auditText);

  if (productionBatchConflictState && isOrderRelevant) {
    label = "A newer version of this design has been saved";
    actionLabel = "Load Latest Design";
    actionHandler = reloadProductionBatchFromToast;
    includeAuditText = false;
  } else if (productionBatchSyncState === "disabled" && productionBatchSyncDetail) {
    label = "Supabase sync unavailable";
    detail = productionBatchSyncDetail;
  } else {
    clearProductionBatchToast();
    return;
  }

  const message = `${label}. ${[detail, includeAuditText ? auditText : ""].filter(Boolean).join(" ")}`.trim();
  updateWorkflowAlert(message, tone, {
    actionLabel,
    onAction: actionHandler,
    autoHideMs: 0,
    source: "production-batch",
  });
}

function clearProductionBatchToast() {
  if (workflowAlert?.dataset.source === "production-batch") {
    updateWorkflowAlert("", "pending", { autoHideMs: 0 });
  }
}

function applyPersistedBatchState(parsed) {
  if (!parsed || !Array.isArray(parsed.orderItems)) {
    return false;
  }

  setProductionBatchContext(parsed.batch || productionBatchContext || batchSessionContext?.batch || null);
  const restoredOrders = parsed.orderItems
    .map((order, index) => hydrateStoredOrder(order, index))
    .filter(Boolean);

  orders.splice(0, orders.length, ...restoredOrders);
  orderSequence = Math.max(
    Number.isInteger(parsed.orderSequence) ? parsed.orderSequence : 1,
    restoredOrders.length + 1,
  );
  activeOrderItemId = restoredOrders.some((order) => order.id === parsed.activeOrderItemId)
    ? parsed.activeOrderItemId
    : restoredOrders[0]?.id || null;
  restoredOrders.forEach((order) => {
    syncOrderPresetFromListing(order, {
      force: typeof order.savedSettingsSignature !== "string",
    });
  });
  const activeOrder = getActiveOrder();
  if (activeOrder) {
    applySettings(activeOrder.settings);
  }
  return restoredOrders.length > 0;
}

function persistBatchState(options = {}) {
  const { skipRemoteSave = false } = options;

  if (!orders.length && !suppressBatchSyncLocalNotice) {
    updateBatchSyncStatus("empty");
  }

  if (!skipRemoteSave) {
    triggerProductionBatchAutosave();
  }
}

function schedulePersistBatchState(options = {}) {
  if (batchPersistenceTimeoutId != null) {
    window.clearTimeout(batchPersistenceTimeoutId);
  }

  batchPersistenceTimeoutId = window.setTimeout(() => {
    batchPersistenceTimeoutId = null;
    persistBatchState(options);
  }, 150);
}

function flushPersistBatchState(options = {}) {
  const { keepalive = false } = options;

  if (batchPersistenceTimeoutId != null) {
    window.clearTimeout(batchPersistenceTimeoutId);
    batchPersistenceTimeoutId = null;
  }

  persistBatchState({ skipRemoteSave: true });
  if (keepalive && hasPendingProductionBatchChanges()) {
    void flushProductionBatchAutosave({ force: true, keepalive: true });
    return;
  }

  triggerProductionBatchAutosave({ immediate: true });
}

function flushLocalBatchPersistence() {
  if (batchPersistenceTimeoutId != null) {
    window.clearTimeout(batchPersistenceTimeoutId);
    batchPersistenceTimeoutId = null;
  }

  persistBatchState({ skipRemoteSave: true });
}

function clearProductionBatchConflict() {
  productionBatchConflictState = null;
  suppressBatchSyncLocalNotice = true;
  persistBatchState({ skipRemoteSave: true });
  suppressBatchSyncLocalNotice = false;
}

function reloadProductionBatchFromToast() {
  if (productionBatchConflictState) {
    clearProductionBatchConflict();
  }

  saveActiveOrderDraft();
  clearProductionBatchAutosaveTimeout();
  productionBatchAutosavePending = false;
  flushLocalBatchPersistence();
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

async function saveBatchSnapshotToRemote(options = {}) {
  const {
    persistActiveDraft = true,
    publishOrderIds = undefined,
    successMessage = null,
    successAlertAutoHideMs = undefined,
    keepalive = false,
    degradeOnFailure = true,
  } = options;
  let snapshot = null;

  if (persistActiveDraft) {
    saveActiveOrderDraft();
  }

  if (!canSaveThroughProductionBatchConflict(publishOrderIds)) {
    renderProductionBatchToast();
    return false;
  }

  try {
    snapshot = buildProductionBatchSnapshot({ publishOrderIds });
    const snapshotKey = buildProductionBatchSaveKey(snapshot);
    const changedOrderItemIds = resolveProductionBatchSaveOrderIds(publishOrderIds);

    if (!canAttemptProductionBatchSave() || !snapshot.batch?.id || !snapshot.batch?.workspaceId) {
      return false;
    }

    if (snapshotKey && snapshotKey === lastProductionBatchSaveKey) {
      return true;
    }

    const accessToken = productionBatchAccessToken || readProductionBatchAccessTokenOverride() || await getAccessToken();
    if (!accessToken) {
      throw new Error("Authentication required.");
    }
    productionBatchAccessToken = accessToken;

    const savedSnapshot = await saveProductionBatchSnapshot(snapshot, { keepalive, accessToken, changedOrderItemIds });
    if (productionBatchConflictState) {
      renderProductionBatchToast();
      return false;
    }
    clearSaveErrorsForOrderIds(changedOrderItemIds);
    if (savedSnapshot?.batch) {
      enableProductionBatchSync(savedSnapshot.batch);
    }
    mergeProductionBatchPublishedStateFromSnapshot(savedSnapshot || snapshot);
    mergeProductionBatchAuditFromSnapshot(savedSnapshot);
    lastProductionBatchSaveKey = buildProductionBatchSaveKey(savedSnapshot || snapshot);
    suppressBatchSyncLocalNotice = true;
    suppressProductionBatchAutosave = true;
    persistBatchState({ skipRemoteSave: true });
    suppressProductionBatchAutosave = false;
    suppressBatchSyncLocalNotice = false;

    if (isBatchSnapshotEmpty(savedSnapshot || snapshot)) {
      updateBatchSyncStatus("empty");
      return true;
    }

    if (typeof successMessage === "string" && successMessage.trim()) {
      updateWorkflowAlert(successMessage.trim(), "success", {
        autoHideMs: successAlertAutoHideMs,
      });
    }
    updateBatchSyncStatus("saved-remote", { count: (savedSnapshot || snapshot).orderItems.length });
    return true;
  } catch (error) {
    suppressProductionBatchAutosave = false;
    suppressBatchSyncLocalNotice = false;
    const isConflictError = error instanceof ProductionBatchConflictError;
    if (isConflictError) {
      const conflictDetailOrderId = typeof error.details?.orderItemId === "string" && error.details.orderItemId
        ? error.details.orderItemId
        : typeof error.details?.orderId === "string" && error.details.orderId
          ? error.details.orderId
          : "";
      const fallbackConflictOrderId = resolveProductionBatchSaveOrderIds(publishOrderIds)[0] || "";
      const conflictingOrder = orders.find((order) => order.id === conflictDetailOrderId)
        || orders.find((order) => order.id === fallbackConflictOrderId)
        || getActiveOrder();
      const conflictingOrderId = conflictDetailOrderId || conflictingOrder?.id || "";
      if (conflictingOrder) {
        applyProductionBatchAuditToOrder(conflictingOrder, error.details);
      }
      productionBatchConflictState = {
        orderId: conflictingOrderId,
        detail: "",
        auditSource: error.details && typeof error.details === "object" ? structuredClone(error.details) : null,
      };
      persistBatchState({ skipRemoteSave: true });
      markSaveErrorForOrderIds([conflictingOrderId].filter(Boolean), "Production batch save conflict. Load the latest design before saving again.");
      renderProductionBatchToast();
      return false;
    }

    if (isProductionBatchAuthenticationError(error)) {
      const detail = "Production batch session expired. Sign in again to continue saving this batch.";
      handleProductionBatchAuthenticationRequired(detail);
      persistBatchState({ skipRemoteSave: true });
      markSaveErrorForOrderIds(resolveProductionBatchSaveOrderIds(publishOrderIds), detail);
      updateWorkflowAlert(detail, "pending");
      return false;
    }

    if (degradeOnFailure && !isConflictError) {
      disableProductionBatchSync(
        error instanceof Error && error.message
          ? `Production batch sync is unavailable. ${error.message}`
          : "Production batch sync is unavailable.",
      );
      persistBatchState({ skipRemoteSave: true });
    }
    productionBatchConflictState = null;
    markSaveErrorForOrderIds(
      resolveProductionBatchSaveOrderIds(publishOrderIds),
      error instanceof Error ? error.message : "Unable to save the production batch.",
    );
    renderProductionBatchToast();
    updateWorkflowAlert(
      error instanceof Error ? error.message : "Unable to save the production batch.",
      "error",
    );
    return false;
  }
}

async function restoreInitialBatchState(accessToken) {
  let batchSession = null;
  let remoteSnapshot = null;
  let sharedSyncUnavailable = false;
  productionBatchConflictState = null;

  try {
    batchSession = await fetchBatchSession(accessToken);
    batchSessionContext = batchSession;
    if (batchSession?.batch) {
      enableProductionBatchSync(batchSession.batch);
    } else {
      setProductionBatchContext(null);
      setProductionBatchSyncState("disabled");
    }
  } catch (error) {
    if (isProductionBatchAuthenticationError(error)) {
      batchSessionContext = null;
      setProductionBatchContext(null);
      handleProductionBatchAuthenticationRequired("Production batch session expired. Sign in again to reopen the production batch.");
      return {
        source: null,
        count: 0,
      };
    }

    batchSessionContext = null;
    setProductionBatchContext(null);
    disableProductionBatchSync(
      error instanceof Error && error.message
        ? `Production batch sync is unavailable. ${error.message}`
        : "Production batch sync is unavailable.",
    );
    sharedSyncUnavailable = true;
  }

  if (batchSession?.batch?.id) {
    try {
      remoteSnapshot = await fetchProductionBatchSnapshot(batchSession.batch.id, accessToken);
    } catch (error) {
      if (isProductionBatchAuthenticationError(error)) {
        handleProductionBatchAuthenticationRequired("Production batch session expired. Sign in again to reopen the production batch.");
        return {
          source: null,
          count: 0,
        };
      }

      disableProductionBatchSync(
        error instanceof Error && error.message
          ? `Production batch sync is unavailable. ${error.message}`
          : "Production batch sync is unavailable.",
      );
      sharedSyncUnavailable = true;
    }
  }

  const startupState = chooseProductionBatchStartupState({
    remoteSnapshot,
    localCache: null,
  });
  const initialSnapshot = startupState.snapshot;

  if (initialSnapshot?.batch) {
    setProductionBatchContext(initialSnapshot.batch);
  }

  if (!initialSnapshot || !applyPersistedBatchState(initialSnapshot)) {
    suppressBatchSyncLocalNotice = true;
    persistBatchState({ skipRemoteSave: true });
    suppressBatchSyncLocalNotice = false;
    lastProductionBatchSaveKey = null;
    updateBatchSyncStatus("empty");
    return {
      source: startupState.source,
      count: 0,
    };
  }

  suppressBatchSyncLocalNotice = true;
  persistBatchState({ skipRemoteSave: true });
  suppressBatchSyncLocalNotice = false;
  lastProductionBatchSaveKey = startupState.source === "remote"
    ? buildProductionBatchSaveKey(buildProductionBatchSnapshot())
    : null;

  if (startupState.source === "remote") {
    updateBatchSyncStatus("restored-remote", { count: orders.length });
  }

  if (sharedSyncUnavailable && !orders.length) {
    updateWorkflowAlert("Supabase sync is unavailable. Production data was not loaded.", "error");
  }

  return {
    source: startupState.source,
    count: orders.length,
  };
}

function createBatchItem({
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
    saveErrorMessage: null,
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
    getPresetFixedItems,
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

function shouldSyncOrderPreset(order, presetId, options = {}) {
  const { force = false } = options;
  if (
    !order
    || !presetId
  ) {
    return false;
  }

  if (!force && (
    order.source?.manualPresetOverride
    || typeof order.savedSettingsSignature === "string"
  )) {
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

function syncOrderPresetFromListing(order, options = {}) {
  const mappedPresetId = getMappedPresetIdForOrder(order);
  if (!shouldSyncOrderPreset(order, mappedPresetId, options)) {
    return;
  }

  const nextSettings = buildPresetSynchronizedSettings(order.settings, mappedPresetId, {
    listingId: order.source?.listingId,
  });
  clearOrderCompletionState(order, nextSettings);
  if (order.source) {
    order.source.manualPresetOverride = false;
  }
}

function syncOrdersForListingAssignmentChange(listingId) {
  if (!listingId) {
    return false;
  }

  let activeOrderChanged = false;
  let batchChanged = false;

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
    batchChanged = true;
    activeOrderChanged = activeOrderChanged || order.id === activeOrderItemId;
  });

  if (activeOrderChanged) {
    const activeOrder = getActiveOrder();
    if (activeOrder) {
      applySettings(activeOrder.settings);
    }
  }

  return batchChanged;
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
  if (workflowAlertText) {
    workflowAlertText.textContent = hasMessage ? message : "";
  } else {
    workflowAlert.textContent = hasMessage ? message : "";
  }
  workflowAlert.dataset.state = state;
  workflowAlert.dataset.source = hasMessage && typeof options.source === "string" ? options.source : "";

  const hasAction = hasMessage
    && typeof options.actionLabel === "string"
    && options.actionLabel.trim().length > 0
    && typeof options.onAction === "function";
  workflowAlert.classList.toggle("has-action", hasAction);
  workflowAlertActionHandler = hasAction ? options.onAction : null;
  if (workflowAlertActionButton) {
    workflowAlertActionButton.hidden = !hasAction;
    workflowAlertActionButton.textContent = hasAction ? options.actionLabel.trim() : "";
  }

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

function closeDetailsMenu(menu) {
  if (!(menu instanceof HTMLDetailsElement)) {
    return;
  }

  menu.removeAttribute("open");
}

function registerOutsideDismissableDetailsMenu(menu) {
  if (!(menu instanceof HTMLDetailsElement)) {
    return;
  }

  document.addEventListener("pointerdown", (event) => {
    if (!menu.hasAttribute("open")) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && menu.contains(target)) {
      return;
    }

    closeDetailsMenu(menu);
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    closeDetailsMenu(menu);
  });
}

function closeOpenDatabaseOrderItemMenus(exceptMenu = null) {
  databaseOrdersWorkspace?.querySelectorAll(".database-order-item-menu[open]").forEach((menu) => {
    if (menu !== exceptMenu) {
      closeDetailsMenu(menu);
    }
  });
}

function registerDatabaseOrderItemMenuDismissal(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const itemMenu = target instanceof Element
      ? target.closest(".database-order-item-menu")
      : null;
    if (itemMenu && container.contains(itemMenu)) {
      closeOpenDatabaseOrderItemMenus(itemMenu);
      return;
    }

    closeOpenDatabaseOrderItemMenus();
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    closeOpenDatabaseOrderItemMenus();
  });
}

function getDatabaseOrderNumber(order) {
  const rawOrderNumber = typeof order?.orderNumber === "string" ? order.orderNumber.trim() : "";
  return rawOrderNumber || String(order?.id || "").replace(/^order:/, "") || "Unknown";
}

function getDatabaseOrderMeta(order) {
  const parts = [];
  if (typeof order?.buyerName === "string" && order.buyerName.trim()) {
    parts.push(order.buyerName.trim());
  }

  const itemCount = Array.isArray(order?.items) ? order.items.length : 0;
  parts.push(`${itemCount} item${itemCount === 1 ? "" : "s"}`);
  parts.push(order?.isInActiveBatch ? "In batch" : "Not in batch");
  return parts.join(" - ");
}

function getDatabaseOrderItemListingImageUrl(item) {
  const candidates = [
    item?.source?.listingImageUrl75x75,
    item?.listingImageUrl75x75,
    item?.listing?.imageUrl75x75,
    item?.listing?.imageUrl,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return match ? match.trim() : "";
}

function getDatabaseOrderItemDesignText(item) {
  const design = item?.design && typeof item.design === "object" ? item.design : {};
  const directText = typeof design.text === "string" && design.text.trim()
    ? design.text.trim()
    : typeof item?.text === "string" && item.text.trim()
      ? item.text.trim()
      : "";
  return directText || "No design text";
}

function getDatabaseOrderItemColorText(item) {
  const candidates = [
    item?.source?.colorName,
    item?.importedColor,
    item?.colorName,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return match ? match.trim() : "No color";
}

function getDatabaseOrderItemQuantityText(item) {
  const candidates = [
    item?.source?.quantity,
    item?.quantity,
  ];
  const match = candidates.find((value) => value != null && String(value).trim());
  return match ? String(match).trim() : "1";
}

function getDatabaseOrderItemFlattenedLines(item) {
  const lines = Array.isArray(item?.design?.lines) ? item.design.lines : [];
  const lineText = lines
    .map((line) => (typeof line?.text === "string" ? line.text.trim() : ""))
    .filter(Boolean);
  return lineText.length ? lineText.join(" / ") : getDatabaseOrderItemDesignText(item);
}

function createDatabaseOrderRowImageStack(order) {
  const items = getDatabaseOrderItems(order);
  const stack = document.createElement("span");
  stack.className = "database-order-row-image-stack";
  stack.classList.toggle("is-stacked", items.length > 1);
  stack.setAttribute("aria-hidden", items.length ? "false" : "true");

  const visibleItems = items.slice(0, 3);
  visibleItems.forEach((item, index) => {
    const imageUrl = getDatabaseOrderItemListingImageUrl(item);
    const thumbnail = imageUrl
      ? document.createElement("img")
      : document.createElement("span");

    thumbnail.className = imageUrl
      ? "database-order-row-thumbnail"
      : "database-order-row-thumbnail database-order-row-thumbnail-placeholder";
    thumbnail.style.setProperty("--stack-index", String(index));

    if (imageUrl) {
      thumbnail.src = imageUrl;
      thumbnail.alt = getDatabaseOrderItemListingText(item);
      thumbnail.loading = "lazy";
    } else {
      thumbnail.setAttribute("aria-hidden", "true");
    }

    stack.append(thumbnail);
  });

  if (items.length > visibleItems.length) {
    const overflow = document.createElement("span");
    overflow.className = "database-order-row-thumbnail database-order-row-thumbnail-more";
    overflow.style.setProperty("--stack-index", String(visibleItems.length));
    overflow.setAttribute("aria-label", `${items.length - visibleItems.length} more order items`);
    overflow.textContent = `+${items.length - visibleItems.length}`;
    stack.append(overflow);
  }

  return stack;
}

function updateDatabaseOrdersState(nextState) {
  databaseOrders = nextState.orders;
  selectedDatabaseOrderId = nextState.selectedOrderId;
  checkedDatabaseOrderIds = nextState.checkedOrderIds;
}

function invalidateDatabaseOrders() {
  loadedDatabaseOrdersKey = null;
}

async function resolveProductionBatchMutationAccessToken() {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("Authentication required.");
  }
  productionBatchAccessToken = accessToken;
  return accessToken;
}

function getActiveProductionBatchId() {
  return typeof productionBatchContext?.id === "string" && productionBatchContext.id.trim()
    ? productionBatchContext.id.trim()
    : "";
}

function requireActiveProductionBatchId() {
  const batchId = getActiveProductionBatchId();
  if (!batchId) {
    updateWorkflowAlert("Open an active production batch before adding orders.", "error");
    return "";
  }

  return batchId;
}

function countFromPayload(payload, key) {
  const value = Number(payload?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function designNoun(count) {
  return `design${count === 1 ? "" : "s"}`;
}

function buildOrdersImportMessage(payload) {
  const importedCount = countFromPayload(payload, "importedOrderItemCount");
  if (importedCount > 0) {
    return `Imported ${importedCount} Etsy ${designNoun(importedCount)} to Orders.`;
  }

  return "No new Etsy designs were imported.";
}

function buildProductionBatchImportMessage(payload) {
  const importedCount = countFromPayload(payload, "importedOrderItemCount");
  const addedCount = countFromPayload(payload, "addedOrderItemCount");

  if (importedCount > 0 && addedCount > 0) {
    return `Imported ${importedCount} Etsy ${designNoun(importedCount)} and added ${addedCount} to the production batch.`;
  }
  if (importedCount > 0) {
    return `Imported ${importedCount} Etsy ${designNoun(importedCount)}. No new designs were added to the production batch.`;
  }
  if (addedCount > 0) {
    return `Added ${addedCount} existing ${designNoun(addedCount)} to the production batch.`;
  }

  return "No new designs were added to the production batch.";
}

function buildAddedToBatchMessage(payload) {
  const addedCount = countFromPayload(payload, "addedOrderItemCount");

  if (addedCount > 0) {
    return `Added ${addedCount} ${designNoun(addedCount)} to the production batch.`;
  }

  return "Selected designs were already in the production batch.";
}

function buildSkippedBatchImportMessage(skippedCount) {
  return `Skipped ${skippedCount} Etsy ${designNoun(skippedCount)} already in the batch. No new designs were added.`;
}

function showPasteSummaryDialog({
  targetLabel = "Orders",
  importedCount = 0,
  skippedDuplicateCount = 0,
  addedToBatchCount = 0,
} = {}) {
  if (!(pasteSummaryDialog instanceof HTMLDialogElement)) {
    return;
  }

  if (pasteSummaryTarget) {
    pasteSummaryTarget.textContent = targetLabel;
  }
  if (pasteSummaryImportedCount) {
    pasteSummaryImportedCount.textContent = String(Math.max(0, importedCount));
  }
  if (pasteSummarySkippedCount) {
    pasteSummarySkippedCount.textContent = String(Math.max(0, skippedDuplicateCount));
  }
  if (pasteSummaryAddedCount) {
    pasteSummaryAddedCount.textContent = String(Math.max(0, addedToBatchCount));
  }

  pasteSummaryDialog.showModal();
}

function closePasteSummaryDialog() {
  if (pasteSummaryDialog instanceof HTMLDialogElement && pasteSummaryDialog.open) {
    pasteSummaryDialog.close();
  }
}

function assertImportableItems(importedItems) {
  if (!Array.isArray(importedItems) || importedItems.length === 0) {
    throw new Error("Clipboard data did not include any importable Etsy designs.");
  }
}

function filterNewProductionBatchImportItems(importedItems) {
  const existingImportedIdentities = new Set(
    orders
      .map((order) => buildImportedBatchIdentity(order?.source, order?.text))
      .filter(Boolean),
  );
  const filteredItems = [];
  let skippedCount = 0;

  for (const entry of importedItems) {
    const identity = buildImportedBatchIdentity(entry.source, entry.text);

    if (identity && existingImportedIdentities.has(identity)) {
      skippedCount += 1;
      continue;
    }

    if (identity) {
      existingImportedIdentities.add(identity);
    }

    filteredItems.push(entry);
  }

  return { filteredItems, skippedCount };
}

function appendImportedItemsToProductionBatch(importedItems, { maxCount = importedItems.length } = {}) {
  if (!Array.isArray(importedItems) || maxCount <= 0) {
    return 0;
  }

  const { filteredItems } = filterNewProductionBatchImportItems(importedItems);
  const itemsToAppend = filteredItems.slice(0, maxCount);

  if (!itemsToAppend.length) {
    return 0;
  }

  saveActiveOrderDraft();
  let firstAppendedOrderId = null;
  for (const item of itemsToAppend) {
    const order = createBatchItem({
      text: item.text || "",
      status: "not-started",
      presetId: item.presetId,
      source: item.source,
    });
    orders.push(order);
    firstAppendedOrderId = firstAppendedOrderId || order.id;
  }

  if (firstAppendedOrderId) {
    selectOrder(firstAppendedOrderId);
    render();
  } else {
    persistBatchState();
    renderOrderList();
  }
  return itemsToAppend.length;
}

function handleOrdersMutationError(error, fallbackMessage, authDetail) {
  if (isProductionBatchAuthenticationError(error)) {
    const detail = authDetail || "Production batch session expired. Sign in again to continue.";
    handleProductionBatchAuthenticationRequired(detail);
    updateWorkflowAlert(detail, "pending");
    return;
  }

  updateWorkflowAlert(
    error instanceof Error ? error.message : fallbackMessage,
    "error",
  );
}

function updateDatabaseOrdersFromPayload(payload, options = {}) {
  if (!Array.isArray(payload?.orders)) {
    return false;
  }

  updateDatabaseOrdersState(normalizeOrdersWorkspaceState({
    payload,
    selectedOrderId: selectedDatabaseOrderId,
    checkedOrderIds: options.checkedOrderIds ?? checkedDatabaseOrderIds,
  }));
  loadedDatabaseOrdersKey = `${getActiveProductionBatchId() || ""}|${databaseOrdersStatusFilterValue}`;
  renderDatabaseOrdersWorkspace();
  return true;
}

async function refreshProductionBatchSnapshot(accessToken) {
  const batchId = getActiveProductionBatchId();
  if (!batchId) {
    return false;
  }

  const snapshot = await fetchProductionBatchSnapshot(batchId, accessToken);
  if (snapshot?.batch) {
    enableProductionBatchSync(snapshot.batch);
  }
  if (snapshot) {
    applyPersistedBatchState(snapshot);
    lastProductionBatchSaveKey = buildProductionBatchSaveKey(buildProductionBatchSnapshot());
    suppressBatchSyncLocalNotice = true;
    persistBatchState({ skipRemoteSave: true });
    suppressBatchSyncLocalNotice = false;
    renderOrderList();
    return true;
  }

  return false;
}

async function refreshOrdersAndProductionBatch({ payload = null, accessToken, refreshBatch = false } = {}) {
  if (refreshBatch) {
    await refreshProductionBatchSnapshot(accessToken);
  }

  if (payload) {
    databaseOrdersMutationVersion += 1;
  }

  if (!updateDatabaseOrdersFromPayload(payload)) {
    invalidateDatabaseOrders();
    await loadDatabaseOrders({ force: true });
  }
}

async function loadDatabaseOrders({ force = false } = {}) {
  if (!productionBatchAccessToken) {
    return;
  }

  const batchId = productionBatchContext?.id || null;
  const loadKey = `${batchId || ""}|${databaseOrdersStatusFilterValue}`;
  if (databaseOrdersLoading || (!force && loadedDatabaseOrdersKey === loadKey)) {
    return;
  }

  if (force) {
    invalidateDatabaseOrders();
  }

  databaseOrdersLoading = true;
  const loadMutationVersion = databaseOrdersMutationVersion;
  renderDatabaseOrdersWorkspace();
  updateWorkflowAlert("Loading orders...", "pending", { autoHideMs: 0 });

  try {
    const payload = await fetchWorkspaceOrders({
      batchId,
      statusFilter: databaseOrdersStatusFilterValue,
      accessToken: productionBatchAccessToken,
    });
    if (loadMutationVersion !== databaseOrdersMutationVersion) {
      return;
    }
    updateDatabaseOrdersState(normalizeOrdersWorkspaceState({
      payload,
      selectedOrderId: selectedDatabaseOrderId,
      checkedOrderIds: checkedDatabaseOrderIds,
    }));
    loadedDatabaseOrdersKey = loadKey;
    if (databaseOrders.length === 0) {
      updateWorkflowAlert("No orders found in the workspace.", "pending");
    } else {
      updateWorkflowAlert("", "pending", { autoHideMs: 0 });
    }
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to load workspace orders.", "error");
  } finally {
    databaseOrdersLoading = false;
    renderDatabaseOrdersWorkspace();
  }
}

function updateDatabaseOrderSelectionRows() {
  if (!databaseOrdersListShell) {
    return;
  }

  databaseOrdersListShell.querySelectorAll(".database-order-row").forEach((row) => {
    const isSelected = row instanceof HTMLElement && row.dataset.orderId === selectedDatabaseOrderId;
    row.classList.toggle("is-selected", isSelected);
    row.querySelector(".database-order-row-button")?.setAttribute("aria-pressed", String(isSelected));
  });
}

function selectDatabaseOrder(orderId, options = {}) {
  const { updateRoute = true, replaceRoute = false } = options;
  const order = databaseOrders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return false;
  }

  selectedDatabaseOrderId = order.id;
  updateDatabaseOrderSelectionRows();
  renderSelectedDatabaseOrderItems();
  if (updateRoute) {
    writeAppRoute({
      replace: replaceRoute,
      workspace: "databaseOrders",
      itemId: selectedDatabaseOrderId,
    });
  }
  return true;
}

function getVisibleDatabaseOrders() {
  return filterGroupedOrders(databaseOrders, {
    searchTerm: databaseOrdersSearchTerm,
    statusFilter: databaseOrdersStatusFilterValue,
    batchFilter: databaseOrdersBatchFilterValue,
  });
}

function isDatabaseOrderItemSkipped(item) {
  return item?.status === "skipped";
}

function isDatabaseOrderItemComplete(item) {
  return item?.status === "complete";
}

function isDatabaseOrderItemBatchEligible(item) {
  return Boolean(item?.id) && !item?.isInActiveBatch && !isDatabaseOrderItemSkipped(item);
}

function isDatabaseOrderBatchEligible(order) {
  return (Array.isArray(order?.items) ? order.items : []).some(isDatabaseOrderItemBatchEligible);
}

function getDatabaseOrderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

function isDatabaseOrderFullySkipped(order) {
  const items = getDatabaseOrderItems(order);
  return items.length > 0 && items.every(isDatabaseOrderItemSkipped);
}

function canSkipDatabaseOrder(order) {
  return getDatabaseOrderItems(order).some((item) => !isDatabaseOrderItemSkipped(item) && !isDatabaseOrderItemComplete(item));
}

function canReopenDatabaseOrder(order) {
  return isDatabaseOrderFullySkipped(order);
}

function getVisibleCheckedDatabaseOrders() {
  const visibleOrderIds = new Set(getVisibleDatabaseOrders().map((order) => order.id));
  return databaseOrders.filter((order) => (
    visibleOrderIds.has(order.id)
    && checkedDatabaseOrderIds.has(order.id)
  ));
}

function hasDatabaseOrderItemsInActiveBatch(order) {
  return getDatabaseOrderItems(order).some((item) => Boolean(item?.isInActiveBatch));
}

function renderDatabaseOrdersWorkspace() {
  if (!databaseOrdersListShell || !addCheckedOrdersToBatchButton) {
    return;
  }

  const listScrollState = captureElementScrollState(databaseOrdersListShell);
  databaseOrdersListShell.id ||= "databaseOrdersList";
  databaseOrdersListShell.replaceChildren();

  if (pasteOrdersButton) {
    pasteOrdersButton.disabled = databaseOrdersImporting || !productionBatchAccessToken;
  }
  const visibleOrders = getVisibleDatabaseOrders();
  const visibleOrderIds = new Set(visibleOrders.map((order) => order.id));
  const selectionState = getVisibleOrderSelectionState(visibleOrders, checkedDatabaseOrderIds);
  const batchEligibleOrderIds = new Set(
    visibleOrders
      .filter(isDatabaseOrderBatchEligible)
      .map((order) => order.id),
  );
  const visibleCheckedOrderCount = [...checkedDatabaseOrderIds]
    .filter((orderId) => visibleOrderIds.has(orderId) && batchEligibleOrderIds.has(orderId)).length;
  addCheckedOrdersToBatchButton.disabled = databaseOrdersLoading || visibleCheckedOrderCount === 0;
  const checkedVisibleOrders = visibleOrders.filter((order) => checkedDatabaseOrderIds.has(order.id));
  if (skipCheckedOrdersButton) {
    skipCheckedOrdersButton.disabled = databaseOrdersLoading || !checkedVisibleOrders.some(canSkipDatabaseOrder);
  }
  if (reopenCheckedOrdersButton) {
    reopenCheckedOrdersButton.disabled = databaseOrdersLoading || !checkedVisibleOrders.some(canReopenDatabaseOrder);
  }
  if (selectVisibleOrdersInput) {
    selectVisibleOrdersInput.checked = selectionState.allVisibleChecked;
    selectVisibleOrdersInput.indeterminate = selectionState.someVisibleChecked;
    selectVisibleOrdersInput.disabled = databaseOrdersLoading || selectionState.visibleOrderCount === 0;
  }

  if (databaseOrdersLoading) {
    const loading = document.createElement("p");
    loading.className = "batch-tools-note";
    loading.textContent = "Loading orders...";
    databaseOrdersListShell.append(loading);
    restoreElementScrollState(databaseOrdersListShell, listScrollState);
    renderSelectedDatabaseOrderItems();
    return;
  }

  if (!databaseOrders.length) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note";
    empty.textContent = "No orders loaded.";
    databaseOrdersListShell.append(empty);
    restoreElementScrollState(databaseOrdersListShell, listScrollState);
    renderSelectedDatabaseOrderItems();
    return;
  }

  if (!visibleOrders.length) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note";
    empty.textContent = "No orders match the current filters.";
    databaseOrdersListShell.append(empty);
    restoreElementScrollState(databaseOrdersListShell, listScrollState);
    renderSelectedDatabaseOrderItems();
    return;
  }

  visibleOrders.forEach((order) => {
    const orderNumber = getDatabaseOrderNumber(order);
    const row = document.createElement("div");
    row.className = "database-order-row";
    row.dataset.orderId = order.id;
    row.classList.toggle("is-selected", order.id === selectedDatabaseOrderId);

    const checkbox = document.createElement("input");
    checkbox.className = "database-order-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = checkedDatabaseOrderIds.has(order.id);
    checkbox.disabled = !isDatabaseOrderBatchEligible(order) && !canSkipDatabaseOrder(order) && !canReopenDatabaseOrder(order);
    checkbox.setAttribute("aria-label", `Select order ${orderNumber}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        checkedDatabaseOrderIds.add(order.id);
      } else {
        checkedDatabaseOrderIds.delete(order.id);
      }
      renderDatabaseOrdersWorkspace();
    });

    const button = document.createElement("button");
    button.className = "database-order-row-button";
    button.type = "button";
    button.setAttribute("aria-pressed", String(order.id === selectedDatabaseOrderId));
    button.addEventListener("click", () => {
      selectDatabaseOrder(order.id);
    });

    const imageStack = createDatabaseOrderRowImageStack(order);

    const copy = document.createElement("span");
    copy.className = "database-order-row-copy";

    const title = document.createElement("span");
    title.className = "database-order-row-title";
    title.textContent = order.status === "skipped" ? `Order ${orderNumber} (Skipped)` : `Order ${orderNumber}`;

    const meta = document.createElement("span");
    meta.className = "database-order-row-meta";
    meta.textContent = getDatabaseOrderMeta(order);

    copy.append(title, meta);
    button.append(imageStack, copy);
    row.append(checkbox, button);
    databaseOrdersListShell.append(row);
  });

  restoreElementScrollState(databaseOrdersListShell, listScrollState);
  renderSelectedDatabaseOrderItems();
}

function toPositivePreviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function createDatabaseOrderItemPreviewGraphic(savedBuild) {
  const layout = savedBuild?.layout && typeof savedBuild.layout === "object" ? savedBuild.layout : null;
  if (!layout) {
    return null;
  }

  const widthMm = toPositivePreviewNumber(layout.widthMm);
  const heightMm = toPositivePreviewNumber(layout.heightMm);
  if (!widthMm || !heightMm) {
    return null;
  }

  const svg = makeSvgElement("svg", {
    class: "database-order-item-preview-svg",
    viewBox: `0 0 ${widthMm} ${heightMm}`,
    "aria-hidden": "true",
    focusable: "false",
    preserveAspectRatio: "xMidYMid meet",
  });

  const analysis = savedBuild?.analysis && typeof savedBuild.analysis === "object" ? savedBuild.analysis : null;
  if (typeof analysis?.backingPath === "string" && typeof analysis?.facePath === "string") {
    const previewFacePath = getPreviewFacePath(layout, analysis);
    svg.append(
      makeSvgElement("path", {
        d: analysis.backingPath,
        fill: "rgb(255, 0, 0)",
      }),
      makeSvgElement("path", {
        d: previewFacePath,
        fill: "#f8fbfc",
      }),
    );
    return svg;
  }

  if (Array.isArray(layout.letters) && layout.letters.length) {
    svg.append(
      makeSvgElement("image", {
        href: createBackingImage(layout.letters, widthMm, heightMm, Number(layout.backingMm) || 0),
        x: 0,
        y: 0,
        width: widthMm,
        height: heightMm,
      }),
      makeSvgElement("image", {
        href: createFaceImage(layout.letters, widthMm, heightMm).href,
        x: 0,
        y: 0,
        width: widthMm,
        height: heightMm,
      }),
    );
    return svg;
  }

  return null;
}

function renderSelectedDatabaseOrderItems() {
  if (!databaseOrderItemsShell) {
    return;
  }

  databaseOrderItemsShell.replaceChildren();
  const visibleOrders = getVisibleDatabaseOrders();
  const selectedOrder = getSelectedGroupedOrder(visibleOrders, selectedDatabaseOrderId);

  if (selectedDatabaseOrderTitle) {
    selectedDatabaseOrderTitle.textContent = selectedOrder
      ? `Order ${getDatabaseOrderNumber(selectedOrder)}`
      : "Selected order items";
  }
  if (selectedDatabaseOrderMeta) {
    selectedDatabaseOrderMeta.textContent = selectedOrder
      ? getDatabaseOrderMeta(selectedOrder)
      : "Select an order to review its items before adding designs to the production batch.";
  }
  if (addSelectedOrderToBatchButton) {
    addSelectedOrderToBatchButton.disabled = !selectedOrder || !isDatabaseOrderBatchEligible(selectedOrder) || ordersDatabaseMutationInFlight;
  }
  if (skipSelectedOrderButton) {
    const showSkipOrder = Boolean(selectedOrder) && !canReopenDatabaseOrder(selectedOrder);
    skipSelectedOrderButton.hidden = !showSkipOrder;
    skipSelectedOrderButton.disabled = !showSkipOrder || !canSkipDatabaseOrder(selectedOrder) || ordersDatabaseMutationInFlight;
  }
  if (reopenSelectedOrderButton) {
    const showReopenOrder = Boolean(selectedOrder) && canReopenDatabaseOrder(selectedOrder);
    reopenSelectedOrderButton.hidden = !showReopenOrder;
    reopenSelectedOrderButton.disabled = !showReopenOrder || ordersDatabaseMutationInFlight;
  }

  if (!selectedOrder) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = databaseOrdersLoading ? "Loading order items..." : "No order selected.";
    databaseOrderItemsShell.append(empty);
    return;
  }

  const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "This order has no imported items.";
    databaseOrderItemsShell.append(empty);
    return;
  }

  items.forEach((item) => {
    const savedBuild = getCopyableSavedBuild(item);
    const card = document.createElement("article");
    card.className = "database-order-item-card";

    const cardHeader = document.createElement("div");
    cardHeader.className = "database-order-item-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "database-order-item-title-group";

    const title = document.createElement("h3");
    title.textContent = "Order Item";

    const listing = document.createElement("p");
    listing.className = "database-order-item-listing";
    listing.textContent = getDatabaseOrderItemListingText(item);

    titleGroup.append(title, listing);

    const menu = document.createElement("details");
    menu.className = "workspace-tools-menu database-order-item-menu";
    const summary = document.createElement("summary");
    summary.className = "workspace-tools-toggle database-order-item-menu-toggle";
    summary.setAttribute("role", "button");
    summary.setAttribute("aria-label", "Item actions");
    const menuBody = document.createElement("div");
    menuBody.className = "workspace-tools-popover database-order-item-menu-popover";
    const menuActions = document.createElement("div");
    menuActions.className = "workspace-tools-actions";
    menuActions.setAttribute("role", "menu");
    menuActions.setAttribute("aria-label", "Order item actions");
    const menuGroup = document.createElement("div");
    menuGroup.className = "workspace-tools-group";
    menuGroup.setAttribute("aria-label", "Order item actions");
    const menuHeading = document.createElement("p");
    menuHeading.className = "workspace-tools-heading";
    menuHeading.textContent = "Order Item";

    const copyDesignButton = document.createElement("button");
    copyDesignButton.type = "button";
    copyDesignButton.textContent = "Copy Design";
    copyDesignButton.addEventListener("click", () => {
      void copyDatabaseOrderItemDesign(item, copyDesignButton);
      closeDetailsMenu(menu);
    });

    const addToBatchButton = document.createElement("button");
    addToBatchButton.type = "button";
    addToBatchButton.textContent = "Add to Production Batch";
    addToBatchButton.disabled = !isDatabaseOrderItemBatchEligible(item);
    addToBatchButton.addEventListener("click", () => {
      void addDatabaseOrderItemToBatch(item, addToBatchButton);
      closeDetailsMenu(menu);
    });

    const statusActionButton = document.createElement("button");
    statusActionButton.type = "button";
    if (isDatabaseOrderItemSkipped(item)) {
      statusActionButton.textContent = "Reopen Order";
      statusActionButton.addEventListener("click", () => {
        void reopenDatabaseOrderItem(item, statusActionButton);
        closeDetailsMenu(menu);
      });
    } else {
      statusActionButton.textContent = "Skip Order Item";
      statusActionButton.disabled = isDatabaseOrderItemComplete(item);
      statusActionButton.addEventListener("click", () => {
        void skipDatabaseOrderItem(item, statusActionButton);
        closeDetailsMenu(menu);
      });
    }

    [copyDesignButton, addToBatchButton, statusActionButton].forEach((button) => {
      button.className = "batch-tool-button";
      const label = document.createElement("span");
      label.className = "batch-tool-label";
      label.textContent = button.textContent;
      button.replaceChildren(label);
    });

    menuGroup.append(menuHeading, copyDesignButton, addToBatchButton, statusActionButton);
    menuActions.append(menuGroup);
    menuBody.append(menuActions);
    menu.append(summary, menuBody);

    cardHeader.append(titleGroup, menu);

    const listingMedia = document.createElement("div");
    listingMedia.className = "database-order-item-listing-media";

    const listingImageUrl = getDatabaseOrderItemListingImageUrl(item);
    if (listingImageUrl) {
      const listingImage = document.createElement("img");
      listingImage.className = "database-order-item-listing-image";
      listingImage.src = listingImageUrl;
      listingImage.alt = getDatabaseOrderItemListingText(item);
      listingImage.loading = "lazy";
      listingMedia.append(listingImage);
    } else {
      const listingPlaceholder = document.createElement("div");
      listingPlaceholder.className = "database-order-item-listing-image database-order-item-listing-image-placeholder";
      listingPlaceholder.setAttribute("aria-hidden", "true");
      listingPlaceholder.textContent = "No image";
      listingMedia.append(listingPlaceholder);
    }

    const status = document.createElement("p");
    status.className = "database-order-item-status";
    status.textContent = isDatabaseOrderItemSkipped(item)
      ? "Skipped"
      : item?.isInActiveBatch ? "Already in active batch" : "Not in active batch";

    const savedDesign = document.createElement("p");
    savedDesign.className = "database-order-item-saved-design";
    savedDesign.textContent = savedBuild ? "Saved design available" : "No saved design available";

    const preview = document.createElement("div");
    preview.className = "database-order-item-preview";
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", savedBuild
      ? "Order item preview: export-ready design available"
      : "Order item preview: design needs completion");

    const previewGraphic = createDatabaseOrderItemPreviewGraphic(savedBuild);
    if (previewGraphic) {
      preview.classList.add("has-preview");
      preview.append(previewGraphic);
    } else {
      const previewLabel = document.createElement("span");
      previewLabel.className = "database-order-item-preview-label";
      previewLabel.textContent = "Preview";

      const previewStatus = document.createElement("span");
      previewStatus.className = "database-order-item-preview-status";
      previewStatus.textContent = savedBuild ? "Export-ready design available" : "Design needs completion";

      preview.append(previewLabel, previewStatus);
    }

    const cardBody = document.createElement("div");
    cardBody.className = "database-order-item-body";

    const listingColumn = document.createElement("div");
    listingColumn.className = "database-order-item-listing-column";
    listingColumn.append(listingMedia);

    const previewColumn = document.createElement("div");
    previewColumn.className = "database-order-item-preview-column";
    previewColumn.append(preview);

    const meta = document.createElement("dl");
    meta.className = "database-order-item-meta";

    const personalizationTerm = document.createElement("dt");
    personalizationTerm.textContent = "Personalization";
    const personalizationValue = document.createElement("dd");
    personalizationValue.textContent = getDatabaseOrderItemDesignText(item);

    const colorTerm = document.createElement("dt");
    colorTerm.textContent = "Color";
    const colorValue = document.createElement("dd");
    colorValue.textContent = getDatabaseOrderItemColorText(item);

    const quantityTerm = document.createElement("dt");
    quantityTerm.textContent = "Quantity";
    const quantityValue = document.createElement("dd");
    quantityValue.textContent = getDatabaseOrderItemQuantityText(item);

    meta.append(personalizationTerm, personalizationValue, colorTerm, colorValue, quantityTerm, quantityValue);

    cardBody.append(listingColumn, previewColumn);
    card.append(cardHeader, cardBody, status, savedDesign, meta);
    databaseOrderItemsShell.append(card);
  });
}

async function addDatabaseOrderItemToBatch(item, button = null) {
  const orderItemId = typeof item?.id === "string" ? item.id.trim() : "";
  const batchId = requireActiveProductionBatchId();
  if (!batchId || !orderItemId || !isDatabaseOrderItemBatchEligible(item)) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Adding...";
  }
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await addOrderItemToProductionBatch({
      batchId,
      orderItemId,
      accessToken,
    });

    await refreshOrdersAndProductionBatch({ payload, accessToken, refreshBatch: true });
    updateWorkflowAlert(buildAddedToBatchMessage(payload), "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      "Unable to add the order item to the production batch.",
      "Production batch session expired. Sign in again to continue adding orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    if (button) {
      button.disabled = !isDatabaseOrderItemBatchEligible(item);
      button.textContent = "Add to Production Batch";
    }
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function updateDatabaseOrderItemStatus({
  item,
  action,
  nextFilter,
  pendingLabel,
  successMessage,
  fallbackMessage,
  button = null,
}) {
  const orderItemId = typeof item?.id === "string" ? item.id.trim() : "";
  if (!orderItemId) {
    return;
  }

  const batchId = getActiveProductionBatchId();
  if (button) {
    button.disabled = true;
    button.textContent = pendingLabel;
  }
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await updateOrderItemLifecycleStatus({
      action,
      batchId,
      orderItemId,
      accessToken,
    });

    if (nextFilter) {
      databaseOrdersStatusFilterValue = nextFilter;
      if (databaseOrdersStatusFilter) {
        databaseOrdersStatusFilter.value = nextFilter;
      }
    }
    checkedDatabaseOrderIds.clear();
    await refreshOrdersAndProductionBatch({
      payload: nextFilter ? payload : null,
      accessToken,
      refreshBatch: action === "skipOrderItem",
    });
    updateWorkflowAlert(successMessage, "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      fallbackMessage,
      "Production batch session expired. Sign in again to continue updating orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function skipDatabaseOrderItem(item, button = null) {
  if (isDatabaseOrderItemSkipped(item) || isDatabaseOrderItemComplete(item)) {
    return;
  }

  const confirmed = await showConfirmationDialog({
    title: "Skip Order Item?",
    description: item?.isInActiveBatch
      ? "This order item is in the active production batch. Remove it from the batch and skip this order item?"
      : "Skip this order item? It will not be added to a production batch.",
    confirmLabel: "Skip Order Item",
    cancelLabel: "Keep Open",
  });
  if (!confirmed) {
    return;
  }

  await updateDatabaseOrderItemStatus({
    item,
    action: "skipOrderItem",
    nextFilter: null,
    pendingLabel: "Skipping...",
    successMessage: "Order skipped.",
    fallbackMessage: "Unable to skip the order.",
    button,
  });
}

async function reopenDatabaseOrderItem(item, button = null) {
  if (!isDatabaseOrderItemSkipped(item)) {
    return;
  }

  await updateDatabaseOrderItemStatus({
    item,
    action: "reopenOrderItem",
    nextFilter: "open",
    pendingLabel: "Reopening...",
    successMessage: "Order reopened.",
    fallbackMessage: "Unable to reopen the order.",
    button,
  });
}

async function updateDatabaseOrderStatus({
  order,
  action,
  nextFilter,
  pendingLabel,
  successMessage,
  fallbackMessage,
  button = null,
}) {
  const orderId = typeof order?.id === "string" ? order.id.trim() : "";
  if (!orderId) {
    return;
  }

  const batchId = getActiveProductionBatchId();
  if (button) {
    button.disabled = true;
    setBatchActionLabel(button, pendingLabel);
  }
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await updateOrderItemLifecycleStatus({
      action,
      batchId,
      orderId,
      accessToken,
    });

    if (nextFilter) {
      databaseOrdersStatusFilterValue = nextFilter;
      if (databaseOrdersStatusFilter) {
        databaseOrdersStatusFilter.value = nextFilter;
      }
    }
    checkedDatabaseOrderIds.clear();
    await refreshOrdersAndProductionBatch({
      payload: nextFilter ? payload : null,
      accessToken,
      refreshBatch: action === "skipOrder",
    });
    updateWorkflowAlert(successMessage, "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      fallbackMessage,
      "Production batch session expired. Sign in again to continue updating orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    if (button) {
      setBatchActionLabel(button, action === "skipOrder" ? "Skip Order" : "Reopen Order");
    }
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function skipSelectedDatabaseOrder() {
  const selectedOrder = getSelectedGroupedOrder(getVisibleDatabaseOrders(), selectedDatabaseOrderId);
  if (!canSkipDatabaseOrder(selectedOrder)) {
    return;
  }

  const confirmed = await showConfirmationDialog({
    title: "Skip Order?",
    description: hasDatabaseOrderItemsInActiveBatch(selectedOrder)
      ? "Some order items are in the active production batch. Remove those order items from the batch and skip the entire order?"
      : "Skip this order? All order items will be skipped and will not be added to a production batch.",
    confirmLabel: "Skip Order",
    cancelLabel: "Keep Open",
  });
  if (!confirmed) {
    return;
  }

  await updateDatabaseOrderStatus({
    order: selectedOrder,
    action: "skipOrder",
    nextFilter: null,
    pendingLabel: "Skipping...",
    successMessage: "Order skipped.",
    fallbackMessage: "Unable to skip the order.",
    button: skipSelectedOrderButton,
  });
}

async function reopenSelectedDatabaseOrder() {
  const selectedOrder = getSelectedGroupedOrder(getVisibleDatabaseOrders(), selectedDatabaseOrderId);
  if (!canReopenDatabaseOrder(selectedOrder)) {
    return;
  }

  await updateDatabaseOrderStatus({
    order: selectedOrder,
    action: "reopenOrder",
    nextFilter: "open",
    pendingLabel: "Reopening...",
    successMessage: "Order reopened.",
    fallbackMessage: "Unable to reopen the order.",
    button: reopenSelectedOrderButton,
  });
}

async function updateCheckedDatabaseOrdersStatus({
  action,
  nextFilter,
  pendingLabel,
  successMessage,
  fallbackMessage,
  button,
  filterOrder,
}) {
  const selectedOrders = getVisibleCheckedDatabaseOrders().filter(filterOrder);
  const orderIds = selectedOrders.map((order) => order.id);
  if (!orderIds.length) {
    updateWorkflowAlert("Select one or more matching orders first.", "error");
    return;
  }

  const batchId = getActiveProductionBatchId();
  if (button) {
    button.disabled = true;
    setBatchActionLabel(button, pendingLabel);
  }
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await updateOrderItemLifecycleStatus({
      action,
      batchId,
      orderIds,
      accessToken,
    });

    if (nextFilter) {
      databaseOrdersStatusFilterValue = nextFilter;
      if (databaseOrdersStatusFilter) {
        databaseOrdersStatusFilter.value = nextFilter;
      }
    }
    checkedDatabaseOrderIds.clear();
    await refreshOrdersAndProductionBatch({
      payload: nextFilter ? payload : null,
      accessToken,
      refreshBatch: action === "skipOrders",
    });
    updateWorkflowAlert(successMessage, "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      fallbackMessage,
      "Production batch session expired. Sign in again to continue updating orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    if (button) {
      setBatchActionLabel(button, action === "skipOrders" ? "Skip Orders" : "Reopen Orders");
    }
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function skipCheckedDatabaseOrders() {
  const selectedOrders = getVisibleCheckedDatabaseOrders().filter(canSkipDatabaseOrder);
  if (!selectedOrders.length) {
    updateWorkflowAlert("Select one or more open orders before skipping them.", "error");
    return;
  }

  const confirmed = await showConfirmationDialog({
    title: "Skip Orders?",
    description: selectedOrders.some(hasDatabaseOrderItemsInActiveBatch)
      ? "Some selected order items are in the active production batch. Remove those order items from the batch and skip the selected orders?"
      : "Skip the selected orders? Their order items will not be added to a production batch.",
    confirmLabel: "Skip Orders",
    cancelLabel: "Keep Open",
  });
  if (!confirmed) {
    return;
  }

  await updateCheckedDatabaseOrdersStatus({
    action: "skipOrders",
    nextFilter: null,
    pendingLabel: "Skipping...",
    successMessage: "Orders skipped.",
    fallbackMessage: "Unable to skip the selected orders.",
    button: skipCheckedOrdersButton,
    filterOrder: canSkipDatabaseOrder,
  });
}

async function reopenCheckedDatabaseOrders() {
  const selectedOrders = getVisibleCheckedDatabaseOrders().filter(canReopenDatabaseOrder);
  if (!selectedOrders.length) {
    updateWorkflowAlert("Select one or more skipped orders before reopening them.", "error");
    return;
  }

  await updateCheckedDatabaseOrdersStatus({
    action: "reopenOrders",
    nextFilter: "open",
    pendingLabel: "Reopening...",
    successMessage: "Orders reopened.",
    fallbackMessage: "Unable to reopen the selected orders.",
    button: reopenCheckedOrdersButton,
    filterOrder: canReopenDatabaseOrder,
  });
}

async function addCheckedDatabaseOrdersToBatch() {
  const batchId = requireActiveProductionBatchId();
  if (!batchId) {
    return;
  }

  const checkedOrderIds = new Set(getCheckedOrderIdsForBulkAction(checkedDatabaseOrderIds));
  const batchEligibleOrderIds = new Set(
    getVisibleDatabaseOrders()
      .filter(isDatabaseOrderBatchEligible)
      .map((order) => order.id),
  );
  const orderIds = getVisibleDatabaseOrders()
    .map((order) => order.id)
    .filter((orderId) => checkedOrderIds.has(orderId) && batchEligibleOrderIds.has(orderId));
  if (!orderIds.length) {
    updateWorkflowAlert("Select one or more orders before adding them to the production batch.", "error");
    return;
  }

  addCheckedOrdersToBatchButton.disabled = true;
  setBatchActionLabel(addCheckedOrdersToBatchButton, "Adding...");
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await addOrdersToProductionBatch({
      batchId,
      orderIds,
      accessToken,
    });
    const nextCheckedOrderIds = new Set(
      [...checkedDatabaseOrderIds].filter((orderId) => !orderIds.includes(orderId)),
    );

    updateDatabaseOrdersFromPayload(payload, { checkedOrderIds: nextCheckedOrderIds });
    await refreshOrdersAndProductionBatch({ payload, accessToken, refreshBatch: true });
    checkedDatabaseOrderIds = nextCheckedOrderIds;
    renderDatabaseOrdersWorkspace();
    updateWorkflowAlert(buildAddedToBatchMessage(payload), "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      "Unable to add checked orders to the production batch.",
      "Production batch session expired. Sign in again to continue adding orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    setBatchActionLabel(addCheckedOrdersToBatchButton, "Add Checked to Production Batch");
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function addSelectedDatabaseOrderToBatch() {
  const selectedOrder = getSelectedGroupedOrder(getVisibleDatabaseOrders(), selectedDatabaseOrderId);
  const orderId = typeof selectedOrder?.id === "string" ? selectedOrder.id.trim() : "";
  const batchId = requireActiveProductionBatchId();
  if (!batchId || !orderId || !isDatabaseOrderBatchEligible(selectedOrder)) {
    return;
  }

  if (addSelectedOrderToBatchButton) {
    addSelectedOrderToBatchButton.disabled = true;
    setBatchActionLabel(addSelectedOrderToBatchButton, "Adding...");
  }
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await addOrdersToProductionBatch({
      batchId,
      orderIds: [orderId],
      accessToken,
    });

    await refreshOrdersAndProductionBatch({ payload, accessToken, refreshBatch: true });
    selectedOrderActionsMenu?.removeAttribute("open");
    updateWorkflowAlert(buildAddedToBatchMessage(payload), "success");
  } catch (error) {
    handleOrdersMutationError(
      error,
      "Unable to add the selected order to the production batch.",
      "Production batch session expired. Sign in again to continue adding orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    if (addSelectedOrderToBatchButton) {
      setBatchActionLabel(addSelectedOrderToBatchButton, "Add to Production Batch");
    }
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function copyDatabaseOrderItemDesign(item, button = null) {
  const savedBuild = getCopyableSavedBuild(item);
  if (!savedBuild) {
    updateWorkflowAlert("Complete and save this design before copying.", "error");
    return;
  }

  if (!canCopySvgToClipboard()) {
    updateWorkflowAlert("Clipboard copy is not available in this browser context.", "error");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Copying...";
  }

  try {
    const svgSource = await requestSvgSource({
      layout: buildExportPayload(savedBuild.layout, savedBuild.analysis, item?.source),
    });
    await copySvgToClipboard(svgSource);
    updateWorkflowAlert("Copied design SVG to the clipboard.", "success");
  } catch (error) {
    updateWorkflowAlert(
      error instanceof Error ? error.message : "Unable to copy the design SVG.",
      "error",
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Copy Design";
    }
  }
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
    batch: captureElementScrollState(orderList),
  };
}

function restoreSelectionScrollState(state) {
  if (!state) {
    return;
  }

  restoreElementScrollState(orderList, state.batch);
  window.scrollTo(state.pageLeft, state.pageTop);
}

function updateZoom(nextZoom, anchor = null) {
  const previousZoom = zoom;
  zoom = clamp(nextZoom, 0.4, 14);

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

function getPreviewPinchPoints() {
  return Array.from(previewTouchPointers.entries())
    .sort(([leftId], [rightId]) => leftId - rightId)
    .slice(0, 2)
    .map(([, point]) => point);
}

function measurePreviewPinch(points) {
  const [first, second] = points;
  const deltaX = second.clientX - first.clientX;
  const deltaY = second.clientY - first.clientY;
  const distance = Math.hypot(deltaX, deltaY);
  const panelRect = previewPanel.getBoundingClientRect();

  return {
    distance,
    anchor: {
      x: ((first.clientX + second.clientX) / 2) - panelRect.left,
      y: ((first.clientY + second.clientY) / 2) - panelRect.top,
    },
  };
}

function updatePreviewPinchState() {
  const points = getPreviewPinchPoints();
  if (points.length < 2) {
    previewPinchState = null;
    return;
  }

  const nextPinch = measurePreviewPinch(points);
  if (nextPinch.distance <= 0) {
    previewPinchState = null;
    return;
  }

  if (previewPinchState) {
    updateZoom(zoom * (nextPinch.distance / previewPinchState.distance), nextPinch.anchor);
  }

  previewPinchState = nextPinch;
}

function startPreviewTouchPan(event) {
  previewTouchPan = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function updatePreviewTouchPan(event) {
  if (!previewTouchPan || previewTouchPan.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - previewTouchPan.clientX;
  const deltaY = event.clientY - previewTouchPan.clientY;
  previewPanel.scrollLeft -= deltaX;
  previewPanel.scrollTop -= deltaY;
  previewTouchPan.clientX = event.clientX;
  previewTouchPan.clientY = event.clientY;
}

function handlePreviewPointerDown(event) {
  if (event.pointerType !== "touch") {
    return;
  }

  event.preventDefault();
  previewTouchPointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (typeof previewPanel.setPointerCapture === "function") {
    previewPanel.setPointerCapture(event.pointerId);
  }
  if (previewTouchPointers.size === 1) {
    startPreviewTouchPan(event);
  } else {
    previewTouchPan = null;
  }
  updatePreviewPinchState();
}

function handlePreviewPointerMove(event) {
  if (event.pointerType !== "touch" || !previewTouchPointers.has(event.pointerId)) {
    return;
  }

  event.preventDefault();
  const previousPoint = previewTouchPointers.get(event.pointerId);
  previewTouchPointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (!previewTouchPan && previewTouchPointers.size === 1 && previousPoint) {
    previewTouchPan = {
      pointerId: event.pointerId,
      clientX: previousPoint.clientX,
      clientY: previousPoint.clientY,
    };
  }
  updatePreviewTouchPan(event);
  updatePreviewPinchState();
}

function endPreviewPointerGesture(event) {
  if (event.pointerType !== "touch") {
    return;
  }

  previewTouchPointers.delete(event.pointerId);
  if (
    typeof previewPanel.hasPointerCapture === "function"
    && typeof previewPanel.releasePointerCapture === "function"
    && previewPanel.hasPointerCapture(event.pointerId)
  ) {
    previewPanel.releasePointerCapture(event.pointerId);
  }
  if (previewTouchPan?.pointerId === event.pointerId) {
    previewTouchPan = null;
  }
  updatePreviewPinchState();
}

function renderPreviewGuideOnly() {
  const guide = resolveBoundingSizePreset(boundingSizePresetInput?.value || DEFAULT_BOUNDING_SIZE_PRESET_ID);
  const previewWidthMm = guide.maxWidthMm + PREVIEW_MARGIN_MM * 2 + PREVIEW_LABEL_RIGHT_MM;
  const previewHeightMm = guide.maxHeightMm + PREVIEW_MARGIN_MM * 2;
  const previewBoxX = (previewWidthMm - PREVIEW_LABEL_RIGHT_MM - guide.maxWidthMm) / 2;
  const previewBoxY = (previewHeightMm - guide.maxHeightMm) / 2;

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${previewWidthMm} ${previewHeightMm}`);
  lastLayout = {
    previewWidthMm,
    previewHeightMm,
    previewBoxX,
    previewBoxY,
    guide,
  };
  updateZoom(zoom);
  appendPreviewGuide(previewBoxX, previewBoxY, guide);
  updateConnectionStatus("pending", "Connectedness pending", "Enter text to analyze whether the face layer cuts as one acrylic piece.");
}

function appendPreviewGuide(previewBoxX, previewBoxY, guide = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID)) {
  const guideCenterX = previewBoxX + guide.maxWidthMm / 2;
  const guideCenterY = previewBoxY + guide.maxHeightMm / 2;
  const minBoxX = guideCenterX - guide.minWidthMm / 2;
  const minBoxY = guideCenterY - guide.minHeightMm / 2;
  const topLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: guideCenterX,
    y: previewBoxY - 2.6,
    "text-anchor": "middle",
  });
  topLabel.textContent = `${guide.maxWidthIn}"`;

  const sideLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: previewBoxX + guide.maxWidthMm + 4.5,
    y: previewBoxY + guide.maxHeightMm / 2,
    "text-anchor": "middle",
    transform: `rotate(90 ${previewBoxX + guide.maxWidthMm + 4.5} ${previewBoxY + guide.maxHeightMm / 2})`,
  });
  sideLabel.textContent = `${guide.maxHeightIn}"`;

  const guideElements = [
    makeSvgElement("rect", {
      class: "preview-guide-box",
      x: previewBoxX,
      y: previewBoxY,
      width: guide.maxWidthMm,
      height: guide.maxHeightMm,
    }),
    makeSvgElement("rect", {
      class: "preview-guide-min-box",
      x: minBoxX,
      y: minBoxY,
      width: guide.minWidthMm,
      height: guide.minHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: minBoxX,
      y1: previewBoxY,
      x2: minBoxX,
      y2: previewBoxY + guide.maxHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: minBoxX + guide.minWidthMm,
      y1: previewBoxY,
      x2: minBoxX + guide.minWidthMm,
      y2: previewBoxY + guide.maxHeightMm,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: minBoxY,
      x2: previewBoxX + guide.maxWidthMm,
      y2: minBoxY,
    }),
    makeSvgElement("line", {
      class: "preview-guide-inner-line",
      x1: previewBoxX,
      y1: minBoxY + guide.minHeightMm,
      x2: previewBoxX + guide.maxWidthMm,
      y2: minBoxY + guide.minHeightMm,
    }),
  ];

  if (Number.isFinite(guide.circleDiameterMm) && guide.circleDiameterMm > 0) {
    guideElements.push(makeSvgElement("circle", {
      class: "preview-guide-box",
      cx: guideCenterX,
      cy: guideCenterY,
      r: guide.circleDiameterMm / 2,
    }));
  }

  preview.append(
    ...guideElements,
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
  } else if (analysisSummary.state === "error") {
    const icon = document.createElement("span");
    icon.className = "order-analysis-icon";
    icon.textContent = "!";
    container.append(icon);
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
  const textLines = lines
    .map((line) => normalizeLineSettings(line))
    .filter((line) => !isFixedSvgLineSettings(line));
  if (!textLines.length) {
    return {
      value: DEFAULT_LINE_SETTINGS.horizontalScale,
      mixed: false,
    };
  }

  const values = textLines.map((line) => line.horizontalScale);
  const first = values[0];

  return {
    value: first,
    mixed: values.some((value) => Math.abs(value - first) > 1e-6),
  };
}

function summarizeVerticalScale(lines = []) {
  const textLines = lines
    .map((line) => normalizeLineSettings(line))
    .filter((line) => !isFixedSvgLineSettings(line));
  if (!textLines.length) {
    return {
      value: DEFAULT_LINE_SETTINGS.verticalScale,
      mixed: false,
    };
  }

  const values = textLines.map((line) => line.verticalScale);
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

function setBatchActionLabel(button, label) {
  const labelNode = batchActionLabelByButton.get(button);
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
  lineControlCards.replaceChildren();

  if (!normalized.lines.length) {
    const empty = document.createElement("p");
    empty.className = "line-control-empty";
    empty.textContent = "Add text lines to generate one font and slider group per line.";
    lineControlCards.append(empty);
    return;
  }

  const rawLines = getRawTextLines(normalized.text);
  let textLineIndex = 0;

  normalized.lines.forEach((line, settingsIndex) => {
    const card = document.createElement("section");
    card.className = "line-control-card";
    card.dataset.settingsIndex = String(settingsIndex);

    const header = document.createElement("div");
    header.className = "line-control-header";

    const title = document.createElement("h3");
    title.className = "line-control-title";

    const summary = document.createElement("span");
    summary.className = "line-control-text";

    header.append(title, summary);
    card.append(header);

    const grid = document.createElement("div");
    grid.className = "line-control-grid";

    if (isFixedSvgLineSettings(line)) {
      const fixedDesign = resolveFixedDesignReference(line, fixedDesignRecords);
      card.dataset.lineKind = "fixedSvg";
      title.textContent = `Fixed Design: ${fixedDesign.displayName}`;
      summary.textContent = `v${fixedDesign.version || 1}`;
      header.append(createFixedDesignLineMenu(settingsIndex));
      grid.append(
        createFixedDesignRangeField(settingsIndex, "svgSizeMm", "Vertical Size", 5, 80, 0.5, line.svgSizeMm),
        createFixedDesignRangeField(settingsIndex, "offsetXMm", "Horizontal Offset", -30, 30, 0.1, line.offsetXMm),
        createFixedDesignRangeField(settingsIndex, "offsetYMm", "Vertical Offset From Center", -30, 30, 0.1, line.offsetYMm),
      );
      card.append(grid);
      lineControlCards.append(card);
      return;
    }

    const lineText = rawLines[textLineIndex] ?? "";
    card.dataset.lineKind = "text";
    card.dataset.lineIndex = String(textLineIndex);
    title.textContent = `Line ${textLineIndex + 1}`;
    summary.textContent = lineText.trim() || "Blank line";

    const fields = [
      createFontField(textLineIndex, line.fontId),
      createRangeField(textLineIndex, "bridgeMm", "Letter Bridge", 0, 4, 0.1, line.bridgeMm),
      createRangeField(textLineIndex, "offsetXMm", "Horizontal Offset", -20, 20, 0.1, line.offsetXMm),
      createRangeField(textLineIndex, "fontSizeMm", "Text Height", 18, 55, 1, line.fontSizeMm),
      createRangeField(textLineIndex, "horizontalScale", "Horizontal Stretch", 0.75, 2, 0.01, line.horizontalScale),
      createRangeField(textLineIndex, "verticalScale", "Vertical Stretch", 0.75, 1.5, 0.01, line.verticalScale),
      createCheckboxField(textLineIndex, "lockTextHeight", "Lock Text Height", line.lockTextHeight),
    ];

    if (textLineIndex > 0) {
      fields.splice(2, 0, createRangeField(textLineIndex, "lineBridgeMm", "Line Bridge", 0, 8, 0.1, line.lineBridgeMm));
    }

    grid.append(...fields);

    card.append(grid);
    lineControlCards.append(card);
    textLineIndex += 1;
  });
}

function readTextLineSettingsFromControls({ presetId, textLineIndex, listingId, fallbackLineSettings }) {
  const lineCard = lineControlCards.querySelector(`[data-line-index="${textLineIndex}"]`);
  if (!lineCard) {
    return normalizeLineSettings(fallbackLineSettings || createPresetLineSettings(presetId, textLineIndex, { listingId }));
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
    kind: "text",
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

function readFixedDesignLineSettingsFromControls({ settingsIndex, fallbackLineSettings }) {
  const fallback = normalizeLineSettings(fallbackLineSettings);
  const lineCard = lineControlCards.querySelector(`[data-line-kind="fixedSvg"][data-settings-index="${settingsIndex}"]`);
  if (!lineCard) {
    return fallback;
  }

  const svgSizeInput = lineCard.querySelector('[data-setting="svgSizeMm"]');
  const offsetXInput = lineCard.querySelector('[data-setting="offsetXMm"]');
  const offsetYInput = lineCard.querySelector('[data-setting="offsetYMm"]');

  return normalizeLineSettings({
    ...fallback,
    svgSizeMm: svgSizeInput instanceof HTMLInputElement ? Number(svgSizeInput.value) : fallback.svgSizeMm,
    offsetXMm: offsetXInput instanceof HTMLInputElement ? Number(offsetXInput.value) : fallback.offsetXMm,
    offsetYMm: offsetYInput instanceof HTMLInputElement ? Number(offsetYInput.value) : fallback.offsetYMm,
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

  getSelectableFontOptions(FONT_OPTIONS, fontId).forEach((font) => {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.label;
    option.selected = font.id === fontId;
    option.disabled = Boolean(font.isDeleted);
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

function createFixedDesignRangeField(settingsIndex, setting, labelText, min, max, step, value) {
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
  input.dataset.settingsIndex = String(settingsIndex);
  input.dataset.setting = setting;

  const output = document.createElement("output");
  output.textContent = lineValueText(setting, value);

  row.append(input, output);
  label.append(span, row);

  return label;
}

function createFixedDesignLineMenu(settingsIndex) {
  const menu = document.createElement("details");
  menu.className = "line-control-menu fixed-design-line-menu";

  const summary = document.createElement("summary");
  summary.className = "batch-tools-toggle fixed-design-line-toggle";
  summary.setAttribute("aria-label", "Fixed design actions");

  const popover = document.createElement("div");
  popover.className = "line-control-menu-popover";

  const button = document.createElement("button");
  button.className = "batch-tool-button";
  button.type = "button";
  button.dataset.lineAction = "removeFixedDesign";
  button.dataset.settingsIndex = String(settingsIndex);

  const label = document.createElement("span");
  label.className = "batch-tool-label";
  label.textContent = "Remove Fixed Design";
  button.append(label);

  popover.append(button);
  menu.append(summary, popover);
  return menu;
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
  const activeSettings = activeOrder?.settings && typeof activeOrder.settings === "object" ? activeOrder.settings : {};
  const normalizedActiveSettings = normalizeSettings({
    ...activeSettings,
    text: textInput.value,
    presetId,
  });
  const lines = [];
  let textLineIndex = 0;

  normalizedActiveSettings.lines.forEach((line, settingsIndex) => {
    if (isFixedSvgLineSettings(line)) {
      lines.push(readFixedDesignLineSettingsFromControls({
        settingsIndex,
        fallbackLineSettings: line,
      }));
      return;
    }

    if (textLineIndex < rawLines.length) {
      lines.push(readTextLineSettingsFromControls({
        presetId,
        textLineIndex,
        listingId,
        fallbackLineSettings: line,
      }));
      textLineIndex += 1;
    }
  });

  while (textLineIndex < rawLines.length) {
    lines.push(readTextLineSettingsFromControls({
      presetId,
      textLineIndex,
      listingId,
      fallbackLineSettings: createPresetLineSettings(presetId, textLineIndex, { listingId }),
    }));
    textLineIndex += 1;
  }

  return normalizeSettings({
    text: textInput.value,
    presetId,
    boundingSizePresetId: boundingSizePresetInput?.value || DEFAULT_BOUNDING_SIZE_PRESET_ID,
    backingMm: Number(backingInput.value),
    weldExportedDesign: weldExportedDesignInput.checked,
    lines,
  });
}

function applySettings(settings) {
  const normalized = normalizeSettings(settings);
  textInput.value = normalized.text;
  presetInput.value = normalized.presetId;
  if (boundingSizePresetInput) {
    boundingSizePresetInput.value = normalized.boundingSizePresetId;
  }
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
    fixedDesignText: getPresetFixedDesignText(presetId, activeOrder?.source?.listingId ?? null),
    normalizeSettings,
    getPresetBaseSettings,
    buildPresetLines,
    getPresetFixedItems,
    createDefaultLineSettings,
    getRawTextLines,
  });

  applySettings(nextSettings);
  render();
  void ensureFixedDesignRecordsForSettings(nextSettings).then((loaded) => {
    if (loaded) {
      renderLineControls(getCurrentSettings());
      render();
    }
  });
  updateActiveOrderFromControls();
}

function getActiveOrder() {
  return orders.find((order) => order.id === activeOrderItemId) || null;
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
  order.saveErrorMessage = null;
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
  schedulePersistBatchState();
}

function restoreOrderFromPublishedSnapshot(order) {
  const snapshot = normalizeStoredPublishedSnapshot(order?.publishedSnapshot);
  if (!order || !snapshot) {
    return false;
  }

  order.revision = snapshot.revision;
  order.updatedAt = snapshot.updatedAt;
  order.updatedBy = snapshot.updatedBy ? structuredClone(snapshot.updatedBy) : null;
  order.text = snapshot.text;
  order.status = snapshot.status;
  order.settings = normalizeSettings(snapshot.settings);
  order.source = snapshot.source ? { ...snapshot.source } : null;
  order.cachedBuild = snapshot.cachedBuild ? structuredClone(snapshot.cachedBuild) : null;
  order.previousCompletedBuild = snapshot.previousCompletedBuild ? structuredClone(snapshot.previousCompletedBuild) : null;
  order.savedSettingsSignature = snapshot.savedSettingsSignature;
  order.completedSettingsSignature = snapshot.completedSettingsSignature;
  order.analysisBadge = snapshot.analysisBadge ? structuredClone(snapshot.analysisBadge) : null;
  order.saveErrorMessage = null;
  order.analysisState = "idle";
  order.pendingAnalysisSignature = null;
  order.pendingAnalysisRequestId = null;
  order.capturedLayout = null;

  const savedBuild = getSavedCachedBuild(order);
  if (savedBuild) {
    order.capturedLayout = {
      ...cloneSerializableData(savedBuild.layout),
      analysis: cloneSerializableData(savedBuild.analysis),
    };
  }

  return true;
}

function cancelActiveOrderChanges() {
  const order = getActiveOrder();
  if (!restoreOrderFromPublishedSnapshot(order)) {
    return;
  }

  applySettings(order.settings);
  suppressBatchSyncLocalNotice = true;
  persistBatchState({ skipRemoteSave: true });
  suppressBatchSyncLocalNotice = false;
  renderOrderList();
  scheduleDeferredPreviewRender();
  updateWorkflowAlert("Reverted to the last saved design.", "success");
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
    label: buildBatchOrderNumber(order),
    settings: order.settings,
  });
  updateWorkflowAlert(`Copied layout controls from ${buildBatchOrderNumber(order)}.`, "success");
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
    targetLabel: buildBatchOrderNumber(order),
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

  const previousSignature = buildSettingsSignature(order.settings);
  order.text = textInput.value;
  order.settings = getCurrentSettings();
  const currentSignature = buildSettingsSignature(order.settings);
  if (currentSignature !== previousSignature) {
    order.saveErrorMessage = null;
  }
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
  schedulePersistBatchState();
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
    && !order.saveErrorMessage
    && typeof order.completedSettingsSignature === "string"
    && settingsSignatureMatches(settings, order.completedSettingsSignature),
  );
}

function canCompleteActiveOrder(order) {
  if (!orderHasRenderableDesign(order)) {
    return false;
  }

  return !hasCompletedEditingState(order);
}

function hasUnsavedRenderChanges(order) {
  if (!orderHasRenderableDesign(order)) {
    return false;
  }

  return !settingsSignatureMatches(getCurrentSettings(), getTrackedSettingsSignature(order));
}

function hasUnsavedPublishedSnapshotChanges(order) {
  if (!order?.publishedSnapshot) {
    return false;
  }

  return buildSettingsSignature(order.settings)
    !== buildSettingsSignature(order.publishedSnapshot.settings);
}

function canCancelActiveOrder(order) {
  return Boolean(order?.publishedSnapshot && hasUnsavedPublishedSnapshotChanges(order));
}

function hasSavedCompletedState(order) {
  return Boolean(
    order
    && typeof order.savedSettingsSignature === "string"
    && (order.status === "captured" || order.status === "exported"),
  );
}

function getSavedCachedBuild(order) {
  if (!orderHasRenderableDesign(order) || !hasSavedCompletedState(order)) {
    return null;
  }

  return getBuildForSignature(order, order.savedSettingsSignature);
}

function isOrderReadyForExport(order) {
  if (order?.saveErrorMessage) {
    return false;
  }

  if (!getSavedCachedBuild(order)) {
    return false;
  }

  if (order?.id === activeOrderItemId && hasUnsavedRenderChanges(order)) {
    return false;
  }

  return true;
}

function updateCaptureButtonState(activeOrder) {
  setEditorActionLabel(captureButton, "Save");
  setEditorActionLabel(cancelDesignButton, "Cancel");
  setEditorActionLabel(completeNextButton, "Save & Next");

  if (!activeOrder || ordersDatabaseMutationInFlight) {
    captureButton.disabled = true;
    captureButton.removeAttribute("aria-busy");
    cancelDesignButton.disabled = true;
    completeNextButton.disabled = true;
    completeNextButton.removeAttribute("aria-busy");
    return;
  }

  if (activeOrder.analysisState === "running") {
    captureButton.disabled = true;
    captureButton.removeAttribute("aria-busy");
    cancelDesignButton.disabled = true;
    completeNextButton.disabled = true;
    completeNextButton.removeAttribute("aria-busy");
    return;
  }

  captureButton.removeAttribute("aria-busy");
  completeNextButton.removeAttribute("aria-busy");
  const canComplete = canCompleteActiveOrder(activeOrder);
  const hasNextIncompleteOrder = canComplete && Boolean(getNextIncompleteOrder(activeOrder.id));
  cancelDesignButton.disabled = !canCancelActiveOrder(activeOrder);
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

function getBatchAnalysisSummary(order) {
  if (!order) {
    return null;
  }

  if (order.saveErrorMessage) {
    return {
      state: "error",
      shortLabel: "!",
      fullLabel: `Save failed: ${order.saveErrorMessage}`,
    };
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

function renderPresetListingIndicator(order) {
  const mappedPresetId = getMappedPresetIdForOrder(order);
  const selectedPresetId = presetInput.value;

  presetListingIndicator.classList.toggle("is-hidden", !mappedPresetId);
  presetListingIndicator.classList.remove("preset-listing-indicator-warning");
  if (!mappedPresetId) {
    presetListingIndicator.textContent = "";
    presetListingIndicator.title = "";
    return;
  }

  const listingId = order?.source?.listingId?.trim() || "this listing";
  if (mappedPresetId === selectedPresetId) {
    presetListingIndicator.textContent = "Linked";
    presetListingIndicator.title = `This listing ID is assigned to the selected preset. Listing ID ${listingId}.`;
    return;
  }

  const mappedPresetName = getPresetDefinitionForEditor(mappedPresetId)?.name || "another preset";
  if (order?.source?.manualPresetOverride) {
    presetListingIndicator.textContent = "Preset overriden";
    presetListingIndicator.title = `This design overrides the linked preset ${mappedPresetName}. Listing ID ${listingId}.`;
    presetListingIndicator.classList.add("preset-listing-indicator-warning");
    return;
  }

  presetListingIndicator.textContent = "Assigned elsewhere";
  presetListingIndicator.title = `Listing ID ${listingId} is assigned to ${mappedPresetName}.`;
}

function renderOrderList() {
  const searchTerm = orderSearchInput.value.trim().toLowerCase();
  const visibleOrders = orders.filter((order) => {
    if (!searchTerm) {
      return true;
    }

    return `${buildBatchOrderNumber(order)} ${order.text} ${order.source?.orderNumber || ""} ${order.source?.listingId || ""} ${order.source?.buyerName || ""}`
      .toLowerCase()
      .includes(searchTerm);
  });
  const completeCount = orders.filter((order) => order.status === "captured" || order.status === "exported").length;
  const progressCount = orders.filter((order) => order.status === "in-progress").length;
  const notStartedCount = orders.filter((order) => order.status === "not-started").length;
  const orderItemCount = orders.reduce((total, order) => total + parseColorCountQuantity(order), 0);
  const exportableCount = orders.filter(orderHasRenderableDesign).length;
  const readyToExportCount = orders.filter(isOrderReadyForExport).length;
  const allExportableOrdersReady = exportableCount > 0 && readyToExportCount === exportableCount;

  orderCountOutput.textContent = String(orders.length);
  orderItemCountOutput.textContent = String(orderItemCount);
  completeCountOutput.textContent = String(completeCount);
  progressCountOutput.textContent = String(progressCount);
  if (notStartedCountOutput) {
    notStartedCountOutput.textContent = String(notStartedCount);
  }
  clearBatchButton.disabled = orders.length === 0;
  if (showColorCountsButton) {
    showColorCountsButton.disabled = orders.length === 0;
  }
  exportCompletedButton.disabled = !allExportableOrdersReady;
  copyCompletedButton.disabled = !allExportableOrdersReady || !canCopySvgToClipboard();
  orderList.replaceChildren();

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "Add a design manually or import Etsy clipboard data. Each personalized line item becomes its own batch row.";
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
    row.className = `order-row${order.id === activeOrderItemId ? " active" : ""}`;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "order-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "order-item-header";

    const title = document.createElement("div");
    title.className = "order-item-title";
    title.textContent = buildBatchOrderNumber(order);

    const analysisSummary = getBatchAnalysisSummary(order);
    const analysisIndicator = document.createElement("span");
    renderAnalysisIndicator(analysisIndicator, analysisSummary);

    const status = document.createElement("span");
    status.className = `order-status ${order.status}`;
    status.textContent = statusLabels[order.status];

    const body = document.createElement("div");
    body.className = "order-item-body";

    const productImage = createBatchProductImage(order);
    const copy = document.createElement("div");
    copy.className = "order-item-copy";

    const recipientText = document.createElement("div");
    recipientText.className = "order-item-recipient";
    recipientText.textContent = `Buyer: ${buildBatchRecipient(order)}`;
    recipientText.title = buildBatchRecipient(order);

    const personalizationText = document.createElement("div");
    personalizationText.className = "order-item-personalization";
    personalizationText.textContent = `Personalization: ${buildBatchPersonalization(order)}`;
    personalizationText.title = buildBatchPersonalization(order);

    header.append(title, analysisIndicator, status);
    copy.append(recipientText, personalizationText);
    body.append(productImage, copy);
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
    deleteButton.setAttribute("aria-label", `Delete ${buildBatchOrderNumber(order)}`);
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
  renderPresetListingIndicator(activeOrder);
  activeOrderName.textContent = activeOrder ? buildBatchOrderNumber(activeOrder) : "No design selected";
  activeOrderMeta.textContent = buildActiveMeta(activeOrder);
  renderProductionBatchToast(activeOrder);
  updateCaptureButtonState(activeOrder);
  downloadButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder);
  copyButton.disabled = !activeOrder || !isOrderReadyForExport(activeOrder) || !canCopySvgToClipboard();
  copyLayoutControlsButton.disabled = !canCopyLayoutControls(activeOrder);
  pasteLayoutControlsButton.disabled = !canPasteLayoutControls(activeOrder);
  insertFixedDesignButton.disabled = !activeOrder;
  saveAsNewPresetButton.disabled = !activeOrder;
  overwritePresetButton.disabled = !activeOrder || !getPresetDefinitionForEditor(presetInput.value);
  assignPresetToListingButton.disabled = !activeOrder?.source?.listingId;
  reloadPresetButton.disabled = !activeOrder;
}

function hideInitialBatchLoading() {
  if (!initialBatchLoading) {
    return;
  }

  initialBatchLoading.hidden = true;
}

function getFontMetaLabel(font) {
  const kind = font.isBuiltin ? "Built-in production font" : "Uploaded workspace font";
  const format = font.fileFormat ? font.fileFormat.toUpperCase() : "font";
  const version = font.version ? `v${font.version}` : "v1";
  return `${kind} · ${format} · ${version}`;
}

function getFixedDesignMetaLabel(fixedDesign) {
  if (!fixedDesign) {
    return "Upload or choose a fixed SVG design.";
  }

  return `${fixedDesign.stateLabel || "Available"} - SVG - v${fixedDesign.version || 1}`;
}

function setFixedDesignEditorStatus(message, state = "pending") {
  if (!fixedDesignEditorStatus) {
    return;
  }

  fixedDesignEditorStatus.textContent = message;
  fixedDesignEditorStatus.dataset.state = state;
}

function setFixedDesignVersionStatus(message = "") {
  if (!fixedDesignVersionStatus) {
    return;
  }

  fixedDesignVersionStatus.textContent = message;
}

function clearFixedDesignVersionPreview() {
  if (stagedFixedDesignVersionPreviewUrl) {
    URL.revokeObjectURL(stagedFixedDesignVersionPreviewUrl);
    stagedFixedDesignVersionPreviewUrl = null;
  }
  if (fixedDesignVersionPreviewImage) {
    fixedDesignVersionPreviewImage.removeAttribute("src");
    fixedDesignVersionPreviewImage.alt = "";
  }
  if (fixedDesignVersionPreview) {
    fixedDesignVersionPreview.hidden = true;
  }
}

function showFixedDesignVersionPreview(file) {
  clearFixedDesignVersionPreview();
  if (!file || !fixedDesignVersionPreview || !fixedDesignVersionPreviewImage) {
    return;
  }

  stagedFixedDesignVersionPreviewUrl = URL.createObjectURL(file);
  fixedDesignVersionPreviewImage.src = stagedFixedDesignVersionPreviewUrl;
  fixedDesignVersionPreviewImage.alt = `Preview of ${file.name || "selected SVG"}`;
  fixedDesignVersionPreview.hidden = false;
}

function handleFixedDesignApiError(error, fallbackMessage, options = {}) {
  if (isProductionBatchAuthenticationError(error)) {
    const detail = options.authDetail || "Production batch session expired. Sign in again to manage fixed designs.";
    handleProductionBatchAuthenticationRequired(detail);
    if (options.versionDialog) {
      setFixedDesignVersionStatus(detail);
    } else {
      setFixedDesignEditorStatus(detail, "pending");
    }
    return;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  if (options.versionDialog) {
    setFixedDesignVersionStatus(message);
  } else {
    setFixedDesignEditorStatus(message, "error");
  }
}

function stageFixedDesignVersionFile(file) {
  if (!file) {
    stagedFixedDesignVersionFile = null;
    clearFixedDesignVersionPreview();
    setFixedDesignVersionStatus("");
    if (loadFixedDesignVersionConfirmButton) {
      loadFixedDesignVersionConfirmButton.disabled = true;
    }
    return;
  }

  if (!/\.svg$/i.test(file.name || "")) {
    stagedFixedDesignVersionFile = null;
    clearFixedDesignVersionPreview();
    setFixedDesignVersionStatus("Choose an SVG file to load as the new version.");
    if (loadFixedDesignVersionConfirmButton) {
      loadFixedDesignVersionConfirmButton.disabled = true;
    }
    return;
  }

  stagedFixedDesignVersionFile = file;
  showFixedDesignVersionPreview(file);
  const action = fixedDesignVersionDialogMode === "create" ? "upload" : "load";
  setFixedDesignVersionStatus(`Ready to ${action} ${file.name}.`);
  if (loadFixedDesignVersionConfirmButton) {
    loadFixedDesignVersionConfirmButton.disabled = false;
  }
}

function getSelectedFixedDesign() {
  return fixedDesignRecords.find((record) => record.id === selectedFixedDesignId) || null;
}

function getVisibleFixedDesignRecords() {
  const activeRecords = fixedDesignRecords.filter((record) => !record.isDeleted);
  const query = fixedDesignSearchTerm.trim().toLowerCase();
  if (!query) {
    return activeRecords;
  }

  return activeRecords.filter((record) => (
    record.displayName.toLowerCase().includes(query)
    || String(record.fileName || "").toLowerCase().includes(query)
  ));
}

function getVisibleInsertFixedDesignRecords() {
  const activeRecords = fixedDesignRecords.filter((record) => !record.isDeleted);
  const query = insertFixedDesignSearchTerm.trim().toLowerCase();
  if (!query) {
    return activeRecords;
  }

  return activeRecords.filter((record) => (
    record.displayName.toLowerCase().includes(query)
    || String(record.fileName || "").toLowerCase().includes(query)
  ));
}

function getSelectedInsertFixedDesign() {
  return fixedDesignRecords.find((record) => record.id === insertFixedDesignSelectedId) || null;
}

function setInsertFixedDesignStatus(message = "", state = "pending") {
  insertFixedDesignStatusMessage = message;
  insertFixedDesignStatusState = state;
  if (insertFixedDesignStatus) {
    insertFixedDesignStatus.textContent = message;
    insertFixedDesignStatus.dataset.state = state;
    insertFixedDesignStatus.hidden = !message;
  }
}

function selectFirstInsertFixedDesignIfNeeded() {
  const visibleRecords = getVisibleInsertFixedDesignRecords();
  if (visibleRecords.some((record) => record.id === insertFixedDesignSelectedId)) {
    return;
  }

  insertFixedDesignSelectedId = visibleRecords[0]?.id || null;
}

function selectInsertFixedDesign(fixedDesignId) {
  if (!fixedDesignRecords.some((record) => record.id === fixedDesignId)) {
    return false;
  }

  insertFixedDesignSelectedId = fixedDesignId;
  renderInsertFixedDesignPicker();
  return true;
}

function selectFirstFixedDesignIfNeeded() {
  const activeRecords = fixedDesignRecords.filter((record) => !record.isDeleted);
  if (activeRecords.some((record) => record.id === selectedFixedDesignId)) {
    return;
  }
  if (!fixedDesignsLoaded && selectedFixedDesignId) {
    return;
  }

  selectedFixedDesignId = activeRecords[0]?.id || null;
}

function selectFixedDesign(fixedDesignId, options = {}) {
  const { updateRoute = true, replaceRoute = false } = options;
  if (!fixedDesignRecords.some((record) => record.id === fixedDesignId)) {
    return false;
  }

  selectedFixedDesignId = fixedDesignId;
  renderFixedDesignWorkspace();
  if (updateRoute) {
    writeAppRoute({ replace: replaceRoute, workspace: "fixedDesigns", itemId: selectedFixedDesignId });
  }
  return true;
}

async function refreshWorkspaceFixedDesigns(accessToken = null) {
  if (!accessToken) {
    setFixedDesignEditorStatus("Sign in to load fixed designs.", "pending");
    return;
  }
  if (fixedDesignsLoading) {
    return;
  }

  const loadRequestId = fixedDesignsLoadRequestId + 1;
  fixedDesignsLoadRequestId = loadRequestId;
  fixedDesignsLoading = true;
  setFixedDesignEditorStatus("Loading fixed designs...", "pending");
  try {
    const nextRecords = normalizeFixedDesignRecords(await fetchWorkspaceFixedDesigns({ accessToken, includeDeleted: true }));
    if (loadRequestId !== fixedDesignsLoadRequestId) {
      return;
    }
    fixedDesignRecords = nextRecords;
    fixedDesignsLoaded = true;
    selectFirstFixedDesignIfNeeded();
    renderFixedDesignWorkspace();
    const activeRecordCount = fixedDesignRecords.filter((record) => !record.isDeleted).length;
    setFixedDesignEditorStatus(
      activeRecordCount ? "Choose a fixed SVG design or upload a new one." : "Upload an SVG fixed design to start.",
      "pending",
    );
  } catch (error) {
    if (loadRequestId !== fixedDesignsLoadRequestId) {
      return;
    }
    fixedDesignsLoaded = false;
    renderFixedDesignWorkspace();
    handleFixedDesignApiError(error, "Unable to load fixed designs.");
  } finally {
    if (loadRequestId === fixedDesignsLoadRequestId) {
      fixedDesignsLoading = false;
    }
  }
}

function renderInsertFixedDesignPicker() {
  if (!insertFixedDesignList) {
    return;
  }

  if (insertFixedDesignSearchInput && insertFixedDesignSearchInput.value !== insertFixedDesignSearchTerm) {
    insertFixedDesignSearchInput.value = insertFixedDesignSearchTerm;
  }

  selectFirstInsertFixedDesignIfNeeded();
  const selectedFixedDesign = getSelectedInsertFixedDesign();
  const visibleRecords = getVisibleInsertFixedDesignRecords();

  insertFixedDesignList.replaceChildren();
  if (!fixedDesignsLoaded && fixedDesignsLoading) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note fixed-design-empty-state";
    empty.textContent = "Loading fixed designs...";
    insertFixedDesignList.append(empty);
  } else if (!visibleRecords.length) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note fixed-design-empty-state";
    empty.textContent = insertFixedDesignSearchTerm.trim()
      ? "No fixed designs match that search."
      : "No fixed designs are available yet.";
    insertFixedDesignList.append(empty);
  } else {
    visibleRecords.forEach((fixedDesign) => {
      const row = document.createElement("article");
      row.className = "fixed-design-row size-preset-row insert-fixed-design-row";
      row.classList.toggle("is-selected", fixedDesign.id === selectedFixedDesign?.id);
      row.role = "button";
      row.tabIndex = 0;
      row.dataset.fixedDesignId = fixedDesign.id;
      row.innerHTML = `
        <span class="size-preset-name fixed-design-row-name"></span>
        <span class="size-preset-meta fixed-design-row-meta"></span>
      `;
      row.querySelector(".fixed-design-row-name").textContent = fixedDesign.displayName;
      row.querySelector(".fixed-design-row-meta").textContent = `v${fixedDesign.version || 1} - ${fixedDesign.fileName || "SVG"}`;
      row.addEventListener("click", () => {
        selectInsertFixedDesign(fixedDesign.id);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        selectInsertFixedDesign(fixedDesign.id);
      });
      insertFixedDesignList.append(row);
    });
  }

  insertFixedDesignSelectedName.textContent = selectedFixedDesign?.displayName || "None";
  insertFixedDesignSelectedMeta.textContent = selectedFixedDesign ? `v${selectedFixedDesign.version || 1}` : "None";
  insertFixedDesignSelectedFile.textContent = selectedFixedDesign?.fileName || "None";

  if (selectedFixedDesign?.publicUrl) {
    insertFixedDesignPreviewImage.src = selectedFixedDesign.publicUrl;
    insertFixedDesignPreviewImage.alt = `${selectedFixedDesign.displayName} SVG preview`;
    insertFixedDesignPreviewImage.hidden = false;
    insertFixedDesignPreviewEmptyState.hidden = true;
  } else {
    insertFixedDesignPreviewImage.removeAttribute("src");
    insertFixedDesignPreviewImage.alt = "";
    insertFixedDesignPreviewImage.hidden = true;
    insertFixedDesignPreviewEmptyState.hidden = false;
    insertFixedDesignPreviewEmptyState.textContent = selectedFixedDesign
      ? "This fixed design does not have a preview URL."
      : "Choose a fixed design to preview.";
  }

  if (insertFixedDesignConfirmButton) {
    insertFixedDesignConfirmButton.disabled = !selectedFixedDesign || !getActiveOrder();
  }

  setInsertFixedDesignStatus(insertFixedDesignStatusMessage, insertFixedDesignStatusState);
}

async function loadFixedDesignsForInsertPicker() {
  if (fixedDesignsLoaded) {
    const activeRecordCount = fixedDesignRecords.filter((record) => !record.isDeleted).length;
    setInsertFixedDesignStatus(
      activeRecordCount ? "Choose a fixed design to insert." : "No fixed designs are available yet.",
      "pending",
    );
    renderInsertFixedDesignPicker();
    return;
  }

  const accessToken = productionBatchAccessToken || readProductionBatchAccessTokenOverride() || await getAccessToken();
  if (!accessToken) {
    setInsertFixedDesignStatus("Sign in to load fixed designs.", "error");
    renderInsertFixedDesignPicker();
    return;
  }

  productionBatchAccessToken = accessToken;
  const loadRequestId = fixedDesignsLoadRequestId + 1;
  fixedDesignsLoadRequestId = loadRequestId;
  fixedDesignsLoading = true;
  setInsertFixedDesignStatus("Loading fixed designs...", "pending");
  renderInsertFixedDesignPicker();
  try {
    const nextRecords = normalizeFixedDesignRecords(await fetchWorkspaceFixedDesigns({ accessToken, includeDeleted: true }));
    if (loadRequestId !== fixedDesignsLoadRequestId) {
      return;
    }
    fixedDesignRecords = nextRecords;
    fixedDesignsLoaded = true;
    selectFirstFixedDesignIfNeeded();
    selectFirstInsertFixedDesignIfNeeded();
    renderFixedDesignWorkspace();
    const activeRecordCount = fixedDesignRecords.filter((record) => !record.isDeleted).length;
    setInsertFixedDesignStatus(
      activeRecordCount ? "Choose a fixed design to insert." : "No fixed designs are available yet.",
      "pending",
    );
  } catch (error) {
    if (loadRequestId !== fixedDesignsLoadRequestId) {
      return;
    }
    fixedDesignsLoaded = false;
    const message = error instanceof Error ? error.message : "Unable to load fixed designs.";
    if (isProductionBatchAuthenticationError(error)) {
      handleProductionBatchAuthenticationRequired("Production batch session expired. Sign in again to insert fixed designs.");
    }
    setInsertFixedDesignStatus(message, "error");
  } finally {
    if (loadRequestId === fixedDesignsLoadRequestId) {
      fixedDesignsLoading = false;
      renderInsertFixedDesignPicker();
    }
  }
}

function closeInsertFixedDesignDialog() {
  if (insertFixedDesignDialog?.open) {
    insertFixedDesignDialog.close();
  }
}

function openInsertFixedDesignDialog() {
  const activeFixedDesignRecords = fixedDesignRecords.filter((record) => !record.isDeleted);
  insertFixedDesignSearchTerm = "";
  insertFixedDesignSelectedId = activeFixedDesignRecords.find((record) => record.id === insertFixedDesignSelectedId)?.id
    || activeFixedDesignRecords[0]?.id
    || null;
  setInsertFixedDesignStatus(
    fixedDesignsLoaded
      ? (activeFixedDesignRecords.length ? "Choose a fixed design to insert." : "No fixed designs are available yet.")
      : "Loading fixed designs...",
    "pending",
  );
  presetToolsMenu?.removeAttribute("open");
  renderInsertFixedDesignPicker();
  if (typeof insertFixedDesignDialog?.showModal === "function") {
    insertFixedDesignDialog.showModal();
  }
  insertFixedDesignSearchInput?.focus();
  void loadFixedDesignsForInsertPicker();
}

function insertSelectedFixedDesignIntoActiveOrder() {
  const selectedFixedDesign = getSelectedInsertFixedDesign();
  const activeOrder = getActiveOrder();
  if (!selectedFixedDesign || !activeOrder) {
    return;
  }

  const currentSettings = normalizeSettings(getCurrentSettings());
  const nextSettings = normalizeSettings({
    ...currentSettings,
    lines: [
      ...currentSettings.lines,
      createFixedDesignLineSettings(selectedFixedDesign),
    ],
  });

  activeOrder.text = currentSettings.text;
  activeOrder.settings = nextSettings;
  applySettings(nextSettings);
  updateActiveOrderFromControls();
  render();
  closeInsertFixedDesignDialog();
  updateWorkflowAlert(`Inserted fixed design ${selectedFixedDesign.displayName}.`, "success");
}

function removeFixedDesignLine(settingsIndex) {
  const activeOrder = getActiveOrder();
  const currentSettings = normalizeSettings(getCurrentSettings());
  const removedLine = currentSettings.lines[settingsIndex];
  if (!activeOrder || !isFixedSvgLineSettings(removedLine)) {
    return;
  }

  const removedFixedDesign = resolveFixedDesignReference(removedLine, fixedDesignRecords);
  const nextSettings = normalizeSettings({
    ...currentSettings,
    lines: currentSettings.lines.filter((_, index) => index !== settingsIndex),
  });

  activeOrder.text = currentSettings.text;
  activeOrder.settings = nextSettings;
  applySettings(nextSettings);
  updateActiveOrderFromControls();
  render();
  updateWorkflowAlert(`Removed fixed design ${removedFixedDesign.displayName}.`, "success");
}

function renderFixedDesignWorkspace() {
  if (!fixedDesignList) {
    return;
  }

  if (fixedDesignSearchInput && fixedDesignSearchInput.value !== fixedDesignSearchTerm) {
    fixedDesignSearchInput.value = fixedDesignSearchTerm;
  }

  selectFirstFixedDesignIfNeeded();
  const selectedFixedDesign = getSelectedFixedDesign();
  const visibleRecords = getVisibleFixedDesignRecords();

  fixedDesignList.replaceChildren();
  if (!fixedDesignsLoaded && fixedDesignsLoading) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note fixed-design-empty-state";
    empty.textContent = "Loading fixed designs...";
    fixedDesignList.append(empty);
  } else if (!visibleRecords.length) {
    const empty = document.createElement("p");
    empty.className = "batch-tools-note fixed-design-empty-state";
    empty.textContent = fixedDesignSearchTerm.trim()
      ? "No fixed designs match that search."
      : "Upload an SVG to add the first fixed design.";
    fixedDesignList.append(empty);
  } else {
    visibleRecords.forEach((fixedDesign) => {
      const row = document.createElement("article");
      row.className = "fixed-design-row size-preset-row";
      row.classList.toggle("is-selected", fixedDesign.id === selectedFixedDesign?.id);
      row.role = "button";
      row.tabIndex = 0;
      row.dataset.fixedDesignId = fixedDesign.id;
      row.innerHTML = `
        <span class="size-preset-name fixed-design-row-name"></span>
        <span class="size-preset-meta fixed-design-row-meta"></span>
      `;
      row.querySelector(".fixed-design-row-name").textContent = fixedDesign.displayName;
      row.querySelector(".fixed-design-row-meta").textContent = `v${fixedDesign.version || 1} - ${fixedDesign.fileName || "SVG"}`;
      row.addEventListener("click", () => {
        selectFixedDesign(fixedDesign.id);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        selectFixedDesign(fixedDesign.id);
      });
      fixedDesignList.append(row);
    });
  }

  selectedFixedDesignName.textContent = selectedFixedDesign?.displayName || "No fixed design selected";
  selectedFixedDesignMeta.textContent = getFixedDesignMetaLabel(selectedFixedDesign);
  selectedFixedDesignFileName.textContent = selectedFixedDesign?.fileName || "None";
  selectedFixedDesignVersion.textContent = selectedFixedDesign ? `v${selectedFixedDesign.version || 1}` : "None";
  selectedFixedDesignState.textContent = selectedFixedDesign?.stateLabel || "No selection";

  const hasSelectedDesign = Boolean(selectedFixedDesign);
  [saveFixedDesignButton, loadFixedDesignVersionButton, downloadFixedDesignButton, deleteFixedDesignButton]
    .filter(Boolean)
    .forEach((button) => {
      button.disabled = !hasSelectedDesign;
    });
  downloadFixedDesignButton.disabled = !selectedFixedDesign?.publicUrl;

  if (selectedFixedDesign?.publicUrl) {
    fixedDesignPreviewImage.src = selectedFixedDesign.publicUrl;
    fixedDesignPreviewImage.alt = `${selectedFixedDesign.displayName} SVG preview`;
    fixedDesignPreviewImage.hidden = false;
    fixedDesignPreviewEmptyState.hidden = true;
  } else {
    fixedDesignPreviewImage.removeAttribute("src");
    fixedDesignPreviewImage.alt = "";
    fixedDesignPreviewImage.hidden = true;
    fixedDesignPreviewEmptyState.hidden = false;
    fixedDesignPreviewEmptyState.textContent = selectedFixedDesign
      ? "This fixed design does not have a preview URL."
      : "Select or upload an SVG fixed design.";
  }
}

function renderFontWorkspace() {
  if (!fontLibraryList) {
    return;
  }

  const selectedFont = getFontOption(selectedFontId);
  if (showDeletedFontsInput) {
    showDeletedFontsInput.checked = showDeletedFonts;
  }
  fontLibraryList.replaceChildren();
  getFontLibraryOptions(FONT_OPTIONS, { showDeleted: showDeletedFonts }).forEach((font) => {
    const row = document.createElement("article");
    row.className = "font-library-row size-preset-row";
    row.classList.toggle("is-selected", font.id === selectedFont.id);
    row.role = "button";
    row.tabIndex = 0;
    row.dataset.fontId = font.id;
    row.innerHTML = `
      <p class="size-preset-name font-library-name"></p>
      <p class="size-preset-meta font-library-preview"></p>
    `;
    row.querySelector(".font-library-name").textContent = font.label;
    const preview = row.querySelector(".font-library-preview");
    preview.textContent = font.label;
    preview.style.fontFamily = `"${font.family}", "Segoe Script", cursive`;
    row.addEventListener("click", () => {
      selectedFontId = font.id;
      renderFontWorkspace();
      writeAppRoute({ workspace: "fonts", itemId: selectedFontId });
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectedFontId = font.id;
        renderFontWorkspace();
        writeAppRoute({ workspace: "fonts", itemId: selectedFontId });
      }
    });
    fontLibraryList.append(row);
  });

  selectedFontName.textContent = selectedFont.label;
  selectedFontMeta.textContent = getFontMetaLabel(selectedFont);
  fontDisplayNameInput.value = selectedFont.displayName || selectedFont.label;
  fontDisplayNameInput.disabled = false;
  if (fontBridgingEnabledInput) {
    fontBridgingEnabledInput.checked = selectedFont.bridgingEnabled !== false;
    fontBridgingEnabledInput.disabled = false;
  }
  if (fontPreviewTextInput.value !== fontPreviewText) {
    fontPreviewTextInput.value = fontPreviewText;
  }
  selectedFontPreview.textContent = fontPreviewText;
  selectedFontPreview.style.fontFamily = `"${selectedFont.family}", "Segoe Script", cursive`;
  replaceFontButton.disabled = false;
  deleteFontButton.disabled = Boolean(selectedFont.isBuiltin);
  delete fontEditorStatus.dataset.state;
  fontEditorStatus.textContent = selectedFont.isBuiltin
    ? "Original production fonts can be replaced with a new version while keeping their stable design and preset references."
    : "Uploaded fonts can be replaced with a new version or deleted from future selections.";
}

function formatFixedDesignDisplayName(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    || "Fixed Design";
}

async function buildFixedDesignUploadPayload(file, displayName = "") {
  if (!file || !/\.svg$/i.test(file.name || "")) {
    throw new Error("Upload an SVG file.");
  }

  const text = await file.text();
  return {
    displayName: displayName.trim() || formatFixedDesignDisplayName(file.name),
    file: {
      name: file.name,
      type: file.type || "image/svg+xml",
      size: file.size,
      text,
    },
  };
}

function upsertFixedDesignRecord(record) {
  const normalized = normalizeFixedDesignRecord(record);
  if (!normalized) {
    return null;
  }

  const existingIndex = fixedDesignRecords.findIndex((candidate) => candidate.id === normalized.id);
  if (existingIndex >= 0) {
    fixedDesignRecords = fixedDesignRecords.map((candidate) => (
      candidate.id === normalized.id ? normalized : candidate
    ));
  } else {
    fixedDesignRecords = [...fixedDesignRecords, normalized];
  }
  fixedDesignRecords.sort((a, b) => a.displayName.localeCompare(b.displayName));
  fixedDesignsLoaded = true;
  return normalized;
}

async function handleFixedDesignUploadSelection() {
  const file = fixedDesignUploadInput?.files?.[0] || null;
  if (fixedDesignUploadInput) {
    fixedDesignUploadInput.value = "";
  }
  if (!file) {
    return;
  }

  try {
    setFixedDesignEditorStatus("Uploading fixed design...", "pending");
    const payload = await buildFixedDesignUploadPayload(file);
    const savedRecord = await createWorkspaceFixedDesign(payload, { accessToken: productionBatchAccessToken });
    const normalized = upsertFixedDesignRecord(savedRecord);
    if (normalized) {
      selectedFixedDesignId = normalized.id;
    }
    renderFixedDesignWorkspace();
    writeAppRoute({ workspace: "fixedDesigns", itemId: selectedFixedDesignId });
    setFixedDesignEditorStatus("Fixed design uploaded.", "success");
  } catch (error) {
    handleFixedDesignApiError(error, "Unable to upload fixed design.");
  }
}

function configureFixedDesignVersionDialog(mode) {
  fixedDesignVersionDialogMode = mode === "create" ? "create" : "replace";
  const isCreateMode = fixedDesignVersionDialogMode === "create";

  if (fixedDesignVersionDialogTitle) {
    fixedDesignVersionDialogTitle.textContent = isCreateMode ? "Upload SVG" : "Load New Version";
  }
  if (closeFixedDesignVersionDialogButton) {
    closeFixedDesignVersionDialogButton.setAttribute(
      "aria-label",
      isCreateMode ? "Close upload SVG dialog" : "Close load new version dialog",
    );
  }
  if (loadFixedDesignVersionConfirmButton) {
    loadFixedDesignVersionConfirmButton.textContent = isCreateMode ? "Upload Design" : "Load Version";
  }
}

function openFixedDesignUploadDialog() {
  configureFixedDesignVersionDialog("create");
  stageFixedDesignVersionFile(null);
  if (fixedDesignVersionInput) {
    fixedDesignVersionInput.value = "";
  }
  if (typeof fixedDesignVersionDialog?.showModal === "function") {
    fixedDesignVersionDialog.showModal();
  }
}

function openFixedDesignVersionDialog() {
  if (!getSelectedFixedDesign()) {
    return;
  }

  configureFixedDesignVersionDialog("replace");
  fixedDesignActionsMenu?.removeAttribute("open");
  stageFixedDesignVersionFile(null);
  if (fixedDesignVersionInput) {
    fixedDesignVersionInput.value = "";
  }
  if (typeof fixedDesignVersionDialog?.showModal === "function") {
    fixedDesignVersionDialog.showModal();
  }
}

function closeFixedDesignVersionDialog() {
  if (fixedDesignVersionDialog?.open) {
    fixedDesignVersionDialog.close();
  }
  stageFixedDesignVersionFile(null);
  if (fixedDesignVersionInput) {
    fixedDesignVersionInput.value = "";
  }
  configureFixedDesignVersionDialog("replace");
}

async function createFixedDesignFromDialog(file) {
  if (!file) {
    setFixedDesignVersionStatus("Choose an SVG file before uploading a fixed design.");
    return;
  }

  try {
    setFixedDesignVersionStatus("Uploading fixed design...");
    const payload = await buildFixedDesignUploadPayload(file);
    const savedRecord = await createWorkspaceFixedDesign(payload, { accessToken: productionBatchAccessToken });
    const normalized = upsertFixedDesignRecord(savedRecord);
    if (normalized) {
      selectedFixedDesignId = normalized.id;
    }
    renderFixedDesignWorkspace();
    writeAppRoute({ workspace: "fixedDesigns", itemId: selectedFixedDesignId });
    setFixedDesignEditorStatus("Fixed design uploaded.", "success");
    closeFixedDesignVersionDialog();
  } catch (error) {
    handleFixedDesignApiError(error, "Unable to upload fixed design.", { versionDialog: true });
  }
}

function submitFixedDesignVersionDialog() {
  if (fixedDesignVersionDialogMode === "create") {
    void createFixedDesignFromDialog(stagedFixedDesignVersionFile);
    return;
  }
  void replaceSelectedFixedDesignVersion(stagedFixedDesignVersionFile);
}

async function replaceSelectedFixedDesignVersion(file) {
  const selectedFixedDesign = getSelectedFixedDesign();
  if (!selectedFixedDesign || !file) {
    setFixedDesignVersionStatus("Choose an SVG file before loading a new version.");
    return;
  }

  try {
    setFixedDesignVersionStatus("Uploading new version...");
    const payload = await buildFixedDesignUploadPayload(file, selectedFixedDesign.displayName);
    const savedRecord = await replaceWorkspaceFixedDesign(selectedFixedDesign.id, payload, { accessToken: productionBatchAccessToken });
    const normalized = upsertFixedDesignRecord(savedRecord);
    if (normalized) {
      selectedFixedDesignId = normalized.id;
    }
    renderFixedDesignWorkspace();
    setFixedDesignEditorStatus("Fixed design version uploaded.", "success");
    closeFixedDesignVersionDialog();
  } catch (error) {
    handleFixedDesignApiError(error, "Unable to upload new version.", { versionDialog: true });
  }
}

function getFixedDesignDownloadFileName(fixedDesign) {
  return fixedDesign.fileName || `${fixedDesign.displayName.replace(/\s+/g, "-").toLowerCase()}.svg`;
}

async function downloadSelectedFixedDesign() {
  const selectedFixedDesign = getSelectedFixedDesign();
  if (!selectedFixedDesign?.publicUrl) {
    setFixedDesignEditorStatus("This fixed design does not have a downloadable SVG URL.", "error");
    return;
  }

  fixedDesignActionsMenu?.removeAttribute("open");
  try {
    setFixedDesignEditorStatus("Preparing SVG download...", "pending");
    const response = await fetch(selectedFixedDesign.publicUrl);
    if (!response.ok) {
      throw new Error("Unable to download SVG file.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = getFixedDesignDownloadFileName(selectedFixedDesign);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
    setFixedDesignEditorStatus("SVG download prepared.", "success");
  } catch (error) {
    setFixedDesignEditorStatus(error instanceof Error ? error.message : "Unable to download SVG file.", "error");
  }
}

async function deleteSelectedFixedDesign() {
  const selectedFixedDesign = getSelectedFixedDesign();
  if (!selectedFixedDesign) {
    return;
  }

  fixedDesignActionsMenu?.removeAttribute("open");
  const confirmed = await showConfirmationDialog({
    title: "Delete Fixed Design?",
    description: `Delete ${selectedFixedDesign.displayName} from future fixed design selections? Existing saved orders may still reference it.`,
    confirmLabel: "Delete",
    isDanger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    setFixedDesignEditorStatus("Deleting fixed design...", "pending");
    await deleteWorkspaceFixedDesign(selectedFixedDesign.id, { accessToken: productionBatchAccessToken });
    fixedDesignRecords = fixedDesignRecords.filter((record) => record.id !== selectedFixedDesign.id);
    selectedFixedDesignId = null;
    selectFirstFixedDesignIfNeeded();
    renderFixedDesignWorkspace();
    writeAppRoute({ workspace: "fixedDesigns", itemId: selectedFixedDesignId });
    setFixedDesignEditorStatus("Fixed design deleted.", "success");
  } catch (error) {
    handleFixedDesignApiError(error, "Unable to delete fixed design.");
  }
}

function setActiveWorkspace(workspace, options = {}) {
  const { updateRoute = true, replaceRoute = false } = options;
  const hasRouteItemId = Object.prototype.hasOwnProperty.call(options, "routeItemId");
  activeWorkspace = ["orders", "databaseOrders", "presets", "fonts", "fixedDesigns", "sizeGuides"].includes(workspace) ? workspace : DEFAULT_WORKSPACE;
  appShell.dataset.workspace = activeWorkspace;
  ordersWorkspace.hidden = activeWorkspace !== "orders";
  databaseOrdersWorkspace.hidden = activeWorkspace !== "databaseOrders";
  presetsWorkspace.hidden = activeWorkspace !== "presets";
  fontsWorkspace.hidden = activeWorkspace !== "fonts";
  fixedDesignsWorkspace.hidden = activeWorkspace !== "fixedDesigns";
  sizeGuideWorkspace.hidden = activeWorkspace !== "sizeGuides";
  orderWorkspaceButton.classList.toggle("is-active", activeWorkspace === "orders");
  databaseOrdersWorkspaceButton.classList.toggle("is-active", activeWorkspace === "databaseOrders");
  presetWorkspaceButton.classList.toggle("is-active", activeWorkspace === "presets");
  fontWorkspaceButton.classList.toggle("is-active", activeWorkspace === "fonts");
  fixedDesignsWorkspaceButton.classList.toggle("is-active", activeWorkspace === "fixedDesigns");
  sizeGuideWorkspaceButton.classList.toggle("is-active", activeWorkspace === "sizeGuides");
  orderWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "orders"));
  databaseOrdersWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "databaseOrders"));
  presetWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "presets"));
  fontWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "fonts"));
  fixedDesignsWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "fixedDesigns"));
  sizeGuideWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "sizeGuides"));
  if (activeWorkspace === "presets") {
    selectFirstPresetEditorRowIfNeeded();
  }
  if (activeWorkspace === "databaseOrders") {
    renderDatabaseOrdersWorkspace();
    void loadDatabaseOrders();
  }
  if (activeWorkspace === "fonts") {
    renderFontWorkspace();
  }
  if (activeWorkspace === "fixedDesigns") {
    renderFixedDesignWorkspace();
    if (productionBatchAccessToken) {
      void refreshWorkspaceFixedDesigns(productionBatchAccessToken);
    }
  }
  if (activeWorkspace === "sizeGuides") {
    selectFirstSizePresetIfNeeded({ updateRoute });
  }
  if (updateRoute) {
    writeAppRoute({
      replace: replaceRoute,
      itemId: hasRouteItemId ? options.routeItemId : getWorkspaceRouteItemId(activeWorkspace),
    });
  }
}

async function handleFontFileSelection(mode) {
  const file = fontFileInput.files?.[0] || null;
  fontFileInput.value = "";
  if (!file) {
    return;
  }

  const selectedFont = getFontOption(selectedFontId);
  const displayName = fontDisplayNameInput.value.trim() || file.name.replace(/\.[^.]+$/, "");
  try {
    setFontEditorStatus(mode === "replace" ? "Uploading new font version..." : "Uploading font...", "pending");
    const payload = await buildFontUploadPayload(file, displayName);
    const savedFont = mode === "replace"
      ? await replaceWorkspaceFont(selectedFont.id, payload, { accessToken: productionBatchAccessToken })
      : await createWorkspaceFont(payload, { accessToken: productionBatchAccessToken });
    await refreshWorkspaceFonts(productionBatchAccessToken);
    selectedFontId = savedFont?.id || selectedFontId;
    renderFontWorkspace();
    renderLineControls(getActiveOrder()?.settings || getCurrentSettings());
    setFontEditorStatus(mode === "replace" ? "Font version uploaded." : "Font uploaded.", "success");
  } catch (error) {
    setFontEditorStatus(error instanceof Error ? error.message : "Unable to upload font.", "error");
  }
}

async function handleSaveFontDisplayName() {
  const selectedFont = getFontOption(selectedFontId);
  const displayName = getFontDisplayNameDraft();
  const bridgingEnabled = Boolean(fontBridgingEnabledInput?.checked);
  if (!displayName || displayName === String(selectedFont.displayName || selectedFont.label || "").trim()) {
    updateSaveFontDisplayNameButton();
    return;
  }

  try {
    if (saveFontDisplayNameButton) {
      saveFontDisplayNameButton.disabled = true;
    }
    setFontEditorStatus("Saving font display name...", "pending");
    await updateWorkspaceFontSettings(selectedFont.id, { displayName, bridgingEnabled }, {
      accessToken: productionBatchAccessToken,
    });
    await refreshWorkspaceFonts(productionBatchAccessToken);
    selectedFontId = selectedFont.id;
    renderFontWorkspace();
    renderLineControls(getActiveOrder()?.settings || getCurrentSettings());
    setFontEditorStatus("Font display name saved.", "success");
  } catch (error) {
    updateSaveFontDisplayNameButton();
    setFontEditorStatus(error instanceof Error ? error.message : "Unable to save font display name.", "error");
  }
}

async function handleFontBridgingEnabledChange() {
  const selectedFont = getFontOption(selectedFontId);
  const bridgingEnabled = Boolean(fontBridgingEnabledInput?.checked);

  try {
    setFontEditorStatus("Saving font bridge setting...", "pending");
    await updateWorkspaceFontSettings(selectedFont.id, { bridgingEnabled }, {
      accessToken: productionBatchAccessToken,
    });
    await refreshWorkspaceFonts(productionBatchAccessToken);
    renderFontWorkspace();
    renderLineControls(getActiveOrder()?.settings || getCurrentSettings());
    render();
    updateActiveOrderFromControls();
    setFontEditorStatus("Font bridge setting saved.", "success");
  } catch (error) {
    if (fontBridgingEnabledInput) {
      fontBridgingEnabledInput.checked = selectedFont.bridgingEnabled !== false;
    }
    setFontEditorStatus(error instanceof Error ? error.message : "Unable to save font bridge setting.", "error");
  }
}

async function handleDeleteSelectedFont() {
  const selectedFont = getFontOption(selectedFontId);
  if (selectedFont.isBuiltin) {
    return;
  }

  const confirmed = await showConfirmationDialog({
    title: "Delete Font?",
    description: `Delete ${selectedFont.label} from future font selections? Existing saved designs may still reference it.`,
    confirmLabel: "Delete Font",
    isDanger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    setFontEditorStatus("Deleting font...", "pending");
    await deleteWorkspaceFont(selectedFont.id, { accessToken: productionBatchAccessToken });
    selectedFontId = "candlepin";
    await refreshWorkspaceFonts(productionBatchAccessToken);
    renderLineControls(getActiveOrder()?.settings || getCurrentSettings());
    setFontEditorStatus("Font deleted from future selections.", "success");
  } catch (error) {
    setFontEditorStatus(error instanceof Error ? error.message : "Unable to delete font.", "error");
  }
}

function readNavCollapsedPreference() {
  try {
    return window.localStorage.getItem(WORKSPACE_NAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistNavCollapsedPreference(nextCollapsed) {
  navCollapsed = Boolean(nextCollapsed);
  try {
    window.localStorage.setItem(WORKSPACE_NAV_COLLAPSED_STORAGE_KEY, String(navCollapsed));
  } catch {
  }
}

function setNavCollapsed(nextCollapsed, options = {}) {
  navCollapsed = Boolean(nextCollapsed);
  appShell.dataset.navCollapsed = String(navCollapsed);
  navCollapseButton.setAttribute("aria-label", navCollapsed ? "Expand navigation" : "Collapse navigation");
  if (options.persist) {
    persistNavCollapsedPreference(navCollapsed);
  }
}

function selectOrder(orderId, options = {}) {
  const { updateRoute = true, replaceRoute = false, persistSelection = true } = options;
  const selectionScrollState = captureSelectionScrollState();
  saveActiveOrderDraft();

  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return false;
  }

  activeOrderItemId = order.id;
  if (order.status === "not-started") {
    order.status = "in-progress";
  }

  syncOrderPresetFromListing(order);
  applySettings(order.settings);
  void ensureFixedDesignRecordsForSettings(order.settings).then((loaded) => {
    if (loaded && order.id === activeOrderItemId) {
      renderLineControls(order.settings);
      render();
    }
  });
  if (persistSelection) {
    persistBatchState();
  }
  renderOrderList();
  if (updateRoute) {
    writeAppRoute({
      replace: replaceRoute,
      workspace: "orders",
      itemId: activeOrderItemId,
    });
  }
  restoreSelectionScrollState(selectionScrollState);
  scheduleDeferredPreviewRender();
  window.requestAnimationFrame(() => {
    restoreSelectionScrollState(selectionScrollState);
  });
  return true;
}

function addOrder() {
  const order = createBatchItem({
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
    description: `Delete ${buildBatchOrderNumber(order)} from the current batch?`,
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

  const nextActiveOrderItemId = activeOrderItemId === orderId
    ? orders[orderIndex + 1]?.id || orders[orderIndex - 1]?.id || null
    : activeOrderItemId;
  let removedRemoteSnapshot = null;

  if (canAttemptProductionBatchSave() && productionBatchContext?.id) {
    try {
      const accessToken = productionBatchAccessToken || readProductionBatchAccessTokenOverride() || await getAccessToken();
      if (!accessToken) {
        throw new Error("Authentication required.");
      }
      productionBatchAccessToken = accessToken;
      removedRemoteSnapshot = await removeProductionBatchItem(productionBatchContext.id, orderId, {
        accessToken,
        activeOrderItemId: nextActiveOrderItemId,
      });
    } catch (error) {
      updateWorkflowAlert(
        error instanceof Error ? error.message : "Unable to delete the design from the shared batch.",
        "error",
      );
      return;
    }
  }

  orders.splice(orderIndex, 1);

  if (activeOrderItemId === orderId) {
    activeOrderItemId = nextActiveOrderItemId;
    if (activeOrderItemId) {
      const nextOrder = getActiveOrder();
      applySettings(nextOrder.settings);
    } else {
      orderSequence = 1;
      resetEditorToEmptyState();
    }
  }

  if (removedRemoteSnapshot?.batch) {
    enableProductionBatchSync(removedRemoteSnapshot.batch);
    mergeProductionBatchPublishedStateFromSnapshot(removedRemoteSnapshot);
  }

  if (removedRemoteSnapshot) {
    lastProductionBatchSaveKey = buildProductionBatchSaveKey(buildProductionBatchSnapshot());
  }

  if (!orders.length) {
    activeOrderItemId = null;
    orderSequence = 1;
    persistBatchState({ skipRemoteSave: Boolean(removedRemoteSnapshot) });
    updateWorkflowAlert(isProductionBatchSyncEnabled() ? "Production batch cleared." : "Batch cleared.", "pending");
  } else {
    persistBatchState({ skipRemoteSave: Boolean(removedRemoteSnapshot) });
  }

  renderOrderList();
  if (activeOrderItemId) {
    render();
  }
}

function getIncompleteProductionBatchOrders() {
  return orders.filter((order) => (
    order.status !== "captured"
    && order.status !== "exported"
  ) || !isOrderReadyForExport(order));
}

async function completeCurrentProductionBatch() {
  saveActiveOrderDraft();
  if (!orders.length) {
    return;
  }

  const incompleteOrders = getIncompleteProductionBatchOrders();
  const confirmed = await showConfirmationDialog({
    title: incompleteOrders.length ? "Complete Production Batch With Incomplete Items?" : "Complete Production Batch?",
    description: incompleteOrders.length
      ? `${incompleteOrders.length} of ${orders.length} batch item${orders.length === 1 ? "" : "s"} ${incompleteOrders.length === 1 ? "is" : "are"} not complete or export-ready. Complete this production batch anyway?`
      : "Mark every order in this production batch complete and remove the batch from the active view?",
    confirmLabel: "Complete Batch",
    cancelLabel: "Keep Batch",
    isDanger: incompleteOrders.length > 0,
  });
  if (!confirmed) {
    return;
  }

  const previousOrders = orders.map((order) => structuredClone(order));
  const previousActiveOrderItemId = activeOrderItemId;
  const previousOrderSequence = orderSequence;

  orders.splice(0, orders.length);
  activeOrderItemId = null;
  orderSequence = 1;
  resetEditorToEmptyState();
  renderOrderList();

  let completedRemoteSnapshot = null;
  if (isProductionBatchSyncEnabled()) {
    try {
      const completeBatchId = productionBatchContext.id;
      const accessToken = productionBatchAccessToken || readProductionBatchAccessTokenOverride() || await getAccessToken();
      productionBatchAccessToken = accessToken;
      completedRemoteSnapshot = await completeProductionBatch(completeBatchId, { accessToken });
    } catch (error) {
      orders.splice(0, orders.length, ...previousOrders);
      activeOrderItemId = previousActiveOrderItemId;
      orderSequence = previousOrderSequence;
      if (activeOrderItemId) {
        const restoredOrder = getActiveOrder();
        if (restoredOrder) {
          applySettings(restoredOrder.settings);
        }
      }
      renderOrderList();
      render();
      updateWorkflowAlert(
        error instanceof Error ? error.message : "Unable to complete the production batch.",
        "error",
      );
      return;
    }
  }

  productionBatchAutosavePending = false;
  if (completedRemoteSnapshot?.batch) {
    enableProductionBatchSync(completedRemoteSnapshot.batch);
  }
  lastProductionBatchSaveKey = buildProductionBatchSaveKey(completedRemoteSnapshot || buildProductionBatchSnapshot());
  persistBatchState({ skipRemoteSave: true });
  invalidateDatabaseOrders();
  updateWorkflowAlert(
    isProductionBatchSyncEnabled()
      ? "Production batch completed in Supabase."
      : "Production batch completed.",
    "pending",
  );
  renderOrderList();
}

async function importFromClipboard() {
  if (!navigator.clipboard?.readText) {
    updateWorkflowAlert("Clipboard import is not available in this browser context.", "error");
    return;
  }

  const batchId = requireActiveProductionBatchId();
  if (!batchId) {
    return;
  }

  importClipboardButton.disabled = true;
  setBatchActionLabel(importClipboardButton, "Pasting...");
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const clipboardText = await navigator.clipboard.readText();
    const importedItems = parseImportedItems(clipboardText, { getPresetIdForListingId });
    assertImportableItems(importedItems);
    const { filteredItems, skippedCount } = filterNewProductionBatchImportItems(importedItems);
    if (!filteredItems.length) {
      updateWorkflowAlert(buildSkippedBatchImportMessage(skippedCount), "success");
      showPasteSummaryDialog({
        targetLabel: "Production Batch",
        importedCount: 0,
        skippedDuplicateCount: skippedCount,
        addedToBatchCount: 0,
      });
      return;
    }

    const accessToken = await resolveProductionBatchMutationAccessToken();
    const payload = await importWorkspaceOrders({
      target: "productionBatch",
      batchId,
      items: filteredItems,
      accessToken,
    });
    await refreshOrdersAndProductionBatch({ payload, accessToken, refreshBatch: true });
    appendImportedItemsToProductionBatch(filteredItems, {
      maxCount: countFromPayload(payload, "addedOrderItemCount"),
    });
    const message = skippedCount
      ? `${buildProductionBatchImportMessage(payload)} Skipped ${skippedCount} already in the batch.`
      : buildProductionBatchImportMessage(payload);
    updateWorkflowAlert(message, "success");
    showPasteSummaryDialog({
      targetLabel: "Production Batch",
      importedCount: countFromPayload(payload, "importedOrderItemCount"),
      skippedDuplicateCount: skippedCount + countFromPayload(payload, "skippedOrderItemCount"),
      addedToBatchCount: countFromPayload(payload, "addedOrderItemCount"),
    });
  } catch (error) {
    handleOrdersMutationError(
      error,
      "Clipboard import failed.",
      "Production batch session expired. Sign in again to continue importing orders.",
    );
  } finally {
    ordersDatabaseMutationInFlight = false;
    importClipboardButton.disabled = false;
    setBatchActionLabel(importClipboardButton, "Paste");
    render();
  }
}

async function importOrdersFromClipboard() {
  if (!navigator.clipboard?.readText) {
    updateWorkflowAlert("Clipboard import is not available in this browser context.", "error");
    return;
  }

  if (!pasteOrdersButton) {
    return;
  }

  databaseOrdersImporting = true;
  pasteOrdersButton.disabled = true;
  setBatchActionLabel(pasteOrdersButton, "Pasting...");
  ordersDatabaseMutationInFlight = true;
  render();

  try {
    const clipboardText = await navigator.clipboard.readText();
    const importedItems = parseImportedItems(clipboardText, { getPresetIdForListingId });
    assertImportableItems(importedItems);
    const accessToken = await resolveProductionBatchMutationAccessToken();
    const batchId = getActiveProductionBatchId();
    const payload = await importWorkspaceOrders({
      target: "orders",
      items: importedItems,
      ...(batchId ? { batchId } : {}),
      accessToken,
    });

    await refreshOrdersAndProductionBatch({ payload, accessToken });
    updateWorkflowAlert(buildOrdersImportMessage(payload), "success");
    showPasteSummaryDialog({
      targetLabel: "Orders",
      importedCount: countFromPayload(payload, "importedOrderItemCount"),
      skippedDuplicateCount: countFromPayload(payload, "skippedOrderItemCount"),
      addedToBatchCount: countFromPayload(payload, "addedOrderItemCount"),
    });
  } catch (error) {
    handleOrdersMutationError(
      error,
      "Clipboard import failed.",
      "Production batch session expired. Sign in again to continue importing orders.",
    );
  } finally {
    databaseOrdersImporting = false;
    ordersDatabaseMutationInFlight = false;
    pasteOrdersButton.disabled = false;
    setBatchActionLabel(pasteOrdersButton, "Paste");
    renderDatabaseOrdersWorkspace();
    render();
  }
}

async function captureActiveOrder({ advanceToNext = false } = {}) {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.text = textInput.value;
  order.settings = getCurrentSettings();
  if (!orderHasRenderableDesign(order)) {
    return;
  }
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
  order.saveErrorMessage = null;
  order.status = "captured";
  clearProductionBatchAutosaveTimeout();
  productionBatchAutosavePending = false;
  persistBatchState({ skipRemoteSave: true });
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
    let completedAnalysisPersisted = true;

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

      await waitForProductionBatchAutosaveIdle();
      completedAnalysisPersisted = await saveBatchSnapshotToRemote({
        persistActiveDraft: false,
        publishOrderIds: [order.id],
        successMessage: `Production batch saved at ${new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}.`,
        successAlertAutoHideMs: 8000,
      });
      if (!completedAnalysisPersisted && !order.saveErrorMessage) {
        order.saveErrorMessage = "Unable to save this design.";
        renderOrderList();
      }
    }

    persistBatchState();

    if (
      completedAnalysisPersisted
      &&
      shouldApplyCompletedAnalysis
      && activeOrderItemId === order.id
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
    if (shouldApplyFailedAnalysis && activeOrderItemId === order.id) {
      updateConnectionStatus(
        "warning",
        "Analysis failed",
        `Face analysis could not complete, so this completed design is not ready for export yet.${detail}`,
      );
    }
    persistBatchState();
    renderOrderList();
  } finally {
    if (order.pendingAnalysisRequestId === requestId || order.pendingAnalysisRequestId == null) {
      order.analysisState = order.pendingAnalysisRequestId ? "running" : "idle";
    }
    persistBatchState();
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

function findPairOffsetMm(leftMask, rightMask, bridgeMm) {
  const targetPx = Math.max(1, Math.round(bridgeMm * PX_PER_MM * MASK_SCALE));
  const offsetPx = findPairOffsetPx(leftMask, rightMask, targetPx);

  if (Number.isFinite(offsetPx)) {
    return (offsetPx / MASK_SCALE / PX_PER_MM) - OUTLINE_BRIDGE_SAFETY_MM;
  }

  return (leftMask.rightMm + rightMask.leftMm) - bridgeMm - OUTLINE_BRIDGE_SAFETY_MM;
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
    settings.fontBridgingEnabled,
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

function layoutCharacters(text, settings) {
  const {
    bridgeMm,
    fontBridgingEnabled,
    fontId,
    fontSizeMm,
    horizontalScale,
    verticalScale,
  } = settings;
  const characters = buildGlyphLayoutRuns(text, fontBridgingEnabled);
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
      : resolveNextGlyphMaskOrigin({
          bridgeMm,
          findPairOffset: findPairOffsetMm,
          fontBridgingEnabled,
          leftMask: masks[index - 1],
          previousAdvanceMm: positions[index - 1].advance,
          previousMaskOriginMm: positions[index - 1].maskOrigin,
          rightMask: mask,
        });
    positions.push({ advance: metrics.advance, maskOrigin });

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
  const letters = layoutCharacters(text, settings);

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
  const textLineItems = getTextLineItemsFromSettings({ text, lines: lineSettings });
  const lines = textLineItems.map(({ text: lineText, line, textLineIndex }) => {
    const measuredLine = getMeasuredLine(lineText, line);

    return {
      index: textLineIndex,
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
    line.y = previous.y + resolveNextLineOffsetMm({
      bridgeMm: line.settings.lineBridgeMm,
      findLineOffset: findLineOffsetMm,
      fontBridgingEnabled: line.settings.fontBridgingEnabled,
      lowerMask: line.mask,
      upperMask: previous.mask,
    });
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
      bridgeMm: Number(line.settings.bridgeMm),
      lineBridgeMm: Number(line.settings.lineBridgeMm),
      offsetXMm: Number(line.settings.offsetXMm) * fitScale,
      fontSizeMm: Number(line.settings.fontSizeMm) * (lockTextHeight ? 1 : fitScale),
    });
  });
}

function faceBoundsFitGuide(faceBounds, guide) {
  const maxWidthMm = Number(guide?.maxWidthMm);
  const maxHeightMm = Number(guide?.maxHeightMm);

  return faceBounds.width <= maxWidthMm + 0.01 && faceBounds.height <= maxHeightMm + 0.01;
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

function getPreviewFacePath(layout, analysis) {
  if (layout?.weldExportedDesign && typeof analysis?.exportFacePath === "string" && analysis.exportFacePath) {
    return analysis.exportFacePath;
  }

  return analysis?.facePath;
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
  const frontier = [];

  function isTransparent(index) {
    return data[index * 4 + 3] <= 32;
  }

  function addFrontierPixel(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;
    if (visited[index] || !isTransparent(index)) {
      return;
    }

    visited[index] = 1;
    frontier.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    addFrontierPixel(x, 0);
    addFrontierPixel(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    addFrontierPixel(0, y);
    addFrontierPixel(width - 1, y);
  }

  while (frontier.length) {
    const index = frontier.pop();
    const x = index % width;
    const y = Math.floor(index / width);

    addFrontierPixel(x + 1, y);
    addFrontierPixel(x - 1, y);
    addFrontierPixel(x, y + 1);
    addFrontierPixel(x, y - 1);
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

function createFixedSvgPreviewElements(fixedSvgs = [], frame) {
  return fixedSvgs.map((fixedSvg) => {
    const commonAttributes = {
      "data-fixed-svg-id": fixedSvg.id,
      "data-fixed-svg-name": fixedSvg.name,
    };
    const x = frame.designX + fixedSvg.xMm;
    const y = frame.designY + fixedSvg.yMm;

    if (fixedSvg.publicUrl) {
      return makeSvgElement("image", {
        ...commonAttributes,
        href: fixedSvg.publicUrl,
        x,
        y,
        width: fixedSvg.widthMm,
        height: fixedSvg.heightMm,
      });
    }

    const group = makeSvgElement("g", {
      ...commonAttributes,
      transform: `translate(${x} ${y})`,
    });
    const rect = makeSvgElement("rect", {
      width: fixedSvg.widthMm,
      height: fixedSvg.heightMm,
      fill: "none",
      stroke: "#9ca3af",
      "stroke-dasharray": "2 1.5",
    });
    const label = makeSvgElement("text", {
      x: fixedSvg.widthMm / 2,
      y: fixedSvg.heightMm / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      fill: "#6b7280",
      "font-size": "3",
    });
    label.textContent = fixedSvg.stateLabel || "Missing";
    group.append(rect, label);
    return group;
  });
}

function renderPreviewFromLayout(layout) {
  const analysis = layout.analysis || null;
  const useRasterTextPreview = shouldUseRasterTextPreview(layout);
  const facePreview = createFaceImage(layout.letters, layout.widthMm, layout.heightMm);
  const previewBounds = facePreview.boundsMm.width > 0 && facePreview.boundsMm.height > 0
    ? facePreview.boundsMm
    : analysis?.faceBoundsMm || layout.textBoundsMm;
  const frame = computePreviewFrame(layout, previewBounds, layout.guide);

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

  const backingLayer = analysis && !useRasterTextPreview
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
  const faceLayer = analysis && !useRasterTextPreview
    ? makeSvgElement("path", {
        class: "face-layer",
        d: getPreviewFacePath(layout, analysis),
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

  preview.append(backingLayer, faceLayer, ...createFixedSvgPreviewElements(layout.fixedSvgs || [], frame));
  appendPreviewGuide(frame.previewBoxX, frame.previewBoxY, layout.guide);
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

  if (!settings.text.trim() && !settingsIncludeFixedSvg(settings)) {
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
    "Save to analyze connectedness",
    "Face analysis and cached export geometry run only when you click Save.",
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
        "Save before exporting",
        "Click Save to run face analysis and cache the export-ready geometry for this design.",
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
    persistBatchState();
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
        "Save before copying",
        "Click Save to run face analysis and cache the export-ready geometry for this design.",
      );
      return;
    }

    const svgSource = await requestSvgSource({
      layout: buildExportPayload(cachedBuild.layout, cachedBuild.analysis, order.source),
    });
    await copySvgToClipboard(svgSource);
  } catch {
  } finally {
    copyButton.disabled = !orderHasRenderableDesign(order) || !canCopySvgToClipboard();
    setEditorActionLabel(copyButton, "Copy This Design");
    copyButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

async function requestSvgSource({ layout = null, layouts = null }) {
  const payload = layouts ? { layouts } : layout;
  const exportPayload = await enrichExportPayloadWithFixedSvgText(payload);
  const response = await fetch("/api/export-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(exportPayload),
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

  const exportableOrders = orders.filter(orderHasRenderableDesign);
  if (!exportableOrders.length) {
    return;
  }

  const unsavedOrders = exportableOrders.filter((order) => !isOrderReadyForExport(order));
  if (unsavedOrders.length) {
    updateWorkflowAlert(
      `Save ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch export. Face analysis now runs only on Save.`,
      "error",
    );
    renderOrderList();
    return;
  }

  exportCompletedButton.disabled = true;
  setBatchActionLabel(exportCompletedButton, "Exporting...");
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
    persistBatchState();
  } catch {
  } finally {
    exportCompletedButton.disabled = false;
    setBatchActionLabel(exportCompletedButton, "Export All Designs");
    exportCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

async function copyAllOrders() {
  saveActiveOrderDraft();
  renderOrderList();

  const exportableOrders = orders.filter(orderHasRenderableDesign);
  if (!exportableOrders.length || !canCopySvgToClipboard()) {
    return;
  }

  const unsavedOrders = exportableOrders.filter((order) => !isOrderReadyForExport(order));
  if (unsavedOrders.length) {
    updateWorkflowAlert(
      `Save ${unsavedOrders.length} design${unsavedOrders.length === 1 ? "" : "s"} before batch copy. Face analysis now runs only on Save.`,
      "error",
    );
    renderOrderList();
    return;
  }

  copyCompletedButton.disabled = true;
  setBatchActionLabel(copyCompletedButton, "Copying...");
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
    setBatchActionLabel(copyCompletedButton, "Copy All Designs");
    copyCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

function assembleOrderLayout(normalized, sourceLines, fitScale, fitted, guide) {
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
  const backingMm = normalized.backingMm;
  const overflowsGuide = computeGuideOverflow(sourceLines, textWidthMm, textHeightMm, guide);
  const textBoundsMm = buildScaledTextBounds(textWidthMm, textHeightMm, backingMm, 1);
  const widthMm = textBoundsMm.width + textBoundsMm.left * 2;
  const heightMm = textBoundsMm.height + textBoundsMm.top * 2;
  const absoluteLetters = lineBounds.flatMap(({ line, centeredLeftMm }) => {
    const font = getFontOption(line.settings.fontId);
    const rawLineX = textBoundsMm.left + centeredLeftMm - minLeftMm - line.mask.leftMm;
    const rawBaselineY = textBoundsMm.top + (line.y - minTopMm) + line.mask.baselineMm;

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
  const fixedSvgs = buildFixedSvgLayoutItems(normalized.lines, widthMm, heightMm);
  const expanded = expandLayoutForFixedSvgs({
    widthMm,
    heightMm,
    textBoundsMm,
    letters: absoluteLetters,
    fixedSvgs,
  });

  return {
    text,
    widthMm: expanded.widthMm,
    heightMm: expanded.heightMm,
    backingMm,
    weldExportedDesign: normalized.weldExportedDesign,
    boundingSizePresetId: normalized.boundingSizePresetId,
    guide,
    textBoundsMm: expanded.textBoundsMm,
    fit: {
      fitScale,
      lineScaleFactors,
      overflowsGuide,
    },
    letters: expanded.letters,
    fixedSvgs: expanded.fixedSvgs,
  };
}

function buildOrderLayout(settings) {
  const normalized = normalizeSettings(settings);
  const guide = resolveBoundingSizePreset(normalized.boundingSizePresetId);
  const { lines } = measureTextLayoutForFit(normalized.text, normalized.lines);
  let fitScale = computeMixedFitScale(lines, guide);
  let scaledLineSettings = buildScaledLineSettings(lines, fitScale);
  let fitted = measureTextLayoutForFit(normalized.text, scaledLineSettings);
  let layout = assembleOrderLayout(normalized, lines, fitScale, fitted, guide);

  for (let index = 0; index < 8; index += 1) {
    if (layout.fit.overflowsGuide && hasLockedTextHeight(lines)) {
      break;
    }

    const faceBounds = renderFaceCanvas(layout.letters, layout.widthMm, layout.heightMm).boundsMm;
    const residualFitScale = computeTextFitScale(faceBounds.width, faceBounds.height, guide);

    if (!Number.isFinite(residualFitScale) || Math.abs(residualFitScale - 1) < 0.001) {
      break;
    }

    const nextFitScale = fitScale * residualFitScale;
    const nextScaledLineSettings = buildScaledLineSettings(lines, nextFitScale);
    const nextFitted = measureTextLayoutForFit(normalized.text, nextScaledLineSettings);
    const nextLayout = assembleOrderLayout(normalized, lines, nextFitScale, nextFitted, guide);

    if (residualFitScale > 1) {
      const nextFaceBounds = renderFaceCanvas(nextLayout.letters, nextLayout.widthMm, nextLayout.heightMm).boundsMm;
      if (!faceBoundsFitGuide(nextFaceBounds, guide)) {
        break;
      }
    }

    fitScale = nextFitScale;
    scaledLineSettings = nextScaledLineSettings;
    fitted = nextFitted;
    layout = nextLayout;
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
boundingSizePresetInput?.addEventListener("change", () => {
  updateActiveOrderFromControls();
  render();
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
lineControls.addEventListener("click", (event) => {
  const actionButton = event.target instanceof Element
    ? event.target.closest("[data-line-action]")
    : null;
  if (!(actionButton instanceof HTMLButtonElement)) {
    return;
  }

  if (actionButton.dataset.lineAction === "removeFixedDesign") {
    const settingsIndex = Number(actionButton.dataset.settingsIndex);
    if (Number.isInteger(settingsIndex)) {
      removeFixedDesignLine(settingsIndex);
    }
  }
});
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
  setActiveWorkspace("orders", { routeItemId: null });
});
databaseOrdersWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("databaseOrders", { routeItemId: null });
});
pasteOrdersButton?.addEventListener("click", () => {
  void importOrdersFromClipboard();
});
addCheckedOrdersToBatchButton?.addEventListener("click", () => {
  void addCheckedDatabaseOrdersToBatch();
});
presetWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("presets", { routeItemId: null });
});
fontWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("fonts", { routeItemId: null });
});
fixedDesignsWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("fixedDesigns", { routeItemId: null });
});
newFontUploadButton?.addEventListener("click", () => {
  fontFileInput.dataset.mode = "create";
  fontFileInput.click();
});
replaceFontButton?.addEventListener("click", () => {
  fontFileInput.dataset.mode = "replace";
  fontFileInput.click();
});
fontFileInput?.addEventListener("change", () => {
  void handleFontFileSelection(fontFileInput.dataset.mode === "replace" ? "replace" : "create");
});
fontPreviewTextInput?.addEventListener("input", () => {
  fontPreviewText = fontPreviewTextInput.value;
  selectedFontPreview.textContent = fontPreviewText;
});
fontDisplayNameInput?.addEventListener("input", () => {
  updateSaveFontDisplayNameButton();
});
saveFontDisplayNameButton?.addEventListener("click", () => {
  void handleSaveFontDisplayName();
});
fontBridgingEnabledInput?.addEventListener("change", () => {
  void handleFontBridgingEnabledChange();
});
showDeletedFontsInput?.addEventListener("change", () => {
  showDeletedFonts = Boolean(showDeletedFontsInput.checked);
  renderFontWorkspace();
});
deleteFontButton?.addEventListener("click", () => {
  void handleDeleteSelectedFont();
});
fixedDesignUploadButton?.addEventListener("click", () => {
  openFixedDesignUploadDialog();
});
fixedDesignUploadInput?.addEventListener("change", () => {
  void handleFixedDesignUploadSelection();
});
fixedDesignSearchInput?.addEventListener("input", () => {
  fixedDesignSearchTerm = fixedDesignSearchInput.value;
  renderFixedDesignWorkspace();
});
saveFixedDesignButton?.addEventListener("click", () => {
  fixedDesignActionsMenu?.removeAttribute("open");
  setFixedDesignEditorStatus("Fixed design details are current.", "success");
});
loadFixedDesignVersionButton?.addEventListener("click", openFixedDesignVersionDialog);
downloadFixedDesignButton?.addEventListener("click", downloadSelectedFixedDesign);
deleteFixedDesignButton?.addEventListener("click", () => {
  void deleteSelectedFixedDesign();
});
chooseFixedDesignVersionButton?.addEventListener("click", () => {
  fixedDesignVersionInput?.click();
});
fixedDesignVersionInput?.addEventListener("change", () => {
  const file = fixedDesignVersionInput.files?.[0] || null;
  stageFixedDesignVersionFile(file);
});
cancelFixedDesignVersionButton?.addEventListener("click", closeFixedDesignVersionDialog);
loadFixedDesignVersionConfirmButton?.addEventListener("click", () => {
  submitFixedDesignVersionDialog();
});
closeFixedDesignVersionDialogButton?.addEventListener("click", closeFixedDesignVersionDialog);
fixedDesignVersionDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeFixedDesignVersionDialog();
});
fixedDesignVersionDialog?.addEventListener("click", (event) => {
  if (event.target === fixedDesignVersionDialog) {
    closeFixedDesignVersionDialog();
  }
});
fixedDesignDropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  fixedDesignDropZone.classList.add("is-dragging");
});
fixedDesignDropZone?.addEventListener("dragleave", () => {
  fixedDesignDropZone.classList.remove("is-dragging");
});
fixedDesignDropZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  fixedDesignDropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0] || null;
  stageFixedDesignVersionFile(file);
});
sizeGuideWorkspaceButton.addEventListener("click", () => {
  setActiveWorkspace("sizeGuides", { routeItemId: null });
});
productionBatchLogoutButton?.addEventListener("click", () => {
  void handleProductionBatchSignOut();
});
newPresetDraftButton?.addEventListener("click", () => {
  selectPresetEditorRow("");
  setPresetEditorStatus("Started a new preset draft.", "pending");
});
presetDraftNameInput?.addEventListener("input", () => {
  syncPresetEditorDraftFromInputs();
  updatePresetSaveButtonState();
});
savePresetButton?.addEventListener("click", () => {
  void savePresetEditorDraft();
});
cancelPresetButton?.addEventListener("click", cancelPresetEditorChanges);
deletePresetButton?.addEventListener("click", () => {
  void deletePresetEditorDraft();
});
presetBackingInput?.addEventListener("input", () => {
  updatePresetBackingOutput();
  updatePresetSaveButtonState();
});
presetBoundingSizePresetInput?.addEventListener("change", () => {
  syncPresetEditorDraftFromControls();
  updatePresetSaveButtonState();
});
presetGlobalHorizontalScaleInput?.addEventListener("input", () => {
  updatePresetGlobalHorizontalScaleOutput();
  updatePresetSaveButtonState();
});
presetGlobalVerticalScaleInput?.addEventListener("input", () => {
  updatePresetGlobalVerticalScaleOutput();
  updatePresetSaveButtonState();
});
presetWeldExportedDesignInput?.addEventListener("input", () => {
  updatePresetSaveButtonState();
});
newSizePresetButton?.addEventListener("click", startNewSizePresetDraft);
[sizePresetNameInput, sizePresetMaxWidthInput, sizePresetMaxHeightInput, sizePresetMinWidthInput, sizePresetMinHeightInput, sizePresetCircleDiameterInput]
  .forEach((input) => {
    input?.addEventListener("input", () => {
      renderSizePresetEditorPreview();
      renderSizePresetList();
      updateSizePresetSaveButtonState();
    });
  });
saveSizePresetButton?.addEventListener("click", () => {
  void saveSizePresetFromEditor();
});
cancelSizePresetButton?.addEventListener("click", cancelSizePresetEditorChanges);
deleteSizePresetButton?.addEventListener("click", () => {
  void deleteSelectedSizePreset();
});
presetLineRuleControls?.addEventListener("input", (event) => {
  updateRangeOutputForInput(event.target);
  updatePresetSaveButtonState();
});
presetLineRuleControls?.addEventListener("change", () => {
  updatePresetSaveButtonState();
});
presetFixedItemList?.addEventListener("input", (event) => {
  updateRangeOutputForInput(event.target);
  updatePresetSaveButtonState();
});
presetFixedItemList?.addEventListener("change", () => {
  updatePresetSaveButtonState();
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
  setNavCollapsed(!navCollapsed, { persist: true });
});

addOrderButton.addEventListener("click", addOrder);
importClipboardButton.addEventListener("click", importFromClipboard);
clearBatchButton.addEventListener("click", completeCurrentProductionBatch);
databaseOrdersSearchInput?.addEventListener("input", () => {
  databaseOrdersSearchTerm = databaseOrdersSearchInput.value;
  renderDatabaseOrdersWorkspace();
});
presetSearchInput?.addEventListener("input", () => {
  presetLibrarySearchTerm = presetSearchInput.value;
  const selectedPresetId = presetEditorDraft?.previousId && isValidPresetId(presetEditorDraft.previousId)
    ? presetEditorDraft.previousId
    : "";
  renderPresetLibraryRows(selectedPresetId);
});
databaseOrdersStatusFilter?.addEventListener("change", () => {
  databaseOrdersStatusFilterValue = databaseOrdersStatusFilter.value;
  selectedDatabaseOrderId = null;
  checkedDatabaseOrderIds.clear();
  invalidateDatabaseOrders();
  renderDatabaseOrdersWorkspace();
  void loadDatabaseOrders({ force: true });
});
databaseOrdersBatchFilter?.addEventListener("change", () => {
  databaseOrdersBatchFilterValue = databaseOrdersBatchFilter.value;
  renderDatabaseOrdersWorkspace();
});
addSelectedOrderToBatchButton?.addEventListener("click", () => {
  void addSelectedDatabaseOrderToBatch();
});
skipSelectedOrderButton?.addEventListener("click", () => {
  void skipSelectedDatabaseOrder();
});
reopenSelectedOrderButton?.addEventListener("click", () => {
  void reopenSelectedDatabaseOrder();
});
skipCheckedOrdersButton?.addEventListener("click", () => {
  void skipCheckedDatabaseOrders();
});
reopenCheckedOrdersButton?.addEventListener("click", () => {
  void reopenCheckedDatabaseOrders();
});
selectVisibleOrdersInput?.addEventListener("change", () => {
  const visibleOrderIds = getVisibleDatabaseOrders().map((order) => order.id);
  if (selectVisibleOrdersInput.checked) {
    visibleOrderIds.forEach((orderId) => checkedDatabaseOrderIds.add(orderId));
  } else {
    visibleOrderIds.forEach((orderId) => checkedDatabaseOrderIds.delete(orderId));
  }
  renderDatabaseOrdersWorkspace();
});
showColorCountsButton?.addEventListener("click", openBatchColorCountsDialog);
exportCompletedButton.addEventListener("click", exportAllOrders);
copyCompletedButton.addEventListener("click", copyAllOrders);
saveAsNewPresetButton?.addEventListener("click", () => {
  void saveActiveOrderAsNewPreset();
});
overwritePresetButton?.addEventListener("click", () => {
  void overwriteSelectedPresetFromActiveOrder();
});
assignPresetToListingButton?.addEventListener("click", () => {
  void assignSelectedPresetToActiveListing();
});
insertFixedDesignButton?.addEventListener("click", openInsertFixedDesignDialog);
insertFixedDesignSearchInput?.addEventListener("input", () => {
  insertFixedDesignSearchTerm = insertFixedDesignSearchInput.value;
  renderInsertFixedDesignPicker();
});
insertFixedDesignConfirmButton?.addEventListener("click", insertSelectedFixedDesignIntoActiveOrder);
cancelInsertFixedDesignButton?.addEventListener("click", closeInsertFixedDesignDialog);
closeInsertFixedDesignDialogButton?.addEventListener("click", closeInsertFixedDesignDialog);
insertFixedDesignDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeInsertFixedDesignDialog();
});
insertFixedDesignDialog?.addEventListener("click", (event) => {
  if (event.target === insertFixedDesignDialog) {
    closeInsertFixedDesignDialog();
  }
});
[addOrderButton, importClipboardButton, clearBatchButton, showColorCountsButton, exportCompletedButton, copyCompletedButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      batchToolsMenu?.removeAttribute("open");
    });
  });
[pasteOrdersButton, addCheckedOrdersToBatchButton, skipCheckedOrdersButton, reopenCheckedOrdersButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      ordersToolsMenu?.removeAttribute("open");
    });
  });
[addSelectedOrderToBatchButton, skipSelectedOrderButton, reopenSelectedOrderButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      selectedOrderActionsMenu?.removeAttribute("open");
    });
  });
[saveFixedDesignButton, loadFixedDesignVersionButton, downloadFixedDesignButton, deleteFixedDesignButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      fixedDesignActionsMenu?.removeAttribute("open");
    });
  });
[copyButton, downloadButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      editorToolsMenu?.removeAttribute("open");
    });
  });
[copyLayoutControlsButton, pasteLayoutControlsButton, insertFixedDesignButton, saveAsNewPresetButton, overwritePresetButton, assignPresetToListingButton, reloadPresetButton]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener("click", () => {
      presetToolsMenu?.removeAttribute("open");
    });
  });
registerOutsideDismissableDetailsMenu(batchToolsMenu);
registerOutsideDismissableDetailsMenu(ordersToolsMenu);
registerOutsideDismissableDetailsMenu(selectedOrderActionsMenu);
registerOutsideDismissableDetailsMenu(fixedDesignActionsMenu);
registerOutsideDismissableDetailsMenu(presetToolsMenu);
registerDatabaseOrderItemMenuDismissal(databaseOrdersWorkspace);
closeColorCountsButton?.addEventListener("click", closeBatchColorCountsDialog);
colorCountsDialog?.addEventListener("click", (event) => {
  if (event.target === colorCountsDialog) {
    closeBatchColorCountsDialog();
  }
});
closePasteSummaryButton?.addEventListener("click", closePasteSummaryDialog);
pasteSummaryDoneButton?.addEventListener("click", closePasteSummaryDialog);
pasteSummaryDialog?.addEventListener("click", (event) => {
  if (event.target === pasteSummaryDialog) {
    closePasteSummaryDialog();
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
savePresetAsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const presetName = savePresetAsNameInput?.value.trim() || "";
  if (!presetName) {
    setSavePresetAsStatus("Preset name is required.");
    savePresetAsNameInput?.focus();
    return;
  }

  finishSavePresetAsDialog(presetName);
});
savePresetAsCancelButton?.addEventListener("click", () => {
  finishSavePresetAsDialog(null);
});
savePresetAsCloseButton?.addEventListener("click", () => {
  finishSavePresetAsDialog(null);
});
savePresetAsDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishSavePresetAsDialog(null);
});
savePresetAsDialog?.addEventListener("click", (event) => {
  if (event.target === savePresetAsDialog) {
    finishSavePresetAsDialog(null);
  }
});
closePresetAssignmentDialogButton?.addEventListener("click", closePresetAssignmentDialog);
presetAssignmentDialog?.addEventListener("click", (event) => {
  if (event.target === presetAssignmentDialog) {
    closePresetAssignmentDialog();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!batchToolsMenu?.hasAttribute("open")) {
    if (!editorToolsMenu?.hasAttribute("open")) {
      return;
    }
  }

  if (event.target instanceof Node && batchToolsMenu?.hasAttribute("open") && batchToolsMenu.contains(event.target)) {
    return;
  }

  if (event.target instanceof Node && editorToolsMenu?.hasAttribute("open") && editorToolsMenu.contains(event.target)) {
    return;
  }

  batchToolsMenu?.removeAttribute("open");
  editorToolsMenu?.removeAttribute("open");
});
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", () => {
  captureActiveOrder();
});
cancelDesignButton?.addEventListener("click", cancelActiveOrderChanges);
completeNextButton.addEventListener("click", () => {
  captureActiveOrder({ advanceToNext: true });
});
downloadButton.addEventListener("click", downloadSvg);
copyButton.addEventListener("click", copyCurrentSvg);
copyLayoutControlsButton.addEventListener("click", copyActiveLayoutControls);
pasteLayoutControlsButton.addEventListener("click", pasteLayoutControlsIntoActiveOrder);
workflowAlertActionButton?.addEventListener("click", () => {
  if (typeof workflowAlertActionHandler === "function") {
    workflowAlertActionHandler();
  }
});
productionBatchSignInForm?.addEventListener("submit", (event) => {
  void handleProductionBatchSignInSubmit(event);
});
previewPanel.addEventListener("mousedown", startPreviewMiddlePan);
previewPanel.addEventListener("pointerdown", handlePreviewPointerDown);
previewPanel.addEventListener("pointermove", handlePreviewPointerMove);
previewPanel.addEventListener("pointerup", endPreviewPointerGesture);
previewPanel.addEventListener("pointercancel", endPreviewPointerGesture);
previewPanel.addEventListener("lostpointercapture", endPreviewPointerGesture);
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
window.addEventListener("popstate", () => {
  void applyCurrentAppRoute();
});
window.addEventListener("pagehide", () => {
  flushPersistBatchState({ keepalive: true });
});

setActiveWorkspace(activeWorkspace, { updateRoute: false });
setNavCollapsed(navCollapsed);
renderProductionBatchLogoutButton();
await checkFonts();
await loadPresetRegistry();
renderPresetOptions();
renderBoundingSizePresetOptions(boundingSizePresetInput);
renderBoundingSizePresetOptions(presetBoundingSizePresetInput);
renderSizePresetList();
renderSizePresetEditorPreview();
renderPresetEditorDraft();
updateBackingOutput();
productionBatchAccessToken = await bootstrapProductionBatchAccess();
await refreshWorkspaceFonts(productionBatchAccessToken);
if (initialAppRoute.workspace === "fixedDesigns") {
  await refreshWorkspaceFixedDesigns(productionBatchAccessToken);
}
const restoredBatch = productionBatchAccessToken
  ? await restoreInitialBatchState(productionBatchAccessToken)
  : { source: null, count: 0 };
if (productionBatchAccessToken && !fixedDesignsLoaded && restoredOrdersIncludeFixedSvgs()) {
  await refreshWorkspaceFixedDesigns(productionBatchAccessToken);
}
if (appRouteWriteCount === 0) {
  await applyCurrentAppRoute({
    replaceRoute: window.location.pathname === "/",
    route: initialAppRoute,
  });
}
if ((!restoredBatch.source || restoredBatch.count === 0) && workflowAlert.dataset.state !== "error") {
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
if (activeOrderItemId) {
  const activeOrder = getActiveOrder();
  if (activeOrder) {
    applySettings(activeOrder.settings);
  }
}
renderPreviewGuideOnly();
render();
renderOrderList();
hideInitialBatchLoading();
