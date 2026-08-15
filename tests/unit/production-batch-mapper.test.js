import { describe, expect, it } from "vitest";

import {
  buildProductionBatchRowsFromSnapshot,
  buildSnapshotFromProductionBatchRows,
} from "../../api/_lib/production-batch-mapper.js";

describe("production batch relational snapshot mapping", () => {
  it("splits a saved batch snapshot into order item, design, and design line rows", () => {
    const snapshot = {
      batch: { id: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222" },
      activeOrderItemId: "33333333-3333-4333-8333-333333333333",
      orderItems: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          revision: 4,
          designRevision: 9,
          updatedAt: "2026-05-30T15:30:00.000Z",
          updatedBy: { id: "44444444-4444-4444-8444-444444444444", email: "operator@example.com" },
          text: "Morgan\nRN",
          status: "captured",
          cachedBuild: {
            signature: "completed-signature",
            layout: { svg: "<svg></svg>", bounds: { width: 2.2, height: 1.5 } },
            analysis: { connectedComponents: 1, warnings: [] },
          },
          previousCompletedBuild: {
            signature: "previous-signature",
            layout: { svg: "<svg data-previous></svg>" },
            analysis: { connectedComponents: 2, warnings: ["older geometry"] },
          },
          savedSettingsSignature: "completed-signature",
          completedSettingsSignature: "completed-signature",
          pendingAnalysisSignature: null,
          analysisBadge: {
            state: "ok",
            shortLabel: "1 piece",
            fullLabel: "Connected acrylic layout",
          },
          source: {
            orderNumber: "4057600528",
            listingId: "1884223710",
            transactionId: "5078093505",
            buyerName: "Morgan Avery",
            colorName: "White",
            quantity: "2",
          },
          settings: {
            text: "Morgan\nRN",
            presetId: "preset-c3e8a1d7f520",
            boundingSizePresetId: "size-2-2x1-5",
            backingMm: 3.1,
            weldExportedDesign: true,
            globalHorizontalScale: 1.1,
            globalVerticalScale: 0.95,
            lines: [
              {
                fontId: "skywalk",
                bridgeMm: 0.4,
                lineBridgeMm: 0.5,
                offsetXMm: 0,
                fontSizeMm: 32,
                horizontalScale: 1.2,
                verticalScale: 1,
                lockTextHeight: true,
              },
              {
                fontId: "somekind",
                bridgeMm: 0.6,
                lineBridgeMm: 0.7,
                offsetXMm: 1.5,
                fontSizeMm: 23,
                horizontalScale: 1,
                verticalScale: 1.1,
                lockTextHeight: false,
              },
            ],
          },
        },
      ],
    };

    const rows = buildProductionBatchRowsFromSnapshot(snapshot, {
      workspaceId: "22222222-2222-4222-8222-222222222222",
      updatedBy: "44444444-4444-4444-8444-444444444444",
    });

    expect(rows.batch).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      active_order_item_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(rows.orderItems).toHaveLength(1);
    expect(rows.orderItems[0]).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      order_number: "4057600528",
      listing_id: "1884223710",
      transaction_id: "5078093505",
      buyer_name: "Morgan Avery",
      imported_color: "White",
      quantity: 2,
    });
    expect(rows.designs[0]).toMatchObject({
      order_item_id: "33333333-3333-4333-8333-333333333333",
      design_text: "Morgan\nRN",
      preset_id: "preset-c3e8a1d7f520",
      size_guide_id: "size-2-2x1-5",
      backing_border_mm: 3.1,
      weld_exported_design: true,
      global_horizontal_scale: 1.1,
      global_vertical_scale: 0.95,
      production_status: "saved",
      revision: 9,
      cached_build_json: {
        signature: "completed-signature",
        layout: { svg: "<svg></svg>", bounds: { width: 2.2, height: 1.5 } },
        analysis: { connectedComponents: 1, warnings: [] },
      },
      previous_completed_build_json: {
        signature: "previous-signature",
        layout: { svg: "<svg data-previous></svg>" },
        analysis: { connectedComponents: 2, warnings: ["older geometry"] },
      },
      saved_settings_signature: "completed-signature",
      completed_settings_signature: "completed-signature",
      analysis_badge_json: {
        state: "ok",
        shortLabel: "1 piece",
        fullLabel: "Connected acrylic layout",
      },
    });
    expect(rows.designLines).toEqual([
      expect.objectContaining({
        line_index: 0,
        text: "Morgan",
        font_id: "skywalk",
        letter_bridge_mm: 0.4,
        line_bridge_mm: 0.5,
        text_height_mm: 32,
        lock_text_height: true,
      }),
      expect.objectContaining({
        line_index: 1,
        text: "RN",
        font_id: "somekind",
        letter_bridge_mm: 0.6,
        line_bridge_mm: 0.7,
        offset_x_mm: 1.5,
        text_height_mm: 23,
      }),
    ]);
  });

  it("rebuilds the current API snapshot shape from relational rows", () => {
    const snapshot = buildSnapshotFromProductionBatchRows({
      batch: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "22222222-2222-4222-8222-222222222222",
        active_order_item_id: "33333333-3333-4333-8333-333333333333",
        name: "May 30 Batch",
        status: "active",
        revision: 8,
        updated_at: "2026-05-30T16:00:00.000Z",
      },
      batchItems: [
        {
          order_item_id: "33333333-3333-4333-8333-333333333333",
          batch_position: 0,
          status: "active",
        },
      ],
      orderItems: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          order_number: "4057600528",
          listing_id: "1884223710",
          transaction_id: "5078093505",
          buyer_name: "Morgan Avery",
          imported_color: "White",
          quantity: 2,
          source_json: { listingTitle: "RN Badge Reel" },
          revision: 4,
          updated_at: "2026-05-30T15:30:00.000Z",
          updated_by: "44444444-4444-4444-8444-444444444444",
        },
      ],
      designs: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          order_item_id: "33333333-3333-4333-8333-333333333333",
          design_text: "Morgan\nRN",
          preset_id: "preset-c3e8a1d7f520",
          size_guide_id: "size-2-2x1-5",
          backing_border_mm: 3.1,
          weld_exported_design: true,
          global_horizontal_scale: 1.1,
          global_vertical_scale: 0.95,
          production_status: "saved",
          revision: 9,
          cached_build_json: {
            signature: "completed-signature",
            layout: { svg: "<svg></svg>", bounds: { width: 2.2, height: 1.5 } },
            analysis: { connectedComponents: 1, warnings: [] },
          },
          previous_completed_build_json: {
            signature: "previous-signature",
            layout: { svg: "<svg data-previous></svg>" },
            analysis: { connectedComponents: 2, warnings: ["older geometry"] },
          },
          saved_settings_signature: "completed-signature",
          completed_settings_signature: "completed-signature",
          analysis_badge_json: {
            state: "ok",
            shortLabel: "1 piece",
            fullLabel: "Connected acrylic layout",
          },
        },
      ],
      designLines: [
        {
          design_id: "55555555-5555-4555-8555-555555555555",
          line_index: 0,
          text: "Morgan",
          font_id: "skywalk",
          letter_bridge_mm: 0.4,
          line_bridge_mm: 0.5,
          offset_x_mm: 0,
          text_height_mm: 32,
          horizontal_scale: 1.2,
          vertical_scale: 1,
          lock_text_height: true,
        },
      ],
    });

    expect(snapshot).toEqual({
      batch: {
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        name: "May 30 Batch",
        status: "active",
        revision: 8,
        updatedAt: "2026-05-30T16:00:00.000Z",
      },
      activeOrderItemId: "33333333-3333-4333-8333-333333333333",
      orderItems: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          revision: 4,
          designId: "55555555-5555-4555-8555-555555555555",
          designRevision: 9,
          updatedAt: "2026-05-30T15:30:00.000Z",
          updatedBy: { id: "44444444-4444-4444-8444-444444444444" },
          text: "Morgan\nRN",
          status: "captured",
          cachedBuild: {
            signature: "completed-signature",
            layout: { svg: "<svg></svg>", bounds: { width: 2.2, height: 1.5 } },
            analysis: { connectedComponents: 1, warnings: [] },
          },
          previousCompletedBuild: {
            signature: "previous-signature",
            layout: { svg: "<svg data-previous></svg>" },
            analysis: { connectedComponents: 2, warnings: ["older geometry"] },
          },
          savedSettingsSignature: "completed-signature",
          completedSettingsSignature: "completed-signature",
          pendingAnalysisSignature: null,
          analysisBadge: {
            state: "ok",
            shortLabel: "1 piece",
            fullLabel: "Connected acrylic layout",
          },
          source: {
            orderNumber: "4057600528",
            listingId: "1884223710",
            transactionId: "5078093505",
            buyerName: "Morgan Avery",
            colorName: "White",
            quantity: "2",
            listingTitle: "RN Badge Reel",
          },
          settings: {
            text: "Morgan\nRN",
            presetId: "preset-c3e8a1d7f520",
            boundingSizePresetId: "size-2-2x1-5",
            backingMm: 3.1,
            weldExportedDesign: true,
            globalHorizontalScale: 1.1,
            globalVerticalScale: 0.95,
            lines: [
              {
                fontId: "skywalk",
                bridgeMm: 0.4,
                lineBridgeMm: 0.5,
                offsetXMm: 0,
                fontSizeMm: 32,
                horizontalScale: 1.2,
                verticalScale: 1,
                lockTextHeight: true,
              },
            ],
          },
        },
      ],
    });
  });

  it("restores completed batch items and filters archived batch memberships", () => {
    const snapshot = buildSnapshotFromProductionBatchRows({
      batch: {
        id: "batch-1",
        workspace_id: "workspace-1",
        active_order_item_id: "order-completed",
      },
      batchItems: [
        { order_item_id: "order-completed", batch_position: 0, status: "completed" },
        { order_item_id: "order-archived", batch_position: 1, status: "archived" },
      ],
      orderItems: [
        { id: "order-completed", workspace_id: "workspace-1", source_json: {}, quantity: 1, revision: 2 },
        { id: "order-archived", workspace_id: "workspace-1", source_json: {}, quantity: 1, revision: 3 },
      ],
      designs: [
        { id: "design-completed", order_item_id: "order-completed", design_text: "Done", production_status: "saved" },
        { id: "design-archived", order_item_id: "order-archived", design_text: "Archived", production_status: "saved" },
      ],
      designLines: [],
    });

    expect(snapshot.orderItems).toHaveLength(1);
    expect(snapshot.orderItems[0]).toMatchObject({
      id: "order-completed",
      text: "Done",
      status: "captured",
    });
  });
});
