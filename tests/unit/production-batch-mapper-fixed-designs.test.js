import { describe, expect, it } from "vitest";

import {
  buildProductionBatchRowsFromSnapshot,
  buildSnapshotFromProductionBatchRows,
} from "../../api/_lib/production-batch-mapper.js";

describe("production batch mapper fixed design items", () => {
  it("round-trips mixed text and fixed SVG design lines", () => {
    const snapshot = {
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [
        {
          id: "order-1",
          text: "Morgan\nRN",
          status: "captured",
          source: {},
          settings: {
            text: "Morgan\nRN",
            lines: [
              { kind: "text", fontId: "skywalk", fontSizeMm: 30 },
              {
                kind: "fixedSvg",
                fixedDesignId: "nurse-cross",
                fixedDesignVersion: 3,
                svgSizeMm: 38,
                offsetXMm: 2,
                offsetYMm: -7,
              },
              { kind: "text", fontId: "somekind", fontSizeMm: 23 },
            ],
          },
        },
      ],
    };

    const rows = buildProductionBatchRowsFromSnapshot(snapshot, {
      workspaceId: "workspace-1",
      updatedBy: "operator-1",
    });

    expect(rows.designLines.map((line) => ({
      line_index: line.line_index,
      item_kind: line.item_kind,
      text: line.text,
      fixed_design_id: line.fixed_design_id,
      fixed_design_version: line.fixed_design_version,
      svg_size_mm: line.svg_size_mm,
      offset_x_mm: line.offset_x_mm,
      offset_y_mm: line.offset_y_mm,
    }))).toEqual([
      {
        line_index: 0,
        item_kind: "text",
        text: "Morgan",
        fixed_design_id: null,
        fixed_design_version: null,
        svg_size_mm: 32,
        offset_x_mm: 0,
        offset_y_mm: 0,
      },
      {
        line_index: 1,
        item_kind: "fixed_svg",
        text: "",
        fixed_design_id: "nurse-cross",
        fixed_design_version: 3,
        svg_size_mm: 38,
        offset_x_mm: 2,
        offset_y_mm: -7,
      },
      {
        line_index: 2,
        item_kind: "text",
        text: "RN",
        fixed_design_id: null,
        fixed_design_version: null,
        svg_size_mm: 32,
        offset_x_mm: 0,
        offset_y_mm: 0,
      },
    ]);

    const restored = buildSnapshotFromProductionBatchRows({
      batch: {
        id: "batch-1",
        workspace_id: "workspace-1",
        active_order_item_id: "order-1",
      },
      batchItems: [{ order_item_id: "order-1", batch_position: 0, status: "active" }],
      orderItems: [{ id: "order-1", workspace_id: "workspace-1", source_json: {}, quantity: 1 }],
      designs: [{ id: "design-1", order_item_id: "order-1", design_text: "Morgan\nRN", production_status: "saved" }],
      designLines: rows.designLines.map(({ order_item_id: _orderItemId, ...line }) => ({
        ...line,
        design_id: "design-1",
      })),
    });

    expect(restored.orderItems[0].settings.lines).toEqual([
      expect.objectContaining({ kind: "text", fontId: "skywalk", fontSizeMm: 30 }),
      {
        kind: "fixedSvg",
        fixedDesignId: "nurse-cross",
        fixedDesignVersion: 3,
        svgSizeMm: 38,
        offsetXMm: 2,
        offsetYMm: -7,
      },
      expect.objectContaining({ kind: "text", fontId: "somekind", fontSizeMm: 23 }),
    ]);
  });
});
