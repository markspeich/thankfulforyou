import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import {
  addOrderGroupsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrderSummaries,
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
  it("searches and paginates more than one thousand complete order groups without splitting a group", async () => {
    // Break caught: compact Orders search reads only a browser-sized subset or paginates item rows.
    const suffix = randomUUID().slice(0, 8);
    const boundaryOrderNumber = `99${String(Date.now()).slice(-8)}`;
    const supabase = createSupabaseAdminClient();
    const bulkRows = Array.from({ length: 1005 }, (_, index) => ({
      id: `scale-${suffix}-${index}`,
      workspace_id: PRIMARY_WORKSPACE_ID,
      status: ["open", "complete", "skipped"][index % 3],
      order_number: index === 0
        ? `MANUAL-${suffix}`
        : index === 1
          ? null
          : `8${String(index).padStart(9, "0")}`,
      buyer_name: `Scale Buyer ${index}`,
      listing_id: `scale-listing-${index}`,
      transaction_id: `scale-transaction-${index}`,
      imported_color: index % 2 ? "Pink" : "Teal",
      quantity: 1,
      source_json: {},
      created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    }));
    const specialRows = [
      {
        id: `scale-${suffix}-boundary-a`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: boundaryOrderNumber, buyer_name: "Boundary Buyer", listing_id: "boundary-a",
        transaction_id: `boundary-a-${suffix}`, imported_color: "White", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-boundary-b`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: boundaryOrderNumber, buyer_name: "Boundary Buyer", listing_id: "boundary-b",
        transaction_id: `boundary-b-${suffix}`, imported_color: "Black", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-old-complete`, workspace_id: PRIMARY_WORKSPACE_ID, status: "complete",
        order_number: "4118855809", buyer_name: "Historical Buyer", listing_id: "historical-listing",
        transaction_id: `historical-${suffix}`, imported_color: "Navy", quantity: 1, source_json: {},
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-buyer`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `BUYER-${suffix}`, buyer_name: "Only NeedleBuyer Match", listing_id: "plain-listing",
        transaction_id: `plain-buyer-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-listing-id`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `LISTING-ID-${suffix}`, buyer_name: "Plain", listing_id: "Only-NeedleListingId-Match",
        transaction_id: `plain-listing-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-listing-title`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `LISTING-TITLE-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-title-${suffix}`, imported_color: "Plain", quantity: 1,
        source_json: { marketplace: "amazon", listingTitle: "Only NeedleListingTitle Match", rawCustomization: { diagnostic: "must-not-leak" } },
      },
      {
        id: `scale-${suffix}-transaction`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `TRANSACTION-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: "Only-NeedleTransaction-Match", imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-color`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `COLOR-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-color-${suffix}`, imported_color: "Only NeedleColor Match", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-design`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `DESIGN-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-design-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-line`, workspace_id: PRIMARY_WORKSPACE_ID, status: "open",
        order_number: `LINE-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-line-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
    ].map((row, index) => ({
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ...row,
    }));

    for (let index = 0; index < bulkRows.length; index += 250) {
      const { error } = await supabase.from("order_items").insert(bulkRows.slice(index, index + 250));
      expect(error).toBeNull();
    }
    const { error: specialError } = await supabase.from("order_items").insert(specialRows);
    expect(specialError).toBeNull();
    const filterBatchId = await createTestBatch(`Scale Filter ${suffix}`);
    const { error: membershipError } = await supabase.from("batch_items").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      batch_id: filterBatchId,
      order_item_id: `scale-${suffix}-boundary-a`,
      batch_position: 0,
      status: "active",
    });
    expect(membershipError).toBeNull();

    const designId = randomUUID();
    const lineDesignId = randomUUID();
    const { error: designsError } = await supabase.from("designs").insert([
      { id: designId, workspace_id: PRIMARY_WORKSPACE_ID, order_item_id: `scale-${suffix}-design`, design_text: "Only NeedleDesign Match" },
      { id: lineDesignId, workspace_id: PRIMARY_WORKSPACE_ID, order_item_id: `scale-${suffix}-line`, design_text: "Plain design" },
    ]);
    expect(designsError).toBeNull();
    const { error: lineError } = await supabase.from("design_lines").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      design_id: lineDesignId,
      line_index: 0,
      text: "Only NeedleLine Match",
      font_id: "skywalk",
    });
    expect(lineError).toBeNull();

    const page = await listWorkspaceOrderSummaries({
      workspaceId: PRIMARY_WORKSPACE_ID,
      statusFilter: "open",
      limit: 50,
    });
    expect(page.orders).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(new Set(page.orders.map((order) => order.id)).size).toBe(50);
    expect(JSON.stringify(page)).not.toContain("must-not-leak");

    const boundaryPage = await listWorkspaceOrderSummaries({
      workspaceId: PRIMARY_WORKSPACE_ID,
      statusFilter: "open",
      limit: 1,
    });
    expect(boundaryPage.orders).toHaveLength(1);
    expect(boundaryPage.orders[0]).toMatchObject({ id: `order:${boundaryOrderNumber}` });
    expect(boundaryPage.orders[0].items).toHaveLength(2);
    const afterBoundary = await listWorkspaceOrderSummaries({
      workspaceId: PRIMARY_WORKSPACE_ID,
      statusFilter: "open",
      limit: 1,
      cursor: { version: 1, ...boundaryPage.nextCursorValues },
    });
    expect(afterBoundary.orders.map((order) => order.id)).not.toContain(`order:${boundaryOrderNumber}`);

    const inBatch = await listWorkspaceOrderSummaries({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: filterBatchId,
      statusFilter: "open",
      batchFilter: "inBatch",
      searchTerm: boundaryOrderNumber,
      limit: 50,
    });
    expect(inBatch.orders).toHaveLength(1);
    expect(inBatch.orders[0]).toMatchObject({
      id: `order:${boundaryOrderNumber}`,
      isInActiveBatch: true,
    });
    expect(inBatch.orders[0].items).toHaveLength(2);
    const notInBatch = await listWorkspaceOrderSummaries({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: filterBatchId,
      statusFilter: "open",
      batchFilter: "notInBatch",
      searchTerm: boundaryOrderNumber,
      limit: 50,
    });
    expect(notInBatch.orders).toEqual([]);

    for (const [term, expectedId] of [
      ["needlebuyer", `order:BUYER-${suffix}`],
      ["needlelistingid", `order:LISTING-ID-${suffix}`],
      ["needlelistingtitle", `order:LISTING-TITLE-${suffix}`],
      ["needletransaction", `order:TRANSACTION-${suffix}`],
      ["needlecolor", `order:COLOR-${suffix}`],
      ["needledesign", `order:DESIGN-${suffix}`],
      ["needleline", `order:LINE-${suffix}`],
    ]) {
      const search = await listWorkspaceOrderSummaries({
        workspaceId: PRIMARY_WORKSPACE_ID,
        statusFilter: "all",
        searchTerm: term.toUpperCase(),
        limit: 50,
      });
      expect(search.orders.map((order) => order.id)).toContain(expectedId);
      expect(JSON.stringify(search)).not.toContain("must-not-leak");
    }

    for (const statusFilter of ["all", "complete"]) {
      const historical = await listWorkspaceOrderSummaries({
        workspaceId: PRIMARY_WORKSPACE_ID,
        statusFilter,
        searchTerm: "4118855809",
        limit: 50,
      });
      expect(historical.orders).toHaveLength(1);
      expect(historical.orders[0]).toMatchObject({
        id: "order:4118855809",
        status: "complete",
      });
    }
  }, 60_000);

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
