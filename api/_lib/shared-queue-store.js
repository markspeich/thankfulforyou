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

  if ("queue" in row && "activeOrderId" in row && "orders" in row) {
    return {
      queue: normalizeJsonValue(row.queue),
      activeOrderId: row.activeOrderId,
      orders: normalizeJsonValue(row.orders),
    };
  }

  return {
    queue: normalizeJsonValue(row.queue_json),
    activeOrderId: row.active_order_id,
    orders: normalizeJsonValue(row.orders_json),
  };
}

function createSharedSessionAccessError() {
  return Object.assign(new Error("Shared workspace access denied."), {
    code: "SHARED_SESSION_FORBIDDEN",
    statusCode: 403,
    expose: true,
  });
}

function normalizeQueueRow(row) {
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

export async function getSessionContext(auth) {
  const supabase = createSupabaseAdminClient();

  const [
    { data: membership, error: membershipError },
    { data: workspace, error: workspaceError },
    { data: queue, error: queueError },
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
      .from("design_queues")
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

  if (queueError) {
    throw queueError;
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
    queue: normalizeQueueRow(queue),
  };
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
