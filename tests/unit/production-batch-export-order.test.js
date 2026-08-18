import { describe, expect, test } from "vitest";
import { sortDesignsByImportedColor } from "../../src/production-batch-export-order.js";

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
