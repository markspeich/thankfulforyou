import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { mutateSelectedProductionBatchItems } from "../../api/_lib/production-batch-store.js";

beforeAll(() => {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${process.env.SUPABASE_URL}/`)) {
    throw new Error("Selected-item integration tests require local Supabase.");
  }
});

describe("atomic selected production batch actions", () => {
  it.each(["skipped", "completed", "archived"])("rejects selected %s membership and preserves inactive history", async (status) => {
    const supabase = createSupabaseAdminClient();
    const workspaceId = randomUUID();
    const batchId = randomUUID();
    const ids = ["active", "history"].map(label => `selected-test-${label}-${randomUUID()}`);
    const check = result => { if (result.error) throw result.error; return result.data; };
    try {
      check(await supabase.from("workspaces").insert({ id: workspaceId, name: "Disposable inactive membership test" }));
      check(await supabase.from("order_items").insert(ids.map(id => ({ id, workspace_id: workspaceId, status: "open", revision: 4 }))));
      check(await supabase.from("production_batches").insert({ id: batchId, workspace_id: workspaceId, name: "Disposable batch", active_order_item_id: ids[0], revision: 3 }));
      check(await supabase.from("batch_items").insert(ids.map((id, index) => ({ workspace_id: workspaceId, batch_id: batchId, order_item_id: id, batch_position: index, status: index === 0 ? "active" : status }))));
      await expect(mutateSelectedProductionBatchItems({ workspaceId, batchId, operation: "complete", orderItemIds: ids })).rejects.toMatchObject({ statusCode: 409 });
      expect(check(await supabase.from("batch_items").select("order_item_id").eq("batch_id", batchId))).toHaveLength(2);
      expect(check(await supabase.from("order_items").select("status,revision").eq("workspace_id", workspaceId))).toEqual([{ status: "open", revision: 4 }, { status: "open", revision: 4 }]);
      await mutateSelectedProductionBatchItems({ workspaceId, batchId, operation: "remove", orderItemIds: [ids[0]] });
      expect(check(await supabase.from("batch_items").select("order_item_id,status").eq("batch_id", batchId))).toEqual([{ order_item_id: ids[1], status }]);
      expect(check(await supabase.from("production_batches").select("active_order_item_id").eq("id", batchId).single()).active_order_item_id).toBeNull();
    } finally {
      check(await supabase.from("production_batches").delete().eq("id", batchId));
      check(await supabase.from("order_items").delete().eq("workspace_id", workspaceId));
      check(await supabase.from("workspaces").delete().eq("id", workspaceId));
    }
  });

  it.each(["complete", "skip", "remove"])("applies %s only to checked members and preserves designs", async (operation) => {
    const supabase = createSupabaseAdminClient();
    const workspaceId = randomUUID();
    const batchId = randomUUID();
    const ids = ["open", "complete", "unchecked"].map(label => `selected-test-${label}-${randomUUID()}`);
    const check = result => { if (result.error) throw result.error; return result.data; };
    try {
      check(await supabase.from("workspaces").insert({ id: workspaceId, name: "Disposable selected action test" }));
      check(await supabase.from("order_items").insert(ids.map((id, index) => ({ id, workspace_id: workspaceId, status: index === 1 ? "complete" : "open", revision: 4 }))));
      check(await supabase.from("designs").insert(ids.map(id => ({ workspace_id: workspaceId, order_item_id: id, design_text: "Retained", production_status: "saved" }))));
      check(await supabase.from("production_batches").insert({ id: batchId, workspace_id: workspaceId, name: "Disposable batch", status: "active", active_order_item_id: ids[0], revision: 3 }));
      check(await supabase.from("batch_items").insert(ids.map((id, index) => ({ workspace_id: workspaceId, batch_id: batchId, order_item_id: id, batch_position: index, status: "active" }))));

      // Every ID must match before any lifecycle or membership changes occur.
      await expect(mutateSelectedProductionBatchItems({ workspaceId, batchId, operation, orderItemIds: [ids[0], "stale-member"] })).rejects.toMatchObject({ statusCode: 409 });
      const unchanged = check(await supabase.from("order_items").select("id,status,revision").eq("workspace_id", workspaceId));
      expect(unchanged.find(item => item.id === ids[0])).toMatchObject({ status: "open", revision: 4 });
      expect(check(await supabase.from("batch_items").select("order_item_id").eq("batch_id", batchId))).toHaveLength(3);
      expect(await mutateSelectedProductionBatchItems({ workspaceId: randomUUID(), batchId, operation, orderItemIds: [ids[0]] })).toBeNull();

      const snapshot = await mutateSelectedProductionBatchItems({ workspaceId, batchId, operation, orderItemIds: ids.slice(0, 2) });
      expect(snapshot.orderItems.map(item => item.id)).toEqual([ids[2]]);
      expect(snapshot.activeOrderItemId).toBe(ids[2]);
      const remaining = check(await supabase.from("order_items").select("id,status,revision").eq("workspace_id", workspaceId));
      expect(remaining.find(item => item.id === ids[0])).toMatchObject({ status: operation === "complete" ? "complete" : operation === "skip" ? "skipped" : "open", revision: operation === "remove" ? 4 : 5 });
      expect(remaining.find(item => item.id === ids[1])).toMatchObject({ status: "complete", revision: operation === "complete" ? 5 : 4 });
      expect(remaining.find(item => item.id === ids[2])).toMatchObject({ status: "open", revision: 4 });
      expect(check(await supabase.from("designs").select("order_item_id").eq("workspace_id", workspaceId))).toHaveLength(3);
      expect(check(await supabase.from("production_batches").select("revision").eq("id", batchId).single()).revision).toBe(4);
      await expect(mutateSelectedProductionBatchItems({ workspaceId, batchId, operation, orderItemIds: [ids[0]] })).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      check(await supabase.from("production_batches").delete().eq("id", batchId));
      check(await supabase.from("order_items").delete().eq("workspace_id", workspaceId));
      check(await supabase.from("workspaces").delete().eq("id", workspaceId));
    }
  });

  it("denies anonymous execution of the service-only mutation", async () => {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.rpc("mutate_selected_production_batch_items", { p_workspace_id: randomUUID(), p_user_id: null, p_batch_id: randomUUID(), p_operation: "remove", p_order_item_ids: ["test"] });
    expect(error?.code).toBe("42501");
  });
});
