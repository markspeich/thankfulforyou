import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import {
  addOrderGroupsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrders,
  updateOrderGroupStatus,
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

async function listSummaryPage(supabase, overrides = {}) {
  return supabase.rpc("list_workspace_order_summaries_page", {
    p_workspace_id: PRIMARY_WORKSPACE_ID,
    p_status: "open",
    p_search: "",
    p_active_batch_id: null,
    p_limit: 50,
    p_after_group_rank: null,
    p_after_order_key: null,
    p_after_group_id: null,
    ...overrides,
  });
}

async function deleteOrderItemsByPrefix(supabase, prefix) {
  const { error } = await supabase
    .from("order_items")
    .delete()
    .like("id", `${prefix}%`);
  expect(error).toBeNull();
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
  it("returns at most 50 whole order groups per compact page", async () => {
    const suffix = randomUUID().slice(0, 8);
    const supabase = createSupabaseAdminClient();
    const orderItems = Array.from({ length: 51 }, (_, index) => ({
      id: `page-${suffix}-${String(index).padStart(2, "0")}-a`,
      workspace_id: PRIMARY_WORKSPACE_ID,
      status: "open",
      order_number: `PAGE-${suffix}-${String(index).padStart(2, "0")}`,
      buyer_name: `Buyer ${index}`,
    }));
    orderItems.push({
      id: `page-${suffix}-25-b`,
      workspace_id: PRIMARY_WORKSPACE_ID,
      status: "open",
      order_number: `PAGE-${suffix}-25`,
      buyer_name: "Second item buyer",
    });

    const { error: orderItemsError } = await supabase.from("order_items").insert(orderItems);
    expect(orderItemsError).toBeNull();

    const { data, error } = await listSummaryPage(supabase, { p_search: suffix });

    expect(error).toBeNull();
    const groupIds = [...new Set(data.map((row) => row.group_id))];
    expect(groupIds).toHaveLength(50);
    expect(data.filter((row) => row.group_id === `order:PAGE-${suffix}-25`))
      .toHaveLength(2);
    expect(data.every((row) => row.has_more === true)).toBe(true);
    await deleteOrderItemsByPrefix(supabase, `page-${suffix}-`);
  });

  it("uses stable cursor boundaries for equal normalized keys and manual orders", async () => {
    const suffix = randomUUID().slice(0, 8);
    const supabase = createSupabaseAdminClient();
    const items = [
      { id: `boundary-${suffix}-upper`, order_number: `BOUNDARY-${suffix}` },
      { id: `boundary-${suffix}-lower`, order_number: `boundary-${suffix}` },
      { id: `boundary-${suffix}-manual-a`, order_number: null },
      { id: `boundary-${suffix}-manual-b`, order_number: null },
    ].map((item) => ({
      ...item,
      workspace_id: PRIMARY_WORKSPACE_ID,
      status: "open",
      buyer_name: `Boundary ${suffix}`,
    }));
    const { error: insertError } = await supabase.from("order_items").insert(items);
    expect(insertError).toBeNull();

    const first = await listSummaryPage(supabase, { p_search: `Boundary ${suffix}`, p_limit: 1 });
    expect(first.error).toBeNull();
    expect(first.data.map((row) => row.group_id)).toEqual([`order:boundary-${suffix}`]);

    const boundary = first.data.at(-1);
    const second = await listSummaryPage(supabase, {
      p_search: `Boundary ${suffix}`,
      p_limit: 1,
      p_after_group_rank: boundary.group_rank,
      p_after_order_key: boundary.order_key,
      p_after_group_id: boundary.group_id,
    });
    expect(second.error).toBeNull();
    expect(second.data.map((row) => row.group_id)).toEqual([`order:BOUNDARY-${suffix}`]);

    const collected = [...first.data, ...second.data];
    let cursor = second.data.at(-1);
    while (cursor?.has_more) {
      const page = await listSummaryPage(supabase, {
        p_search: `Boundary ${suffix}`,
        p_limit: 1,
        p_after_group_rank: cursor.group_rank,
        p_after_order_key: cursor.order_key,
        p_after_group_id: cursor.group_id,
      });
      expect(page.error).toBeNull();
      collected.push(...page.data);
      cursor = page.data.at(-1);
    }

    expect(collected.map((row) => row.group_id)).toEqual([
      `order:boundary-${suffix}`,
      `order:BOUNDARY-${suffix}`,
      `item:boundary-${suffix}-manual-a`,
      `item:boundary-${suffix}-manual-b`,
    ]);
    await deleteOrderItemsByPrefix(supabase, `boundary-${suffix}-`);
  });

  it("searches the entire workspace across compact order fields and design text", async () => {
    const suffix = randomUUID().slice(0, 8);
    const supabase = createSupabaseAdminClient();
    const fillerItems = Array.from({ length: 55 }, (_, index) => ({
      id: `search-${suffix}-filler-${String(index).padStart(2, "0")}`,
      workspace_id: PRIMARY_WORKSPACE_ID,
      status: "open",
      order_number: `A-${suffix}-${String(index).padStart(2, "0")}`,
      buyer_name: "Unrelated buyer",
    }));
    const targetId = `search-${suffix}-target`;
    const targetOrderNumber = `Z-${suffix}-rare-order`;
    const { error: itemsError } = await supabase.from("order_items").insert([
      ...fillerItems,
      {
        id: targetId,
        workspace_id: PRIMARY_WORKSPACE_ID,
        status: "open",
        order_number: targetOrderNumber,
        buyer_name: `Rare Buyer ${suffix}`,
        listing_id: `rare-listing-${suffix}`,
        transaction_id: `rare-transaction-${suffix}`,
        imported_color: `Rare Color ${suffix}`,
      },
    ]);
    expect(itemsError).toBeNull();
    const { error: designError } = await supabase.from("designs").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      order_item_id: targetId,
      design_text: `Rare Credentials ${suffix}`,
    });
    expect(designError).toBeNull();

    const searches = [
      targetOrderNumber,
      `Rare Buyer ${suffix}`,
      `rare-listing-${suffix}`,
      `rare-transaction-${suffix}`,
      `Rare Color ${suffix}`,
      `Rare Credentials ${suffix}`,
    ];
    for (const search of searches) {
      const { data, error } = await listSummaryPage(supabase, { p_search: search });
      expect(error).toBeNull();
      expect([...new Set(data.map((row) => row.group_id))]).toEqual([`order:${targetOrderNumber}`]);
    }
    await deleteOrderItemsByPrefix(supabase, `search-${suffix}-`);
  });

  it("traverses every matching group without skips or duplicates", async () => {
    const suffix = randomUUID().slice(0, 8);
    const supabase = createSupabaseAdminClient();
    const expectedGroupIds = Array.from({ length: 73 }, (_, index) =>
      `order:TRAVERSE-${suffix}-${String(index).padStart(2, "0")}`);
    const { error: insertError } = await supabase.from("order_items").insert(
      expectedGroupIds.map((groupId, index) => ({
        id: `traverse-${suffix}-${String(index).padStart(2, "0")}`,
        workspace_id: PRIMARY_WORKSPACE_ID,
        status: "open",
        order_number: groupId.slice("order:".length),
        buyer_name: `Traversal ${suffix}`,
      })),
    );
    expect(insertError).toBeNull();

    const traversed = [];
    let cursor = null;
    do {
      const page = await listSummaryPage(supabase, {
        p_search: `Traversal ${suffix}`,
        p_limit: 7,
        p_after_group_rank: cursor?.group_rank ?? null,
        p_after_order_key: cursor?.order_key ?? null,
        p_after_group_id: cursor?.group_id ?? null,
      });
      expect(page.error).toBeNull();
      traversed.push(...new Set(page.data.map((row) => row.group_id)));
      cursor = page.data.at(-1) || null;
    } while (cursor?.has_more);

    expect(traversed).toEqual(expectedGroupIds);
    expect(new Set(traversed).size).toBe(traversed.length);
    await deleteOrderItemsByPrefix(supabase, `traverse-${suffix}-`);
  });

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

  it("hides complete orders by default and preserves saved designs on duplicate imports", async () => {
    const suffix = Date.now().toString(36);
    const completeId = `transaction:txn-complete-${suffix}`;
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
          text: "Complete",
          source: {
            orderNumber: `COMPLETE-${suffix}`,
            transactionId: `txn-complete-${suffix}`,
            buyerName: "Complete Buyer",
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

    const { error: completeError } = await supabase
      .from("order_items")
      .update({ status: "complete" })
      .eq("id", completeId);

    expect(completeError).toBeNull();

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

    expect(listed.orders.some((order) => order.orderNumber === `COMPLETE-${suffix}`)).toBe(false);
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

  it("skips an order and clears active production batch selection", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `SKIP-${suffix}`;
    const transactionId = `txn-skip-${suffix}`;
    const orderItemId = `transaction:${transactionId}`;
    const batchId = await createTestBatch("Skip Orders DB Test Batch");

    await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "productionBatch",
      batchId,
      items: [{
        text: "Skip Me",
        source: {
          orderNumber,
          transactionId,
          buyerName: "Skip Buyer",
        },
      }],
    });

    const supabase = createSupabaseAdminClient();
    const { error: activeSelectionError } = await supabase
      .from("production_batches")
      .update({ active_order_item_id: orderItemId })
      .eq("id", batchId);

    expect(activeSelectionError).toBeNull();

    const result = await updateOrderGroupStatus({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      orderId: `order:${orderNumber}`,
      status: "skipped",
    });

    expect(result).toEqual({
      orderItemIds: [orderItemId],
      status: "skipped",
    });

    const { data: batch, error: batchError } = await supabase
      .from("production_batches")
      .select("active_order_item_id")
      .eq("id", batchId)
      .maybeSingle();
    const { data: batchItems, error: batchItemsError } = await supabase
      .from("batch_items")
      .select("order_item_id")
      .eq("batch_id", batchId)
      .eq("order_item_id", orderItemId);

    expect(batchError).toBeNull();
    expect(batch?.active_order_item_id).toBeNull();
    expect(batchItemsError).toBeNull();
    expect(batchItems).toEqual([]);
  });
});
