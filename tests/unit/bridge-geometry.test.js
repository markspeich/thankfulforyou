import { describe, expect, it } from "vitest";

import {
  findPairOffsetPx,
  getOverlapBridgeLengthPx,
} from "../../src/bridge-geometry.js";

function maskFromRows(rows) {
  const height = rows.length;
  const width = Math.max(1, ...rows.map((row) => row.length));
  const opaqueRows = rows.map((row) => {
    const xs = [];
    [...row].forEach((value, x) => {
      if (value === "#") {
        xs.push(x);
      }
    });
    return xs.length ? xs : null;
  });

  return {
    width,
    height,
    baseline: 0,
    opaqueRows,
  };
}

describe("bridge geometry", () => {
  it("counts a vertical overlap tab by its longest connected axis", () => {
    const leftMask = maskFromRows([
      "###.",
      "###.",
      "###.",
      "###.",
      "###.",
    ]);
    const rightMask = maskFromRows([
      "#...",
      "#...",
      "#...",
      "#...",
      "#...",
    ]);

    expect(getOverlapBridgeLengthPx(leftMask, rightMask, 2)).toBe(5);
  });

  it("stops at the first offset with a long enough tab instead of requiring horizontal width", () => {
    const leftMask = maskFromRows([
      "###.",
      "###.",
      "###.",
      "###.",
      "###.",
    ]);
    const rightMask = maskFromRows([
      "#...",
      "#...",
      "#...",
      "#...",
      "#...",
    ]);

    expect(findPairOffsetPx(leftMask, rightMask, 5)).toBe(2);
  });
});
