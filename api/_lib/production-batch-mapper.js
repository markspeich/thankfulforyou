function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeJsonValue(value, fallback) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value == null ? fallback : value;
}

function normalizeNullableJsonValue(value) {
  return value == null ? null : value;
}

function normalizeStringValue(value) {
  return typeof value === "string" && value ? value : null;
}

function normalizeItemKind(kind) {
  return kind === "fixed_svg" || kind === "fixedSvg" ? "fixed_svg" : "text";
}

function mapRowItemKindToSettingsKind(kind) {
  return kind === "fixed_svg" ? "fixedSvg" : "text";
}

function splitDesignTextLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

function mapDesignStatusToProductionStatus(status) {
  switch (status) {
    case "captured":
      return "saved";
    case "exported":
      return "exported";
    case "in-progress":
      return "in_progress";
    case "not-started":
    default:
      return "draft";
  }
}

function mapProductionStatusToDesignStatus(status) {
  switch (status) {
    case "saved":
    case "export_ready":
      return "captured";
    case "exported":
      return "exported";
    case "analysis_running":
    case "in_progress":
      return "in-progress";
    case "draft":
    default:
      return "not-started";
  }
}

function buildOrderItemRow(orderItem, { workspaceId, updatedBy }) {
  const source = orderItem?.source && typeof orderItem.source === "object" ? orderItem.source : {};

  return {
    id: orderItem.id,
    workspace_id: workspaceId,
    status: "open",
    order_number: source.orderNumber || null,
    buyer_name: source.buyerName || null,
    listing_id: source.listingId || null,
    transaction_id: source.transactionId || null,
    imported_color: source.colorName || null,
    quantity: toPositiveInteger(source.quantity, 1),
    source_json: { ...source },
    revision: Number.isInteger(orderItem.revision) ? orderItem.revision : 1,
    updated_by: updatedBy || null,
    updated_at: orderItem.updatedAt || undefined,
  };
}

function buildDesignRow(orderItem, { workspaceId, updatedBy }) {
  const settings = orderItem?.settings && typeof orderItem.settings === "object" ? orderItem.settings : {};

  return {
    workspace_id: workspaceId,
    order_item_id: orderItem.id,
    design_text: orderItem.text ?? settings.text ?? "",
    preset_id: settings.presetId || null,
    size_guide_id: settings.boundingSizePresetId || null,
    backing_border_mm: toNumber(settings.backingMm, 3.1),
    weld_exported_design: settings.weldExportedDesign !== false,
    global_horizontal_scale: toNumber(settings.globalHorizontalScale, 1),
    global_vertical_scale: toNumber(settings.globalVerticalScale, 1),
    production_status: mapDesignStatusToProductionStatus(orderItem.status),
    cached_build_json: normalizeNullableJsonValue(orderItem.cachedBuild),
    previous_completed_build_json: normalizeNullableJsonValue(orderItem.previousCompletedBuild),
    saved_settings_signature: normalizeStringValue(orderItem.savedSettingsSignature),
    completed_settings_signature: normalizeStringValue(orderItem.completedSettingsSignature),
    analysis_badge_json: normalizeNullableJsonValue(orderItem.analysisBadge),
    pending_analysis_signature: normalizeStringValue(orderItem.pendingAnalysisSignature),
    revision: Number.isInteger(orderItem.revision) ? orderItem.revision : 1,
    updated_by: updatedBy || null,
    updated_at: orderItem.updatedAt || undefined,
  };
}

function buildDesignLineRows(orderItem) {
  const settings = orderItem?.settings && typeof orderItem.settings === "object" ? orderItem.settings : {};
  const textLines = splitDesignTextLines(orderItem.text ?? settings.text ?? "");
  const lines = Array.isArray(settings.lines) ? settings.lines : [];
  let textLineIndex = 0;

  return lines.map((line, lineIndex) => {
    const itemKind = normalizeItemKind(line.kind);
    const text = itemKind === "text" ? textLines[textLineIndex++] ?? "" : "";

    return {
      order_item_id: orderItem.id,
      line_index: lineIndex,
      item_kind: itemKind,
      text,
      font_id: line.fontId || "candlepin",
      letter_bridge_mm: toNumber(line.bridgeMm, 0.5),
      line_bridge_mm: toNumber(line.lineBridgeMm, 0.5),
      offset_x_mm: toNumber(line.offsetXMm, 0),
      offset_y_mm: toNumber(line.offsetYMm, 0),
      text_height_mm: toNumber(line.fontSizeMm, 34),
      horizontal_scale: toNumber(line.horizontalScale, 1),
      vertical_scale: toNumber(line.verticalScale, 1),
      lock_text_height: Boolean(line.lockTextHeight),
      fixed_design_id: itemKind === "fixed_svg" ? normalizeStringValue(line.fixedDesignId) : null,
      fixed_design_version: itemKind === "fixed_svg" ? toNumber(line.fixedDesignVersion, null) : null,
      svg_size_mm: itemKind === "fixed_svg" ? toNumber(line.svgSizeMm, 32) : 32,
    };
  });
}

export function buildProductionBatchRowsFromSnapshot(snapshot, options = {}) {
  const workspaceId = options.workspaceId || snapshot?.batch?.workspaceId || null;
  const updatedBy = options.updatedBy || null;
  const orderItems = Array.isArray(snapshot?.orderItems) ? snapshot.orderItems : [];

  return {
    batch: {
      id: snapshot?.batch?.id || null,
      workspace_id: workspaceId,
      name: snapshot?.batch?.name ?? null,
      status: snapshot?.batch?.status ?? "active",
      active_order_item_id: snapshot?.activeOrderItemId ?? null,
      revision: Number.isInteger(snapshot?.batch?.revision) ? snapshot.batch.revision : 1,
      updated_by: updatedBy,
    },
    batchItems: orderItems.map((orderItem, index) => ({
      workspace_id: workspaceId,
      batch_id: snapshot?.batch?.id || null,
      order_item_id: orderItem.id,
      batch_position: index,
      status: "active",
      added_by: updatedBy,
    })),
    orderItems: orderItems.map((orderItem) => buildOrderItemRow(orderItem, { workspaceId, updatedBy })),
    designs: orderItems.map((orderItem) => buildDesignRow(orderItem, { workspaceId, updatedBy })),
    designLines: orderItems.flatMap((orderItem) => buildDesignLineRows(orderItem)),
  };
}

function buildSource(orderItem) {
  const sourceJson = normalizeJsonValue(orderItem.source_json, {});
  return {
    orderNumber: orderItem.order_number || sourceJson.orderNumber || "",
    listingId: orderItem.listing_id || sourceJson.listingId || "",
    transactionId: orderItem.transaction_id || sourceJson.transactionId || "",
    buyerName: orderItem.buyer_name || sourceJson.buyerName || "",
    colorName: orderItem.imported_color || sourceJson.colorName || "",
    quantity: orderItem.quantity == null ? sourceJson.quantity || "" : String(orderItem.quantity),
    ...sourceJson,
  };
}

function buildOrderItemFromRows({ orderItem, design, designLines }) {
  const orderedLines = [...designLines].sort((first, second) => first.line_index - second.line_index);

  return {
    id: orderItem.id,
    revision: Number.isInteger(orderItem.revision) ? orderItem.revision : null,
    updatedAt: orderItem.updated_at ?? null,
    updatedBy: orderItem.updated_by ? { id: orderItem.updated_by } : null,
    text: design?.design_text ?? "",
    status: mapProductionStatusToDesignStatus(design?.production_status),
    cachedBuild: normalizeJsonValue(design?.cached_build_json, null),
    previousCompletedBuild: normalizeJsonValue(design?.previous_completed_build_json, null),
    savedSettingsSignature: normalizeStringValue(design?.saved_settings_signature),
    completedSettingsSignature: normalizeStringValue(design?.completed_settings_signature),
    analysisBadge: normalizeJsonValue(design?.analysis_badge_json, null),
    pendingAnalysisSignature: normalizeStringValue(design?.pending_analysis_signature),
    source: buildSource(orderItem),
    settings: {
      text: design?.design_text ?? "",
      presetId: design?.preset_id ?? null,
      boundingSizePresetId: design?.size_guide_id ?? null,
      backingMm: toNumber(design?.backing_border_mm, 3.1),
      weldExportedDesign: design?.weld_exported_design !== false,
      globalHorizontalScale: toNumber(design?.global_horizontal_scale, 1),
      globalVerticalScale: toNumber(design?.global_vertical_scale, 1),
      lines: orderedLines.map((line) => {
        if (line.item_kind === "fixed_svg") {
          return {
            kind: "fixedSvg",
            fixedDesignId: line.fixed_design_id ?? null,
            fixedDesignVersion: toNumber(line.fixed_design_version, null),
            svgSizeMm: toNumber(line.svg_size_mm, 32),
            offsetXMm: toNumber(line.offset_x_mm, 0),
            offsetYMm: toNumber(line.offset_y_mm, 0),
          };
        }

        const settings = {
          fontId: line.font_id || "candlepin",
          bridgeMm: toNumber(line.letter_bridge_mm, 0.5),
          lineBridgeMm: toNumber(line.line_bridge_mm, 0.5),
          offsetXMm: toNumber(line.offset_x_mm, 0),
          fontSizeMm: toNumber(line.text_height_mm, 34),
          horizontalScale: toNumber(line.horizontal_scale, 1),
          verticalScale: toNumber(line.vertical_scale, 1),
          lockTextHeight: Boolean(line.lock_text_height),
        };
        return line.item_kind ? { kind: mapRowItemKindToSettingsKind(line.item_kind), ...settings } : settings;
      }),
    },
  };
}

export function buildSnapshotFromProductionBatchRows({
  batch,
  batchItems = [],
  orderItems = [],
  designs = [],
  designLines = [],
} = {}) {
  if (!batch) {
    return null;
  }

  const orderItemById = new Map(orderItems.map((orderItem) => [orderItem.id, orderItem]));
  const designByOrderItemId = new Map(designs.map((design) => [design.order_item_id, design]));
  const designLinesByDesignId = new Map();

  for (const line of designLines) {
    const existing = designLinesByDesignId.get(line.design_id) || [];
    existing.push(line);
    designLinesByDesignId.set(line.design_id, existing);
  }

  const orderedBatchItems = [...batchItems]
    .filter((batchItem) => batchItem?.status !== "archived")
    .sort((first, second) => first.batch_position - second.batch_position);
  const restoredOrderItems = orderedBatchItems.flatMap((batchItem) => {
    const orderItem = orderItemById.get(batchItem.order_item_id);
    const design = designByOrderItemId.get(batchItem.order_item_id);

    if (!orderItem || !design) {
      return [];
    }

    return buildOrderItemFromRows({
      orderItem,
      design,
      designLines: designLinesByDesignId.get(design.id) || [],
    });
  });

  return {
    batch: {
      id: batch.id,
      workspaceId: batch.workspace_id,
      name: batch.name ?? null,
      status: batch.status ?? null,
      revision: Number.isInteger(batch.revision) ? batch.revision : null,
      updatedAt: batch.updated_at ?? null,
    },
    activeOrderItemId: batch.active_order_item_id ?? null,
    orderItems: restoredOrderItems,
  };
}
