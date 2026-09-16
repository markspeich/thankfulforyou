import { describe, expect, it } from "vitest";

import {
  cleanCopyPrompt,
  normalizeListingChanges,
  parseEtsyListingSource,
  applyListingChanges,
} from "../../api/_lib/listing-store.js";

describe("listing draft behavior", () => {
  it("normalizes a nonempty workspace copy prompt within the configured limit", () => {
    expect(cleanCopyPrompt("  Make concise copy.  ")).toBe("Make concise copy.");
    expect(() => cleanCopyPrompt(" ")).toThrow("copy prompt");
    expect(() => cleanCopyPrompt("x".repeat(20_001))).toThrow("copy prompt");
  });
  it("rejects a pasted Etsy URL for a different path", () => {
    // Break caught: arbitrary Etsy URLs become server-side fetch targets.
    expect(() => parseEtsyListingSource("https://www.etsy.com/shop/example")).toThrow("Etsy listing URL or ID");
  });

  it("preserves non-edited draft fields and invalidates copy approval when copy changes", () => {
    // Break caught: an edit can leave stale copy approval true.
    const result = applyListingChanges({
      title: "Old title", description: "Old description", bullets: ["1", "2", "3", "4", "5"],
      basePriceCents: 1999, copyApproved: true, images: [], facts: { retained: true }, warnings: ["saved"],
    }, normalizeListingChanges({ title: "New title" }));
    expect(result).toMatchObject({ title: "New title", copyApproved: false, facts: { retained: true }, warnings: ["saved"] });
  });

  it("only permits review flags for image ids already in the draft", () => {
    // Break caught: a workspace can attach another draft's asset by id.
    expect(() => normalizeListingChanges({ images: [{ id: "foreign", selected: true }] }, [{ id: "owned" }])).toThrow("image");
  });

  it("normalizes complete Amazon production details without revoking copy approval", () => {
    // Break caught: production-only edits either accept malformed package data or invalidate reviewed copy.
    const details = {
      packageLengthInches: 3, packageWidthInches: 2, packageHeightInches: 1, packageWeightOunces: 1.1,
      manufacturer: "  Thankful For You  ", partNumber: " TFY-123 ", specialFeature: " Personalized ", closureType: " Clip ",
    };
    const changes = normalizeListingChanges({ amazonProductionDetails: details });
    const result = applyListingChanges({ copyApproved: true, images: [] }, changes);
    expect(changes.amazonProductionDetails).toEqual({ ...details, manufacturer: "Thankful For You", partNumber: "TFY-123", specialFeature: "Personalized", closureType: "Clip" });
    expect(result.copyApproved).toBe(true);
  });

  it.each([
    { packageWeightOunces: 0 },
    { packageLengthInches: Number.POSITIVE_INFINITY },
    { manufacturer: " " },
    { partNumber: "x".repeat(201) },
    { extra: "not allowed" },
    { packageHeightInches: undefined },
  ])("rejects incomplete or invalid Amazon production details: %o", (patch) => {
    // Break caught: malformed package attributes reach Amazon production validation.
    const details = {
      packageLengthInches: 3, packageWidthInches: 2, packageHeightInches: 1, packageWeightOunces: 1.1,
      manufacturer: "Thankful For You", partNumber: "TFY-123", specialFeature: "Personalized", closureType: "Clip", ...patch,
    };
    expect(() => normalizeListingChanges({ amazonProductionDetails: details })).toThrow(/amazonProductionDetails|package|manufacturer|partNumber/i);
  });
});
