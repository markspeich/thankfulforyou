import { describe, expect, test } from "vitest";
import {
  buildBatchExportSources,
  sortDesignsByImportedColor,
} from "../../src/production-batch-export-order.js";

describe("production batch export ordering", () => {
  test("sorts design instances by trimmed case-insensitive color while keeping blanks last and ties stable", () => {
    const designs = [
      { id: "first", source: { colorName: "  blue  " } },
      { id: "blank", source: { colorName: "  " } },
      { id: "tie", source: { colorName: "BLUE" } },
      { id: "number10", source: { colorName: "Red 10" } },
      { id: "number2", source: { colorName: "red 2" } },
      { id: "missing" },
      { id: "amber", source: { colorName: " amber" } },
    ];

    expect(sortDesignsByImportedColor(designs).map(({ id }) => id)).toEqual([
      "amber",
      "first",
      "tie",
      "number2",
      "number10",
      "blank",
      "missing",
    ]);
  });
});

describe("production batch export color labels", () => {
  test("appends the order-item count to repeated colors while leaving single and blank colors unchanged", () => {
    const designs = [
      { source: { colorName: "Pink", buyerName: "One" } },
      { source: { colorName: " pink " } },
      { source: { colorName: "PINK" } },
      { source: { colorName: "Blue" } },
      { source: { colorName: "  " } },
      {},
    ];

    expect(buildBatchExportSources(designs)).toEqual([
      { colorName: "Pink x3", buyerName: "One" },
      { colorName: "pink x3" },
      { colorName: "PINK x3" },
      { colorName: "Blue" },
      { colorName: "" },
      {},
    ]);
  });
});
