import { createSupabaseAdminClient } from "./supabase-admin.js";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value) {
  const text = normalizeString(value);
  return text || null;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeJsonValue(value, fallback = null) {
  return value && typeof value === "object" ? value : fallback;
}

function splitTextLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

function normalizeItemKind(kind) {
  return kind === "fixed_svg" || kind === "fixedSvg" ? "fixed_svg" : "text";
}

function isProtectedDesign(row) {
  if (!row || typeof row !== "object") {
    return false;
  }

  const protectedStatuses = new Set(["saved", "analysis_running", "export_ready", "exported"]);
  return protectedStatuses.has(row.production_status)
    || Boolean(normalizeString(row.saved_settings_signature))
    || Boolean(normalizeString(row.completed_settings_signature));
}

function buildImportedOrderItemId(item) {
  const source = item?.source && typeof item.source === "object" ? item.source : {};
  const explicitId = normalizeString(item?.id);
  if (explicitId) {
    return explicitId;
  }

  const transactionId = normalizeString(source.transactionId);
  if (transactionId) {
    return `transaction:${transactionId}`;
  }

  const fallbackParts = [
    normalizeString(source.orderNumber),
    normalizeString(source.listingId),
    normalizeString(source.buyerName),
    normalizeString(item?.text),
  ];
  return `fallback:${fallbackParts.join("|")}`;
}

function buildOrderItemRow(item, { workspaceId, userId }) {
  const source = item?.source && typeof item.source === "object" ? item.source : {};

  return {
    id: buildImportedOrderItemId(item),
    workspace_id: workspaceId,
    status: "open",
    order_number: nullableString(source.orderNumber),
    buyer_name: nullableString(source.buyerName),
    listing_id: nullableString(source.listingId),
    transaction_id: nullableString(source.transactionId),
    imported_color: nullableString(source.colorName),
    ship_by_date: nullableString(source.shipByDate),
    quantity: toPositiveInteger(source.quantity, 1),
    source_json: { ...source },
    revision: 1,
    updated_by: userId || null,
  };
}

function buildDesignRow(item, { workspaceId, userId }) {
  const settings = item?.settings && typeof item.settings === "object" ? item.settings : {};
  const text = item?.text ?? settings.text ?? "";

  return {
    workspace_id: workspaceId,
    order_item_id: buildImportedOrderItemId(item),
    design_text: String(text),
    preset_id: item?.presetId || settings.presetId || null,
    size_guide_id: settings.boundingSizePresetId || settings.sizeGuideId || null,
    backing_border_mm: toNumber(settings.backingMm, 3.1),
    weld_exported_design: settings.weldExportedDesign !== false,
    global_horizontal_scale: toNumber(settings.globalHorizontalScale, 1),
    global_vertical_scale: toNumber(settings.globalVerticalScale, 1),
    production_status: "draft",
    revision: 1,
    updated_by: userId || null,
  };
}

function buildLineInputs(item) {
  const settings = item?.settings && typeof item.settings === "object" ? item.settings : {};
  const textLines = splitTextLines(item?.text ?? settings.text ?? "");
  const configuredLines = Array.isArray(settings.lines) ? settings.lines : [];
  if (!configuredLines.length) {
    return Array.from({ length: Math.max(textLines.length, 1) }, (_, lineIndex) => ({
      text: textLines[lineIndex] ?? "",
      settings: {},
    }));
  }

  const inputs = [];
  let textLineIndex = 0;

  configuredLines.forEach((lineSettings) => {
    const settingsForLine = lineSettings && typeof lineSettings === "object" ? lineSettings : {};
    const itemKind = normalizeItemKind(settingsForLine.kind);
    inputs.push({
      text: itemKind === "text" ? textLines[textLineIndex++] ?? "" : "",
      settings: settingsForLine,
    });
  });

  while (textLineIndex < textLines.length) {
    inputs.push({
      text: textLines[textLineIndex] ?? "",
      settings: {},
    });
    textLineIndex += 1;
  }

  return inputs.length ? inputs : [{ text: "", settings: {} }];
}

function buildDesignLineRows(item, designId) {
  return buildLineInputs(item).map((line, lineIndex) => {
    const itemKind = normalizeItemKind(line.settings.kind);
    return {
      design_id: designId,
      line_index: lineIndex,
      item_kind: itemKind,
      text: itemKind === "text" ? line.text : "",
      font_id: line.settings.fontId || item?.fontId || "candlepin",
      letter_bridge_mm: toNumber(line.settings.bridgeMm, 0.5),
      line_bridge_mm: toNumber(line.settings.lineBridgeMm, 0.5),
      offset_x_mm: toNumber(line.settings.offsetXMm, 0),
      offset_y_mm: itemKind === "fixed_svg" ? toNumber(line.settings.offsetYMm, 0) : 0,
      text_height_mm: toNumber(line.settings.fontSizeMm, 34),
      horizontal_scale: toNumber(line.settings.horizontalScale, 1),
      vertical_scale: toNumber(line.settings.verticalScale, 1),
      lock_text_height: Boolean(line.settings.lockTextHeight),
      fixed_design_id: itemKind === "fixed_svg" ? nullableString(line.settings.fixedDesignId) : null,
      fixed_design_version: itemKind === "fixed_svg" ? toNumber(line.settings.fixedDesignVersion, null) : null,
      svg_size_mm: itemKind === "fixed_svg" ? toNumber(line.settings.svgSizeMm, 32) : 32,
      fixed_svg_backing_border: itemKind === "fixed_svg" ? Boolean(line.settings.backingBorder) : false,
    };
  });
}

function normalizeDesignLine(row) {
  return {
    lineIndex: row.line_index,
    kind: row.item_kind === "fixed_svg" ? "fixedSvg" : "text",
    text: row.text ?? "",
    fontId: row.font_id || "candlepin",
    letterBridgeMm: toNumber(row.letter_bridge_mm, 0.5),
    lineBridgeMm: toNumber(row.line_bridge_mm, 0.5),
    offsetXMm: toNumber(row.offset_x_mm, 0),
    offsetYMm: toNumber(row.offset_y_mm, 0),
    textHeightMm: toNumber(row.text_height_mm, 34),
    horizontalScale: toNumber(row.horizontal_scale, 1),
    verticalScale: toNumber(row.vertical_scale, 1),
    lockTextHeight: Boolean(row.lock_text_height),
    fixedDesignId: row.fixed_design_id ?? null,
    fixedDesignVersion: row.fixed_design_version == null ? null : toNumber(row.fixed_design_version, null),
    svgSizeMm: toNumber(row.svg_size_mm, 32),
    backingBorder: Boolean(row.fixed_svg_backing_border),
  };
}

function normalizeDesign(row, lines) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    orderItemId: row.order_item_id,
    text: row.design_text ?? "",
    presetId: row.preset_id ?? null,
    sizeGuideId: row.size_guide_id ?? null,
    backingBorderMm: toNumber(row.backing_border_mm, 3.1),
    weldExportedDesign: row.weld_exported_design !== false,
    globalHorizontalScale: toNumber(row.global_horizontal_scale, 1),
    globalVerticalScale: toNumber(row.global_vertical_scale, 1),
    productionStatus: row.production_status ?? "draft",
    cachedBuild: normalizeJsonValue(row.cached_build_json),
    previousCompletedBuild: normalizeJsonValue(row.previous_completed_build_json),
    savedSettingsSignature: nullableString(row.saved_settings_signature),
    completedSettingsSignature: nullableString(row.completed_settings_signature),
    analysisBadge: normalizeJsonValue(row.analysis_badge_json),
    revision: Number.isInteger(row.revision) ? row.revision : null,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
    lines,
  };
}

function normalizeOrderItem(row, { design, lines, activeBatchItemIds }) {
  const source = row.source_json && typeof row.source_json === "object" ? row.source_json : {};

  return {
    id: row.id,
    status: row.status ?? "active",
    orderNumber: row.order_number ?? null,
    buyerName: row.buyer_name ?? null,
    listingId: row.listing_id ?? null,
    transactionId: row.transaction_id ?? null,
    importedColor: row.imported_color ?? null,
    shipByDate: row.ship_by_date ?? null,
    quantity: toPositiveInteger(row.quantity, 1),
    source,
    revision: Number.isInteger(row.revision) ? row.revision : null,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
    isInActiveBatch: activeBatchItemIds.has(row.id),
    design: normalizeDesign(design, lines),
  };
}

function getOrderGroupId(orderItem) {
  return orderItem.orderNumber ? `order:${orderItem.orderNumber}` : `item:${orderItem.id}`;
}

function appendOrderItemToGroups(groups, orderItem) {
  const groupId = getOrderGroupId(orderItem);
  let group = groups.get(groupId);

  if (!group) {
    group = {
      id: groupId,
      orderNumber: orderItem.orderNumber,
      buyerName: orderItem.buyerName,
      status: "open",
      isInActiveBatch: false,
      shipByDate: orderItem.shipByDate,
      items: [],
    };
    groups.set(groupId, group);
  }

  group.items.push(orderItem);
  group.isInActiveBatch = group.isInActiveBatch || orderItem.isInActiveBatch;
  if (orderItem.shipByDate && (!group.shipByDate || orderItem.shipByDate < group.shipByDate)) {
    group.shipByDate = orderItem.shipByDate;
  }
  if (group.items.length > 0 && group.items.every((item) => item.status === "complete")) {
    group.status = "complete";
  } else if (group.items.length > 0 && group.items.every((item) => item.status === "skipped")) {
    group.status = "skipped";
  } else {
    group.status = "open";
  }
}

async function queryBatchItems({ supabase, workspaceId, batchId }) {
  if (!batchId) {
    return [];
  }

  const { data, error } = await supabase
    .from("batch_items")
    .select("order_item_id, batch_position, status")
    .eq("workspace_id", workspaceId)
    .eq("batch_id", batchId);

  if (error) {
    throw error;
  }

  return data || [];
}

async function queryExistingOrderItemIds({ supabase, workspaceId, orderItemIds }) {
  const ids = [...new Set((orderItemIds || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) {
    return new Set();
  }

  const { data, error } = await supabase
    .from("order_items")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  if (error) {
    throw error;
  }

  return new Set((data || []).map((item) => item.id));
}

export async function listWorkspaceOrders({ workspaceId, activeBatchId = null, statusFilter = "open" }) {
  const supabase = createSupabaseAdminClient();
  let orderItemsQuery = supabase
    .from("order_items")
    .select("id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id, imported_color, ship_by_date, quantity, source_json, revision, updated_at, updated_by")
    .eq("workspace_id", workspaceId);
  if (statusFilter === "complete") {
    orderItemsQuery = orderItemsQuery.eq("status", "complete");
  } else if (statusFilter === "skipped") {
    orderItemsQuery = orderItemsQuery.eq("status", "skipped");
  } else if (statusFilter !== "all") {
    orderItemsQuery = orderItemsQuery
      .neq("status", "complete")
      .neq("status", "skipped")
      .neq("status", "archived");
  }
  orderItemsQuery = orderItemsQuery
    .order("order_number", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: orderItems, error: orderItemsError } = await orderItemsQuery;

  if (orderItemsError) {
    throw orderItemsError;
  }

  const itemRows = orderItems || [];
  if (!itemRows.length) {
    return { orders: [] };
  }

  const orderItemIds = itemRows.map((item) => item.id);
  const [
    { data: designs, error: designsError },
    batchItems,
  ] = await Promise.all([
    supabase
      .from("designs")
      .select("id, workspace_id, order_item_id, design_text, preset_id, size_guide_id, backing_border_mm, weld_exported_design, global_horizontal_scale, global_vertical_scale, production_status, cached_build_json, previous_completed_build_json, saved_settings_signature, completed_settings_signature, analysis_badge_json, revision, updated_at, updated_by")
      .eq("workspace_id", workspaceId)
      .in("order_item_id", orderItemIds),
    queryBatchItems({ supabase, workspaceId, batchId: activeBatchId }),
  ]);

  if (designsError) {
    throw designsError;
  }

  const designRows = designs || [];
  const designIds = designRows.map((design) => design.id);
  const { data: designLines, error: designLinesError } = designIds.length
    ? await supabase
      .from("design_lines")
      .select("design_id, line_index, item_kind, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, offset_y_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height, fixed_design_id, fixed_design_version, svg_size_mm, fixed_svg_backing_border")
      .in("design_id", designIds)
      .order("line_index", { ascending: true })
    : { data: [], error: null };

  if (designLinesError) {
    throw designLinesError;
  }

  const activeBatchItemIds = new Set(
    batchItems
      .filter((item) => item.status === "active")
      .map((item) => item.order_item_id),
  );
  const designsByOrderItemId = new Map(designRows.map((design) => [design.order_item_id, design]));
  const linesByDesignId = new Map();
  for (const line of designLines || []) {
    const lines = linesByDesignId.get(line.design_id) || [];
    lines.push(normalizeDesignLine(line));
    linesByDesignId.set(line.design_id, lines);
  }

  const groups = new Map();
  for (const row of itemRows) {
    const design = designsByOrderItemId.get(row.id) || null;
    const lines = design ? linesByDesignId.get(design.id) || [] : [];
    appendOrderItemToGroups(groups, normalizeOrderItem(row, { design, lines, activeBatchItemIds }));
  }

  return { orders: Array.from(groups.values()) };
}

export async function addOrderItemsToProductionBatch({
  workspaceId,
  userId,
  batchId,
  orderItemIds,
}) {
  const ids = [...new Set((orderItemIds || []).filter((id) => typeof id === "string" && id))];
  if (!batchId || !ids.length) {
    return { addedOrderItemIds: [] };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("add_order_items_to_production_batch", {
    p_workspace_id: workspaceId,
    p_user_id: userId || null,
    p_batch_id: batchId,
    p_order_item_ids: ids,
  });

  if (error) {
    throw error;
  }

  return {
    addedOrderItemIds: (data || [])
      .map((row) => row?.added_order_item_id ?? row?.order_item_id)
      .filter((id) => typeof id === "string" && id),
  };
}

async function queryOrderItemIdsForGroups({ supabase, workspaceId, orderIds, eligibleStatuses = ["open", "complete", "skipped"] }) {
  const normalizedIds = [...new Set((orderIds || []).filter((id) => typeof id === "string" && id))];
  const orderNumbers = normalizedIds
    .filter((id) => id.startsWith("order:"))
    .map((id) => id.slice("order:".length))
    .filter(Boolean);
  const itemIds = normalizedIds
    .filter((id) => id.startsWith("item:"))
    .map((id) => id.slice("item:".length))
    .filter(Boolean);
  const queries = [];

  if (orderNumbers.length) {
    queries.push(
      supabase
        .from("order_items")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("status", eligibleStatuses)

        .in("order_number", orderNumbers),
    );
  }
  if (itemIds.length) {
    queries.push(
      supabase
        .from("order_items")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("status", eligibleStatuses)

        .in("id", itemIds),
    );
  }

  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw failed.error;
  }

  return [...new Set(results.flatMap((result) => (result.data || []).map((row) => row.id)))];
}

export async function addOrderGroupsToProductionBatch({
  workspaceId,
  userId,
  batchId,
  orderIds,
}) {
  const normalizedIds = [...new Set((orderIds || []).filter((id) => typeof id === "string" && id))];
  if (!normalizedIds.length) {
    return { addedOrderItemIds: [] };
  }

  const supabase = createSupabaseAdminClient();
  const orderItemIds = await queryOrderItemIdsForGroups({
    supabase,
    workspaceId,
    orderIds: normalizedIds,
  });

  return addOrderItemsToProductionBatch({ workspaceId, userId, batchId, orderItemIds });
}

function getOrderItemsForStatusUpdate(order, status) {
  return (Array.isArray(order?.items) ? order.items : [])
    .filter((item) => {
      if (!item?.id) {
        return false;
      }
      if (status === "skipped") {
        return item.status !== "skipped" && item.status !== "complete";
      }
      return item.status === "skipped";
    })
    .map((item) => item.id);
}

async function clearActiveProductionBatchSelectionsForOrderItems({
  supabase,
  workspaceId,
  userId,
  orderItemIds,
  savedAt,
}) {
  const ids = Array.isArray(orderItemIds)
    ? orderItemIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  if (!ids.length) {
    return;
  }

  const { error } = await supabase
    .from("production_batches")
    .update({
      active_order_item_id: null,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("workspace_id", workspaceId)
    .in("active_order_item_id", ids);

  if (error) {
    throw error;
  }
}

export async function updateOrderItemStatus({
  workspaceId,
  userId,
  orderItemId,
  status,
}) {
  const normalizedOrderItemId = normalizeString(orderItemId);
  const normalizedStatus = normalizeString(status);
  if (!normalizedOrderItemId || !["open", "skipped"].includes(normalizedStatus)) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const savedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("order_items")
    .update({
      status: normalizedStatus,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", normalizedOrderItemId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  if (normalizedStatus === "skipped") {
    await clearActiveProductionBatchSelectionsForOrderItems({
      supabase,
      workspaceId,
      userId,
      orderItemIds: [normalizedOrderItemId],
      savedAt,
    });

    const { error: batchItemsError } = await supabase
      .from("batch_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("order_item_id", normalizedOrderItemId);

    if (batchItemsError) {
      throw batchItemsError;
    }
  }

  return {
    orderItemId: data.id,
    status: data.status,
  };
}

export async function updateOrderGroupStatus({
  workspaceId,
  userId,
  orderId,
  status,
}) {
  const normalizedOrderId = normalizeString(orderId);
  const normalizedStatus = normalizeString(status);
  if (!normalizedOrderId || !["open", "skipped"].includes(normalizedStatus)) {
    return { orderItemIds: [], status: normalizedStatus || null };
  }

  const { orders } = await listWorkspaceOrders({
    workspaceId,
    activeBatchId: null,
    statusFilter: "all",
  });
  const order = orders.find((candidate) => (
    candidate.id === normalizedOrderId
    || candidate.orderNumber === normalizedOrderId
  ));
  const orderItemIds = getOrderItemsForStatusUpdate(order, normalizedStatus);

  if (!orderItemIds.length) {
    return { orderItemIds: [], status: normalizedStatus };
  }

  const supabase = createSupabaseAdminClient();
  const savedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("order_items")
    .update({
      status: normalizedStatus,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("workspace_id", workspaceId)
    .in("id", orderItemIds)
    .select("id, status");

  if (error) {
    throw error;
  }

  if (normalizedStatus === "skipped") {
    await clearActiveProductionBatchSelectionsForOrderItems({
      supabase,
      workspaceId,
      userId,
      orderItemIds,
      savedAt,
    });

    const { error: batchItemsError } = await supabase
      .from("batch_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("order_item_id", orderItemIds);

    if (batchItemsError) {
      throw batchItemsError;
    }
  }

  return {
    orderItemIds: (data || []).map((item) => item.id),
    status: normalizedStatus,
  };
}

export async function updateOrderGroupsStatus({
  workspaceId,
  userId,
  orderIds,
  status,
}) {
  const requestedIds = new Set((orderIds || []).filter((id) => typeof id === "string" && id));
  const normalizedStatus = normalizeString(status);
  if (!requestedIds.size || !["open", "skipped"].includes(normalizedStatus)) {
    return { orderItemIds: [], status: normalizedStatus || null };
  }

  const supabase = createSupabaseAdminClient();
  const orderItemIds = await queryOrderItemIdsForGroups({
    supabase,
    workspaceId,
    orderIds: [...requestedIds],
    eligibleStatuses: normalizedStatus === "skipped" ? ["open"] : ["skipped"],
  });

  if (!orderItemIds.length) {
    return { orderItemIds: [], status: normalizedStatus };
  }

  const savedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("order_items")
    .update({
      status: normalizedStatus,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("workspace_id", workspaceId)
    .in("id", orderItemIds)
    .select("id, status");

  if (error) {
    throw error;
  }

  if (normalizedStatus === "skipped") {
    await clearActiveProductionBatchSelectionsForOrderItems({
      supabase,
      workspaceId,
      userId,
      orderItemIds,
      savedAt,
    });

    const { error: batchItemsError } = await supabase
      .from("batch_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("order_item_id", orderItemIds);

    if (batchItemsError) {
      throw batchItemsError;
    }
  }

  return {
    orderItemIds: (data || []).map((item) => item.id),
    status: normalizedStatus,
  };
}

export async function importWorkspaceOrderItems({
  workspaceId,
  userId,
  items,
  target = "orders",
  batchId = null,
}) {
  const importItems = Array.isArray(items) ? items : [];
  if (!importItems.length) {
    return {
      orders: [],
      importedOrderItemIds: [],
      importedCount: 0,
      addedToBatchCount: 0,
      addedOrderItemIds: [],
    };
  }

  if (target === "productionBatch" && !batchId) {
    throw new Error("batchId is required when importing to a production batch.");
  }

  const supabase = createSupabaseAdminClient();
  const orderRows = importItems.map((item) => buildOrderItemRow(item, { workspaceId, userId }));
  const requestedOrderItemIds = orderRows.map((row) => row.id);
  const existingOrderItemIds = await queryExistingOrderItemIds({
    supabase,
    workspaceId,
    orderItemIds: requestedOrderItemIds,
  });
  const existingShipDateUpdates = orderRows.filter((row) => (
    existingOrderItemIds.has(row.id) && row.ship_by_date
  ));
  const shipDateUpdateResults = await Promise.all(existingShipDateUpdates.map((row) => (
    supabase
      .from("order_items")
      .update({ ship_by_date: row.ship_by_date })
      .eq("workspace_id", workspaceId)
      .eq("id", row.id)
  )));
  const shipDateUpdateError = shipDateUpdateResults.find((result) => result?.error)?.error;
  if (shipDateUpdateError) {
    throw shipDateUpdateError;
  }

  const newOrderRows = orderRows.filter((row) => !existingOrderItemIds.has(row.id));

  if (newOrderRows.length) {
    const { error: orderItemsError } = await supabase
      .from("order_items")
      .upsert(newOrderRows, { onConflict: "id" });

    if (orderItemsError) {
      throw orderItemsError;
    }
  }

  const importedOrderItemIds = newOrderRows.map((row) => row.id);
  const { data: existingDesigns, error: existingDesignsError } = await supabase
    .from("designs")
    .select("id, order_item_id, production_status, saved_settings_signature, completed_settings_signature")
    .eq("workspace_id", workspaceId)
    .in("order_item_id", requestedOrderItemIds);

  if (existingDesignsError) {
    throw existingDesignsError;
  }

  const existingDesignByOrderItemId = new Map((existingDesigns || []).map((design) => [design.order_item_id, design]));
  const mutableItems = importItems.filter((item) => {
    const orderItemId = buildImportedOrderItemId(item);
    return importedOrderItemIds.includes(orderItemId)
      && !isProtectedDesign(existingDesignByOrderItemId.get(orderItemId));
  });
  const designRows = mutableItems.map((item) => buildDesignRow(item, { workspaceId, userId }));
  let savedDesigns = [];

  if (designRows.length) {
    const { data, error: designsError } = await supabase
      .from("designs")
      .upsert(designRows, { onConflict: "order_item_id" })
      .select("id, order_item_id");

    if (designsError) {
      throw designsError;
    }

    savedDesigns = data || [];
  }

  const designIdByOrderItemId = new Map([
    ...(existingDesigns || []).map((design) => [design.order_item_id, design.id]),
    ...savedDesigns.map((design) => [design.order_item_id, design.id]),
  ]);
  const mutableOrderItemIds = new Set(mutableItems.map((item) => buildImportedOrderItemId(item)));
  const lineRows = mutableItems.flatMap((item) => {
    const orderItemId = buildImportedOrderItemId(item);
    const designId = designIdByOrderItemId.get(orderItemId);
    return designId ? buildDesignLineRows(item, designId) : [];
  });
  const savedDesignIds = [...designIdByOrderItemId]
    .filter(([orderItemId]) => mutableOrderItemIds.has(orderItemId))
    .map(([, designId]) => designId);

  if (savedDesignIds.length) {
    const { error: deleteLinesError } = await supabase
      .from("design_lines")
      .delete()
      .in("design_id", savedDesignIds);

    if (deleteLinesError) {
      throw deleteLinesError;
    }
  }

  if (lineRows.length) {
    const { error: linesError } = await supabase
      .from("design_lines")
      .upsert(lineRows, { onConflict: "design_id,line_index" });

    if (linesError) {
      throw linesError;
    }
  }

  let addedOrderItemIds = [];
  if (target === "productionBatch") {
    const addResult = await addOrderItemsToProductionBatch({
      workspaceId,
      userId,
      batchId,
      orderItemIds: requestedOrderItemIds,
    });
    addedOrderItemIds = Array.isArray(addResult?.addedOrderItemIds) ? addResult.addedOrderItemIds : [];
  }

  const ordersPayload = await listWorkspaceOrders({
    workspaceId,
    activeBatchId: target === "productionBatch" ? batchId : null,
  });

  return {
    ...ordersPayload,
    importedOrderItemIds,
    importedCount: importedOrderItemIds.length,
    addedToBatchCount: target === "productionBatch" ? addedOrderItemIds.length : 0,
    addedOrderItemIds,
  };
}

