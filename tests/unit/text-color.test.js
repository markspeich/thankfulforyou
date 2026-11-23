import { describe, expect, it } from "vitest";
import { resolveTextColorName } from "../../src/text-color.js";

describe("resolveTextColorName", () => {
  it("uses the listing text color when present", () => {
    expect(resolveTextColorName({ textColorName: " Gold ", colorName: "White Marble" })).toBe("Gold");
  });

  it("defaults to White when no text color is specified", () => {
    expect(resolveTextColorName({ textColorName: "", colorName: "Teal" })).toBe("White");
    expect(resolveTextColorName({})).toBe("White");
  });

  it("defaults to Black when the color contains the word White", () => {
    expect(resolveTextColorName({ colorName: "white glitter" })).toBe("Black");
    expect(resolveTextColorName({ colorName: "Pearl WHITE" })).toBe("Black");
    expect(resolveTextColorName({ colorName: "Whitewater" })).toBe("White");
  });
});
