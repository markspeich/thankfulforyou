import { createSupabaseAdminClient } from "./supabase-admin.js";

function normalizeJsonValue(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

function normalizeSnapshotRow(row) {
  if (!row) {
    return null;
  }

  return {
    queue: normalizeJsonValue(row.queue_json),
    activeOrderId: row.active_order_id,
    orders: normalizeJsonValue(row.orders_json),
  };
}

export async function loadSharedQueue({ queueId, workspaceId }) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("design_queues")
    .select("queue_json, active_order_id, orders_json")
    .eq("id", queueId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeSnapshotRow(data);
}

export async function saveSharedQueue({ snapshot, userId }) {
  const supabase = createSupabaseAdminClient();
  const revisions = Array.isArray(snapshot.orders)
    ? snapshot.orders.map((order) => ({
      id: order.id,
      revision: order.revision,
    }))
    : [];

  const { data, error } = await supabase.rpc("save_design_queue_snapshot", {
    p_queue_id: snapshot.queue.id,
    p_workspace_id: snapshot.queue.workspaceId,
    p_active_order_id: snapshot.activeOrderId,
    p_orders_json: snapshot.orders,
    p_revisions_json: revisions,
    p_updated_by: userId,
  });

  if (error?.code === "P0001" && /revision conflict/i.test(error.message)) {
    throw Object.assign(new Error("Revision conflict"), {
      code: "REVISION_CONFLICT",
      details: error.details || null,
    });
  }

  if (error) {
    throw error;
  }

  return normalizeSnapshotRow(data);
}
