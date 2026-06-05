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
  const lineCount = Math.max(textLines.length, configuredLines.length, 1);

  return Array.from({ length: lineCount }, (_, lineIndex) => ({
    text: textLines[lineIndex] ?? "",
    settings: configuredLines[lineIndex] && typeof configuredLines[lineIndex] === "object"
      ? configuredLines[lineIndex]
      : {},
  }));
}

function buildDesignLineRows(item, designId) {
  return buildLineInputs(item).map((line, lineIndex) => ({
    design_id: designId,
    line_index: lineIndex,
    text: line.text,
    font_id: line.settings.fontId || item?.fontId || "candlepin",
    letter_bridge_mm: toNumber(line.settings.bridgeMm, 0.5),
    line_bridge_mm: toNumber(line.settings.lineBridgeMm, 0.5),
    offset_x_mm: toNumber(line.settings.offsetXMm, 0),
    text_height_mm: toNumber(line.settings.fontSizeMm, 34),
    horizontal_scale: toNumber(line.settings.horizontalScale, 1),
    vertical_scale: toNumber(line.settings.verticalScale, 1),
    lock_text_height: Boolean(line.settings.lockTextHeight),
  }));
}

function normalizeDesignLine(row) {
  return {
    lineIndex: row.line_index,
    text: row.text ?? "",
    fontId: row.font_id || "candlepin",
    letterBridgeMm: toNumber(row.letter_bridge_mm, 0.5),
    lineBridgeMm: toNumber(row.line_bridge_mm, 0.5),
    offsetXMm: toNumber(row.offset_x_mm, 0),
    textHeightMm: toNumber(row.text_height_mm, 34),
    horizontalScale: toNumber(row.horizontal_scale, 1),
    verticalScale: toNumber(row.vertical_scale, 1),
    lockTextHeight: Boolean(row.lock_text_height),
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
      items: [],
    };
    groups.set(groupId, group);
  }

  group.items.push(orderItem);
  group.isInActiveBatch = group.isInActiveBatch || orderItem.isInActiveBatch;
  group.status = group.items.length > 0 && group.items.every((item) => item.status === "complete")
    ? "complete"
    : "open";
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

async function queryVerifiedOrderItemIds({ supabase, workspaceId, orderItemIds }) {
  const ids = [...new Set((orderItemIds || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("order_items")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .in("id", ids);

  if (error) {
    throw error;
  }

  const verifiedIds = new Set((data || []).map((item) => item.id));
  return ids.filter((id) => verifiedIds.has(id));
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
    .select("id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id, imported_color, quantity, source_json, revision, updated_at, updated_by")
    .eq("workspace_id", workspaceId);
  if (statusFilter === "complete") {
    orderItemsQuery = orderItemsQuery.eq("status", "complete");
  } else if (statusFilter !== "all") {
    orderItemsQuery = orderItemsQuery
      .neq("status", "complete")
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
      .select("design_id, line_index, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height")
      .in("design_id", designIds)
      .order("line_index", { ascending: true })
    : { data: [], error: null };

  if (designLinesError) {
    throw designLinesError;
  }

  const activeBatchItemIds = new Set(
    batchItems
      .filter((item) => item.status !== "archived")
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
  const existingItems = await queryBatchItems({ supabase, workspaceId, batchId });
  const activeIds = new Set(
    existingItems
      .filter((item) => item.status !== "archived")
      .map((item) => item.order_item_id),
  );
  const missingIds = ids.filter((id) => !activeIds.has(id));

  if (!missingIds.length) {
    return { addedOrderItemIds: [] };
  }

  const verifiedMissingIds = await queryVerifiedOrderItemIds({
    supabase,
    workspaceId,
    orderItemIds: missingIds,
  });

  if (!verifiedMissingIds.length) {
    return { addedOrderItemIds: [] };
  }

  const maxPosition = existingItems.reduce((max, item) => {
    const position = Number.parseInt(item.batch_position, 10);
    return Number.isInteger(position) && position > max ? position : max;
  }, -1);
  const rows = verifiedMissingIds.map((orderItemId, index) => ({
    workspace_id: workspaceId,
    batch_id: batchId,
    order_item_id: orderItemId,
    batch_position: maxPosition + index + 1,
    status: "active",
    added_by: userId || null,
  }));
  const { error } = await supabase
    .from("batch_items")
    .upsert(rows, { onConflict: "batch_id,order_item_id" });

  if (error) {
    throw error;
  }

  return { addedOrderItemIds: verifiedMissingIds };
}

export async function addOrderGroupsToProductionBatch({
  workspaceId,
  userId,
  batchId,
  orderIds,
}) {
  const requestedIds = new Set((orderIds || []).filter((id) => typeof id === "string" && id));
  if (!requestedIds.size) {
    return { addedOrderItemIds: [] };
  }

  const { orders } = await listWorkspaceOrders({ workspaceId, activeBatchId: batchId });
  const orderItemIds = orders
    .filter((order) => requestedIds.has(order.id) || requestedIds.has(order.orderNumber))
    .flatMap((order) => order.items.map((item) => item.id));

  return addOrderItemsToProductionBatch({ workspaceId, userId, batchId, orderItemIds });
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
