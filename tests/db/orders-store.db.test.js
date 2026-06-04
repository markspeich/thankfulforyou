import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import {
  addOrderGroupsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrders,
} from "../../api/_lib/orders-store.js";
import { loadEnvFile } from "../../tools/env_file.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";

async function createTestBatch(name = "Orders Store DB Test Batch") {
  const batchId = randomUUID();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("production_batches")
    .insert({
      id: batchId,
      workspace_id: PRIMARY_WORKSPACE_ID,
      name,
      status: "active",
    });

  expect(error).toBeNull();
  return batchId;
}

beforeAll(() => {
  loadEnvFile();

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const allowRemote = process.env.TFY_ALLOW_REMOTE_DB_TESTS === "1";
  if (!allowRemote && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(supabaseUrl)) {
    throw new Error(
      `Refusing to run DB tests against non-local SUPABASE_URL: ${supabaseUrl || "<missing>"}.`,
    );
  }
});

describe("orders store database integration", () => {
  it("imports order items to Orders without adding them to the production batch", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `ORDERS-${suffix}`;
    const transactionId = `txn-orders-${suffix}`;

    const result = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      batchId: PRIMARY_BATCH_ID,
      items: [{
        text: "Ada\nRN",
        presetId: "preset-c3e8a1d7f520",
        source: {
          orderNumber,
          transactionId,
          buyerName: "Ada Lovelace",
          listingId: `listing-${suffix}`,
          colorName: "Teal",
          quantity: "2",
        },
        settings: {
          boundingSizePresetId: "size-2-2x1-5",
          backingMm: 4.2,
          lines: [
            { fontId: "skywalk", fontSizeMm: 18 },
            { fontId: "somekind", bridgeMm: 0.7 },
          ],
        },
      }],
    });

    expect(result).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 0,
      addedOrderItemIds: [],
    });
    const importedOrder = result.orders.find((order) => order.orderNumber === orderNumber);

    expect(importedOrder).toMatchObject({
      id: `order:${orderNumber}`,
      orderNumber,
      buyerName: "Ada Lovelace",
      isInActiveBatch: false,
    });
    expect(importedOrder.items[0]).toMatchObject({
      id: `transaction:${transactionId}`,
      importedColor: "Teal",
      quantity: 2,
      isInActiveBatch: false,
      design: {
        text: "Ada\nRN",
        presetId: "preset-c3e8a1d7f520",
        backingBorderMm: 4.2,
        lines: [
          { lineIndex: 0, text: "Ada", fontId: "skywalk", textHeightMm: 18 },
          { lineIndex: 1, text: "RN", fontId: "somekind", letterBridgeMm: 0.7 },
        ],
      },
    });

    const supabase = createSupabaseAdminClient();
    const { data: batchItems, error } = await supabase
      .from("batch_items")
      .select("order_item_id")
      .eq("batch_id", PRIMARY_BATCH_ID)
      .eq("order_item_id", `transaction:${transactionId}`);

    expect(error).toBeNull();
    expect(batchItems).toEqual([]);
  });

  it("imports order items to the active production batch and groups checked orders", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `BATCH-${suffix}`;
    const existingTransactionId = `txn-existing-${suffix}`;
    const newTransactionId = `txn-new-${suffix}`;
    const batchId = await createTestBatch("Grouped Orders DB Test Batch");

    const firstImport = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "productionBatch",
      batchId,
      items: [{
        text: "Grace",
        source: {
          orderNumber,
          transactionId: existingTransactionId,
          buyerName: "Grace Hopper",
        },
      }],
    });

    expect(firstImport).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 1,
      addedOrderItemIds: [`transaction:${existingTransactionId}`],
    });

    const secondImport = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [{
        text: "Badge buddy",
        source: {
          orderNumber,
          transactionId: newTransactionId,
          buyerName: "Grace Hopper",
        },
      }],
    });

    expect(secondImport).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 0,
    });

    const groupedAdd = await addOrderGroupsToProductionBatch({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      batchId,
      orderIds: [`order:${orderNumber}`],
    });

    expect(groupedAdd).toEqual({
      addedOrderItemIds: [`transaction:${newTransactionId}`],
    });

    const listed = await listWorkspaceOrders({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: batchId,
    });
    const groupedOrder = listed.orders.find((order) => order.orderNumber === orderNumber);

    expect(groupedOrder).toMatchObject({
      id: `order:${orderNumber}`,
      isInActiveBatch: true,
    });
    expect(groupedOrder.items).toHaveLength(2);
    expect(groupedOrder.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `transaction:${existingTransactionId}`, isInActiveBatch: true }),
      expect.objectContaining({ id: `transaction:${newTransactionId}`, isInActiveBatch: true }),
    ]));
  });

  it("hides archived orders and preserves saved designs on duplicate imports", async () => {
    const suffix = Date.now().toString(36);
    const archivedId = `transaction:txn-archived-${suffix}`;
    const savedId = `transaction:txn-saved-${suffix}`;
    const cachedBuild = {
      signature: `saved-${suffix}`,
      layout: { text: "Saved", lines: [{ text: "Saved" }] },
      analysis: { connectedComponentCount: 1 },
    };
    const supabase = createSupabaseAdminClient();

    const importResult = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [
        {
          text: "Archived",
          source: {
            orderNumber: `ARCHIVED-${suffix}`,
            transactionId: `txn-archived-${suffix}`,
            buyerName: "Archived Buyer",
          },
        },
        {
          text: "Saved",
          presetId: "preset-c3e8a1d7f520",
          source: {
            orderNumber: `SAVED-${suffix}`,
            transactionId: `txn-saved-${suffix}`,
            buyerName: "Saved Buyer",
          },
          settings: { lines: [{ fontId: "skywalk" }] },
        },
      ],
    });

    expect(importResult.importedCount).toBe(2);

    const { error: archiveError } = await supabase
      .from("order_items")
      .update({ status: "archived" })
      .eq("id", archivedId);

    expect(archiveError).toBeNull();

    const { error: savedError } = await supabase
      .from("designs")
      .update({
        production_status: "export_ready",
        cached_build_json: cachedBuild,
        saved_settings_signature: cachedBuild.signature,
        completed_settings_signature: cachedBuild.signature,
        analysis_badge_json: { state: "ok", shortLabel: "Ready", fullLabel: "Ready" },
      })
      .eq("order_item_id", savedId);

    expect(savedError).toBeNull();

    await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [{
        text: "Draft overwrite",
        presetId: "preset-b7d2e9f4c318",
        source: {
          orderNumber: `SAVED-${suffix}`,
          transactionId: `txn-saved-${suffix}`,
          buyerName: "Saved Buyer",
        },
        settings: { lines: [{ fontId: "somekind" }] },
      }],
    });

    const listed = await listWorkspaceOrders({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: PRIMARY_BATCH_ID,
    });

    expect(listed.orders.some((order) => order.orderNumber === `ARCHIVED-${suffix}`)).toBe(false);
    const savedOrder = listed.orders.find((order) => order.orderNumber === `SAVED-${suffix}`);
    expect(savedOrder?.items[0].design).toMatchObject({
      text: "Saved",
      presetId: "preset-c3e8a1d7f520",
      productionStatus: "export_ready",
      cachedBuild,
      savedSettingsSignature: cachedBuild.signature,
      completedSettingsSignature: cachedBuild.signature,
      lines: [{ lineIndex: 0, text: "Saved", fontId: "skywalk" }],
    });
  });
});
