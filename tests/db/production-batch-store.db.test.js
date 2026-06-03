import { beforeAll, describe, expect, it } from "vitest";

import { loadEnvFile } from "../../tools/env_file.mjs";
import {
  archiveProductionBatch,
  archiveProductionBatchItem,
  loadProductionBatch,
  saveProductionBatch,
} from "../../api/_lib/production-batch-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";

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

describe("production batch store database integration", () => {
  it("loads the seeded primary batch from local Supabase", async () => {
    const snapshot = await loadProductionBatch({
      batchId: PRIMARY_BATCH_ID,
      workspaceId: PRIMARY_WORKSPACE_ID,
    });

    expect(snapshot).toMatchObject({
      batch: {
        id: PRIMARY_BATCH_ID,
        workspaceId: PRIMARY_WORKSPACE_ID,
        name: "Primary Batch",
        status: "active",
      },
      activeOrderItemId: null,
      orderItems: [],
    });
  });

  it("saves, reloads, and archives a production batch without deleting order records", async () => {
    const suffix = Date.now().toString(36);
    const batchId = "33333333-3333-4333-8333-333333333333";
    const orderItemId = `db-test-order-${suffix}`;

    const saved = await saveProductionBatch({
      userId: null,
      snapshot: {
        batch: {
          id: batchId,
          workspaceId: PRIMARY_WORKSPACE_ID,
          name: "DB Integration Batch",
          status: "active",
        },
        activeOrderItemId: orderItemId,
        orderItems: [{
          id: orderItemId,
          revision: 1,
          text: "Nora\nRN",
          status: "captured",
          source: {
            orderNumber: `TEST-${suffix}`,
            buyerName: "DB Test Buyer",
            listingId: "db-test-listing",
            transactionId: `txn-${suffix}`,
            colorName: "Red",
            quantity: "2",
          },
          settings: {
            text: "Nora\nRN",
            presetId: "preset-c3e8a1d7f520",
            boundingSizePresetId: "size-2-2x1-5",
            backingMm: 3.1,
            weldExportedDesign: true,
            globalHorizontalScale: 1,
            globalVerticalScale: 1,
            lines: [
              {
                fontId: "skywalk",
                bridgeMm: 0.6,
                lineBridgeMm: 0.5,
                offsetXMm: 0,
                fontSizeMm: 18,
                horizontalScale: 1,
                verticalScale: 1,
                lockTextHeight: false,
              },
              {
                fontId: "somekind",
                bridgeMm: 0.5,
                lineBridgeMm: 0.4,
                offsetXMm: 1.25,
                fontSizeMm: 23,
                horizontalScale: 0.95,
                verticalScale: 1.05,
                lockTextHeight: true,
              },
            ],
          },
        }],
      },
    });

    expect(saved).toMatchObject({
      batch: {
        id: batchId,
        workspaceId: PRIMARY_WORKSPACE_ID,
        name: "DB Integration Batch",
      },
      activeOrderItemId: orderItemId,
    });
    expect(saved.orderItems).toHaveLength(1);
    expect(saved.orderItems[0]).toMatchObject({
      id: orderItemId,
      text: "Nora\nRN",
      status: "captured",
      source: {
        orderNumber: `TEST-${suffix}`,
        buyerName: "DB Test Buyer",
        listingId: "db-test-listing",
        transactionId: `txn-${suffix}`,
        colorName: "Red",
        quantity: "2",
      },
      settings: {
        presetId: "preset-c3e8a1d7f520",
        boundingSizePresetId: "size-2-2x1-5",
        lines: [
          { fontId: "skywalk", bridgeMm: 0.6, fontSizeMm: 18 },
          {
            fontId: "somekind",
            lineBridgeMm: 0.4,
            offsetXMm: 1.25,
            fontSizeMm: 23,
            horizontalScale: 0.95,
            verticalScale: 1.05,
            lockTextHeight: true,
          },
        ],
      },
    });

    const reloaded = await loadProductionBatch({
      batchId,
      workspaceId: PRIMARY_WORKSPACE_ID,
    });
    expect(reloaded?.orderItems).toHaveLength(1);
    expect(reloaded?.orderItems[0]?.id).toBe(orderItemId);

    const archived = await archiveProductionBatch({
      batchId,
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
    });
    expect(archived).toMatchObject({
      batch: { id: batchId },
      activeOrderItemId: null,
      orderItems: [],
    });

    const supabase = createSupabaseAdminClient();
    const [
      { data: orderItem, error: orderItemError },
      { data: design, error: designError },
    ] = await Promise.all([
      supabase
        .from("order_items")
        .select("id")
        .eq("id", orderItemId)
        .maybeSingle(),
      supabase
        .from("designs")
        .select("order_item_id")
        .eq("order_item_id", orderItemId)
        .maybeSingle(),
    ]);

    expect(orderItemError).toBeNull();
    expect(designError).toBeNull();
    expect(orderItem).toEqual({ id: orderItemId });
    expect(design).toEqual({ order_item_id: orderItemId });
  });

  it("saves a new active batch item after archived items moved out of active positions", async () => {
    const suffix = Date.now().toString(36);
    const batchId = "44444444-4444-4444-8444-444444444444";
    const archivedOrderItemId = `db-test-archived-${suffix}`;
    const activeOrderItemId = `db-test-active-${suffix}`;

    await saveProductionBatch({
      userId: null,
      snapshot: {
        batch: {
          id: batchId,
          workspaceId: PRIMARY_WORKSPACE_ID,
          name: "Archive Position Batch",
          status: "active",
        },
        activeOrderItemId: archivedOrderItemId,
        orderItems: [{
          id: archivedOrderItemId,
          revision: 1,
          text: "Old",
          status: "captured",
          source: { orderNumber: `ARCHIVED-${suffix}` },
          settings: {
            text: "Old",
            presetId: "preset-c3e8a1d7f520",
            boundingSizePresetId: "size-2-2x1-5",
            lines: [{ fontId: "skywalk" }],
          },
        }],
      },
    });

    await archiveProductionBatch({
      batchId,
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
    });

    const saved = await saveProductionBatch({
      userId: null,
      changedOrderItemIds: [activeOrderItemId],
      snapshot: {
        batch: {
          id: batchId,
          workspaceId: PRIMARY_WORKSPACE_ID,
          name: "Archive Position Batch",
          status: "active",
        },
        activeOrderItemId,
        orderItems: [{
          id: activeOrderItemId,
          revision: 1,
          text: "New",
          status: "captured",
          source: { orderNumber: `ACTIVE-${suffix}` },
          settings: {
            text: "New",
            presetId: "preset-c3e8a1d7f520",
            boundingSizePresetId: "size-2-2x1-5",
            lines: [{ fontId: "somekind" }],
          },
        }],
      },
    });

    expect(saved?.orderItems).toHaveLength(1);
    expect(saved?.orderItems[0]?.id).toBe(activeOrderItemId);

    const supabase = createSupabaseAdminClient();
    const { data: batchItems, error } = await supabase
      .from("batch_items")
      .select("order_item_id, batch_position, status")
      .eq("batch_id", batchId)
      .order("batch_position", { ascending: true });

    expect(error).toBeNull();
    expect(batchItems).toEqual(expect.arrayContaining([
      { order_item_id: activeOrderItemId, batch_position: 0, status: "active" },
      { order_item_id: archivedOrderItemId, batch_position: 1, status: "archived" },
    ]));
  });

  it("archives one batch item so it stays hidden after reload while preserving saved design records", async () => {
    const suffix = Date.now().toString(36);
    const batchId = "55555555-5555-4555-8555-555555555555";
    const archivedOrderItemId = `db-test-archive-one-${suffix}`;
    const activeOrderItemId = `db-test-keep-one-${suffix}`;

    await saveProductionBatch({
      userId: null,
      snapshot: {
        batch: {
          id: batchId,
          workspaceId: PRIMARY_WORKSPACE_ID,
          name: "Single Archive Batch",
          status: "active",
        },
        activeOrderItemId: archivedOrderItemId,
        orderItems: [
          {
            id: archivedOrderItemId,
            revision: 1,
            text: "Archive Me",
            status: "captured",
            source: { orderNumber: `DELETE-${suffix}` },
            settings: {
              text: "Archive Me",
              presetId: "preset-c3e8a1d7f520",
              boundingSizePresetId: "size-2-2x1-5",
              lines: [{ fontId: "skywalk" }],
            },
          },
          {
            id: activeOrderItemId,
            revision: 1,
            text: "Keep Me",
            status: "captured",
            source: { orderNumber: `KEEP-${suffix}` },
            settings: {
              text: "Keep Me",
              presetId: "preset-c3e8a1d7f520",
              boundingSizePresetId: "size-2-2x1-5",
              lines: [{ fontId: "somekind" }],
            },
          },
        ],
      },
    });

    const archived = await archiveProductionBatchItem({
      batchId,
      orderItemId: archivedOrderItemId,
      activeOrderItemId,
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
    });

    expect(archived).toMatchObject({
      batch: { id: batchId },
      activeOrderItemId,
      orderItems: [{ id: activeOrderItemId }],
    });
    expect(archived?.orderItems.map((orderItem) => orderItem.id)).not.toContain(archivedOrderItemId);

    const reloaded = await loadProductionBatch({
      batchId,
      workspaceId: PRIMARY_WORKSPACE_ID,
    });
    expect(reloaded?.activeOrderItemId).toBe(activeOrderItemId);
    expect(reloaded?.orderItems.map((orderItem) => orderItem.id)).toEqual([activeOrderItemId]);

    const supabase = createSupabaseAdminClient();
    const [
      { data: batchItems, error: batchItemsError },
      { data: orderItem, error: orderItemError },
      { data: design, error: designError },
    ] = await Promise.all([
      supabase
        .from("batch_items")
        .select("order_item_id, batch_position, status")
        .eq("batch_id", batchId)
        .order("batch_position", { ascending: true }),
      supabase
        .from("order_items")
        .select("id")
        .eq("id", archivedOrderItemId)
        .maybeSingle(),
      supabase
        .from("designs")
        .select("order_item_id")
        .eq("order_item_id", archivedOrderItemId)
        .maybeSingle(),
    ]);

    expect(batchItemsError).toBeNull();
    expect(orderItemError).toBeNull();
    expect(designError).toBeNull();
    expect(batchItems).toEqual(expect.arrayContaining([
      { order_item_id: archivedOrderItemId, batch_position: 2, status: "archived" },
      { order_item_id: activeOrderItemId, batch_position: 1, status: "active" },
    ]));
    expect(orderItem).toEqual({ id: archivedOrderItemId });
    expect(design).toEqual({ order_item_id: archivedOrderItemId });
  });
});
