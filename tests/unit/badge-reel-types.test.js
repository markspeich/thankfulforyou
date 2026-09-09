import { describe, expect, it } from "vitest";
import {
  badgeReelTypeLabel,
  findBadgeReelTypeCandidate,
  resolveBadgeReelTypeId,
} from "../../src/badge-reel-types.js";

describe("badge reel type catalog", () => {
  it("resolves every recognized marketplace alias to the stable ID", () => {
    expect(resolveBadgeReelTypeId("Swivel Alligator")).toBe("swivel-alligator");
    expect(resolveBadgeReelTypeId("Swivel Alligator Clip")).toBe("swivel-alligator");
  });

  it("normalizes casing, surrounding whitespace, punctuation, and repeated whitespace", () => {
    expect(resolveBadgeReelTypeId("  SWIVEL---alligator   CLIP! ")).toBe("swivel-alligator");
  });

  it("does not resolve partial or fuzzy marketplace values", () => {
    expect(resolveBadgeReelTypeId("Alligator Clip")).toBeNull();
    expect(resolveBadgeReelTypeId("Swivel Alligator Clip Large")).toBeNull();
  });

  it("returns the display label for a known canonical ID", () => {
    expect(badgeReelTypeLabel("swivel-alligator")).toBe("Swivel Alligator");
  });

  it("returns null for unknown marketplace values and canonical IDs", () => {
    expect(resolveBadgeReelTypeId("Magnetic")).toBeNull();
    expect(resolveBadgeReelTypeId("   ")).toBeNull();
    expect(badgeReelTypeLabel("magnetic")).toBeNull();
    expect(badgeReelTypeLabel("  swivel-alligator ")).toBeNull();
  });

  it("selects the first exactly labelled marketplace entry even when its value is unknown", () => {
    expect(findBadgeReelTypeCandidate([
      { label: "Color", value: "Teal" },
      { label: "Badge Reel Type", value: "Magnetic" },
      { label: "Badge Reel", value: "Swivel Alligator Clip" },
    ], { label: "label", value: "value" })).toEqual({
      rawValue: "Magnetic",
      id: null,
    });
  });

  it("recognizes only exact normalized Badge Reel labels", () => {
    expect(findBadgeReelTypeCandidate([
      { label: "badge--reel", value: "Swivel Alligator" },
    ], { label: "label", value: "value" })).toEqual({
      rawValue: "Swivel Alligator",
      id: "swivel-alligator",
    });
    expect(findBadgeReelTypeCandidate([
      { label: "Badge Reel Style", value: "Swivel Alligator" },
    ], { label: "label", value: "value" })).toBeNull();
  });
});
