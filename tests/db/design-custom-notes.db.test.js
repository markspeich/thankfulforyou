import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { saveProductionBatch, loadProductionBatch } from "../../api/_lib/production-batch-store.js";
import { getWorkspaceOrderDetail } from "../../api/_lib/orders-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";

test("custom notes persist per design through save, load, Orders copy data, and explicit clearing", async () => {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(process.env.SUPABASE_URL || "")) {
    throw new Error("This test requires the worktree's isolated local Supabase.");
  }
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const batchId = randomUUID();
  const itemIds = [randomUUID(), randomUUID()];
  const supabase = createSupabaseAdminClient();
  try {
    const saved = await saveProductionBatch({ userId: null, snapshot: {
      batch: { id: batchId, workspaceId, name: "Disposable custom notes test" },
      activeOrderItemId: itemIds[0],
      orderItems: itemIds.map((id, index) => ({
        id, text: "Ada", revision: 1, status: "in-progress",
        source: { orderNumber: id, quantity: "1" },
        settings: { customNotes: index ? "Second design" : "Pack separately\nCheck clasp & clip", lines: [] },
      })),
    } });
    expect(saved.orderItems.map(item => item.settings.customNotes))
      .toEqual(["Pack separately\nCheck clasp & clip", "Second design"]);
    const loaded = await loadProductionBatch({ workspaceId, batchId });
    expect(loaded.orderItems.map(item => item.settings.customNotes))
      .toEqual(["Pack separately\nCheck clasp & clip", "Second design"]);
    const detail = await getWorkspaceOrderDetail({ workspaceId, orderId: `order:${itemIds[0]}` });
    expect(detail.order.items[0].design.customNotes).toBe("Pack separately\nCheck clasp & clip");
    loaded.orderItems[0].settings.customNotes = "";
    await saveProductionBatch({ userId: null, snapshot: loaded, changedOrderItemIds: [itemIds[0]] });
    const cleared = await loadProductionBatch({ workspaceId, batchId });
    expect(cleared.orderItems.map(item => item.settings.customNotes)).toEqual(["", "Second design"]);
  } finally {
    const batchCleanup = await supabase.from("production_batches").delete().eq("id", batchId);
    const itemCleanup = await supabase.from("order_items").delete().in("id", itemIds);
    if (batchCleanup.error || itemCleanup.error) throw batchCleanup.error || itemCleanup.error;
  }
});
