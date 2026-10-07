import { describe, expect, test } from "vitest";
import {
  buildBatchExportSources,
  sortDesignsByImportedColor,
} from "../../src/production-batch-export-order.js";

describe("production batch export ordering", () => {
  test("groups solids before glitter before mirror before missing colors without changing the queue", () => {
    const designs = [
      { id: "mirrorZ", source: { colorName: " Z MIRROR " } },
      { id: "blank", source: { colorName: "  " } },
      { id: "glitterZ", source: { colorName: "Z gLiTtEr" } },
      { id: "solidZ", source: { colorName: "Zebra" } },
      { id: "mirrorA", source: { colorName: "A mirror" } },
      { id: "missing" },
      { id: "glitterA", source: { colorName: " A GLITTER " } },
      { id: "solidA", source: { colorName: "Amber" } },
      { id: "glitterTie", source: { colorName: "a glitter" } },
      { id: "null", source: { colorName: null } },
      { id: "empty", source: { colorName: "" } },
    ];
    const original = structuredClone(designs);

    expect(sortDesignsByImportedColor(designs).map(({ id }) => id)).toEqual([
      "solidA", "solidZ", "glitterA", "glitterTie", "glitterZ",
      "mirrorA", "mirrorZ", "blank", "missing", "null", "empty",
    ]);
    expect(designs).toEqual(original);
  });

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
  test("counts purchased items across same-color designs rather than design rows", () => {
    const designs = [
      { source: { colorName: "Pink", quantity: "2" } },
      { source: { colorName: " pink ", quantity: "3" } },
      { source: { colorName: "Blue", quantity: "4" } },
    ];

    expect(buildBatchExportSources(designs)).toEqual([
      { colorName: "Pink x5", quantity: "2" },
      { colorName: "pink x5", quantity: "3" },
      { colorName: "Blue x4", quantity: "4" },
    ]);
    expect(designs[0].source.colorName).toBe("Pink");
  });

  test("defaults missing or invalid quantities to one item", () => {
    const designs = [undefined, "", "invalid", "0", "-2", " 2 ", 3].map((quantity) => ({
      source: { colorName: "Pink", quantity },
    }));

    expect(buildBatchExportSources(designs).map((source) => source.colorName)).toEqual(
      Array(7).fill("Pink x10"),
    );
  });

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
