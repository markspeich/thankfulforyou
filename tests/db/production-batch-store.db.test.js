import { beforeAll, describe, expect, it } from "vitest";

import { loadEnvFile } from "../../tools/env_file.mjs";
import {
  archiveProductionBatch,
  loadProductionBatch,
  saveProductionBatch,
} from "../../api/_lib/production-batch-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";

beforeAll(() => {
  loadEnvFile({ override: true });

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
});
