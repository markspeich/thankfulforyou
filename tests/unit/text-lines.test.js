import { describe, expect, it } from "vitest";

import { getRenderableTextLines } from "../../src/text-lines.js";

describe("renderable text lines", () => {
  it("ignores blank and whitespace-only lines", () => {
    expect(getRenderableTextLines("Ada\n\n   \nRN\n")).toEqual(["Ada", "RN"]);
  });

  it("preserves whitespace within meaningful lines", () => {
    expect(getRenderableTextLines(" Ada Marie \nRN")).toEqual([" Ada Marie ", "RN"]);
  });
});
