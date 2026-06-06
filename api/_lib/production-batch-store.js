import { createSupabaseAdminClient } from "./supabase-admin.js";
import {
  buildProductionBatchRowsFromSnapshot,
  buildSnapshotFromProductionBatchRows,
} from "./production-batch-mapper.js";

function createSharedSessionAccessError() {
  return Object.assign(new Error("Shared workspace access denied."), {
    code: "SHARED_SESSION_FORBIDDEN",
    statusCode: 403,
    expose: true,
  });
}

function normalizeBatchRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name ?? null,
    status: row.status ?? null,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

export async function loadProductionBatch({ batchId, workspaceId }) {
  const supabase = createSupabaseAdminClient();
  const { data: batch, error: batchError } = await supabase
    .from("production_batches")
    .select("id, workspace_id, name, status, active_order_item_id, revision, updated_at, updated_by")
    .eq("id", batchId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (batchError) {
    throw batchError;
  }

  if (!batch) {
    return null;
  }

  const { data: batchItems, error: batchItemsError } = await supabase
    .from("batch_items")
    .select("order_item_id, batch_position, status")
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("batch_position", { ascending: true });

  if (batchItemsError) {
    throw batchItemsError;
  }

  const orderItemIds = (batchItems || []).map((item) => item.order_item_id);
  if (!orderItemIds.length) {
    return buildSnapshotFromProductionBatchRows({ batch, batchItems: [], orderItems: [], designs: [], designLines: [] });
  }

  const [
    { data: orderItems, error: orderItemsError },
    { data: designs, error: designsError },
  ] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id, imported_color, quantity, source_json, revision, updated_at, updated_by")
      .in("id", orderItemIds),
    supabase
      .from("designs")
      .select("id, workspace_id, order_item_id, design_text, preset_id, size_guide_id, backing_border_mm, weld_exported_design, global_horizontal_scale, global_vertical_scale, production_status, cached_build_json, previous_completed_build_json, saved_settings_signature, completed_settings_signature, analysis_badge_json, pending_analysis_signature, revision, updated_at, updated_by")
      .in("order_item_id", orderItemIds),
  ]);

  if (orderItemsError) {
    throw orderItemsError;
  }

  if (designsError) {
    throw designsError;
  }

  const designIds = (designs || []).map((design) => design.id);
  const { data: designLines, error: designLinesError } = designIds.length
    ? await supabase
      .from("design_lines")
      .select("design_id, line_index, item_kind, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, offset_y_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height, fixed_design_id, fixed_design_version, svg_size_mm")
      .in("design_id", designIds)
      .order("line_index", { ascending: true })
    : { data: [], error: null };

  if (designLinesError) {
    throw designLinesError;
  }

  return buildSnapshotFromProductionBatchRows({
    batch,
    batchItems,
    orderItems,
    designs,
    designLines,
  });
}

export async function getSessionContext(auth) {
  const supabase = createSupabaseAdminClient();

  const [
    { data: membership, error: membershipError },
    { data: workspace, error: workspaceError },
    { data: batch, error: batchError },
    { data: userData, error: userError },
  ] = await Promise.all([
    supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("workspace_id", auth.workspaceId)
      .eq("user_id", auth.userId)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", auth.workspaceId)
      .maybeSingle(),
    supabase
      .from("production_batches")
      .select("id, workspace_id, name, status, updated_at, updated_by")
      .eq("workspace_id", auth.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.auth.admin.getUserById(auth.userId),
  ]);

  if (membershipError) {
    throw membershipError;
  }

  if (!membership) {
    throw createSharedSessionAccessError();
  }

  if (workspaceError) {
    throw workspaceError;
  }

  if (!workspace) {
    throw createSharedSessionAccessError();
  }

  if (batchError) {
    throw batchError;
  }

  if (userError) {
    throw userError;
  }

  return {
    operator: {
      id: userData?.user?.id || auth.userId,
      email: userData?.user?.email ?? null,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name ?? null,
    },
    batch: normalizeBatchRow(batch),
  };
}

export async function saveProductionBatch({ snapshot, userId, changedOrderItemIds = null }) {
  const supabase = createSupabaseAdminClient();
  const rows = buildProductionBatchRowsFromSnapshot(snapshot, {
    workspaceId: snapshot.batch.workspaceId,
    updatedBy: userId,
  });

  const changedOrderItemIdSet = Array.isArray(changedOrderItemIds)
    ? new Set(changedOrderItemIds.filter((value) => typeof value === "string" && value))
    : null;
  const shouldSaveOrderItem = (orderItemId) => !changedOrderItemIdSet || changedOrderItemIdSet.has(orderItemId);
  const savedAt = new Date().toISOString();
  const nextOrderItems = rows.orderItems.filter((orderItem) => shouldSaveOrderItem(orderItem.id)).map((orderItem) => ({
    ...orderItem,
    revision: Number.isInteger(orderItem.revision) ? orderItem.revision + 1 : 1,
    updated_at: savedAt,
  }));
  let nextDesigns = rows.designs.filter((design) => shouldSaveOrderItem(design.order_item_id)).map((design) => ({
    ...design,
    revision: Number.isInteger(design.revision) ? design.revision + 1 : 1,
    updated_at: savedAt,
  }));

  const referencedSizeGuideIds = [...new Set(nextDesigns
    .map((design) => design.size_guide_id)
    .filter((sizeGuideId) => typeof sizeGuideId === "string" && sizeGuideId))];
  if (referencedSizeGuideIds.length) {
    const { data: existingSizeGuides, error: sizeGuidesError } = await supabase
      .from("size_guides")
      .select("id")
      .eq("workspace_id", snapshot.batch.workspaceId)
      .in("id", referencedSizeGuideIds);

    if (sizeGuidesError) {
      throw sizeGuidesError;
    }

    const validSizeGuideIds = new Set((existingSizeGuides || []).map((guide) => guide.id));
    nextDesigns = nextDesigns.map((design) => ({
      ...design,
      size_guide_id: !design.size_guide_id || validSizeGuideIds.has(design.size_guide_id)
        ? design.size_guide_id
        : null,
    }));
  }

  if (nextOrderItems.length) {
    const { error: orderItemsError } = await supabase
      .from("order_items")
      .upsert(nextOrderItems, { onConflict: "id" });

    if (orderItemsError) {
      throw orderItemsError;
    }
  }

  const { error: batchError } = await supabase
    .from("production_batches")
    .upsert({
      ...rows.batch,
      revision: Number.isInteger(rows.batch.revision) ? rows.batch.revision + 1 : 1,
      updated_at: savedAt,
    }, { onConflict: "id" });

  if (batchError) {
    throw batchError;
  }

  if (changedOrderItemIdSet) {
    const changedBatchItems = rows.batchItems.filter((item) => shouldSaveOrderItem(item.order_item_id));
    if (changedBatchItems.length) {
      const { error: batchItemsError } = await supabase
        .from("batch_items")
        .upsert(changedBatchItems, { onConflict: "batch_id,order_item_id" });

      if (batchItemsError) {
        throw batchItemsError;
      }
    }
  } else {
    const { error: deleteBatchItemsError } = await supabase
      .from("batch_items")
      .delete()
      .eq("batch_id", snapshot.batch.id)
      .eq("workspace_id", snapshot.batch.workspaceId);

    if (deleteBatchItemsError) {
      throw deleteBatchItemsError;
    }

    if (rows.batchItems.length) {
      const { error: batchItemsError } = await supabase
        .from("batch_items")
        .insert(rows.batchItems);

      if (batchItemsError) {
        throw batchItemsError;
      }
    }
  }

  let savedDesigns = [];
  if (nextDesigns.length) {
    const { data, error: designsError } = await supabase
      .from("designs")
      .upsert(nextDesigns, { onConflict: "order_item_id" })
      .select("id, order_item_id");

    if (designsError) {
      throw designsError;
    }

    savedDesigns = data || [];
  }

  const designIdByOrderItemId = new Map(savedDesigns.map((design) => [design.order_item_id, design.id]));
  const savedDesignIds = savedDesigns.map((design) => design.id);

  if (savedDesignIds.length) {
    const { error: deleteLinesError } = await supabase
      .from("design_lines")
      .delete()
      .in("design_id", savedDesignIds);

    if (deleteLinesError) {
      throw deleteLinesError;
    }
  }

  const designLines = rows.designLines
    .filter((line) => shouldSaveOrderItem(line.order_item_id))
    .map((line) => {
      const { order_item_id: orderItemId, ...lineRow } = line;
      return {
        ...lineRow,
        design_id: designIdByOrderItemId.get(orderItemId),
      };
    })
    .filter((line) => line.design_id);

  if (designLines.length) {
    const { error: linesError } = await supabase
      .from("design_lines")
      .insert(designLines);

    if (linesError) {
      throw linesError;
    }
  }

  return loadProductionBatch({
    batchId: snapshot.batch.id,
    workspaceId: snapshot.batch.workspaceId,
  });
}

export async function completeProductionBatch({ batchId, workspaceId, userId }) {
  const supabase = createSupabaseAdminClient();
  const savedAt = new Date().toISOString();

  const { data: batch, error: batchError } = await supabase
    .from("production_batches")
    .update({
      active_order_item_id: null,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("id", batchId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (batchError) {
    throw batchError;
  }

  if (!batch) {
    return null;
  }

  const { data: batchItems, error: batchItemsLoadError } = await supabase
    .from("batch_items")
    .select("order_item_id, batch_position, status")
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId)
    .order("batch_position", { ascending: true });

  if (batchItemsLoadError) {
    throw batchItemsLoadError;
  }

  const activeBatchItems = (batchItems || []).filter((item) => item?.status !== "archived");
  const activeOrderItemIds = activeBatchItems
    .map((item) => item?.order_item_id)
    .filter((orderItemId) => typeof orderItemId === "string" && orderItemId.trim());

  if (activeOrderItemIds.length) {
    const { error: orderItemsError } = await supabase
      .from("order_items")
      .update({
        status: "complete",
        updated_at: savedAt,
        updated_by: userId || null,
      })
      .eq("workspace_id", workspaceId)
      .in("id", activeOrderItemIds);

    if (orderItemsError) {
      throw orderItemsError;
    }

    const { error: batchItemsError } = await supabase
      .from("batch_items")
      .delete()
      .eq("batch_id", batchId)
      .eq("workspace_id", workspaceId)
      .in("order_item_id", activeOrderItemIds);

    if (batchItemsError) {
      throw batchItemsError;
    }
  }

  return loadProductionBatch({ batchId, workspaceId });
}

export async function removeProductionBatchItem({
  batchId,
  orderItemId,
  workspaceId,
  userId,
  activeOrderItemId = null,
}) {
  const supabase = createSupabaseAdminClient();
  const savedAt = new Date().toISOString();

  const { data: batch, error: batchError } = await supabase
    .from("production_batches")
    .update({
      active_order_item_id: activeOrderItemId || null,
      updated_at: savedAt,
      updated_by: userId || null,
    })
    .eq("id", batchId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (batchError) {
    throw batchError;
  }

  if (!batch) {
    return null;
  }

  const { error: batchItemsError } = await supabase
    .from("batch_items")
    .delete()
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId)
    .eq("order_item_id", orderItemId);

  if (batchItemsError) {
    throw batchItemsError;
  }

  return loadProductionBatch({ batchId, workspaceId });
}
