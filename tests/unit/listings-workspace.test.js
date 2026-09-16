import { describe, expect, it } from "vitest";

import { applyDraftChanges, normalizeListingDraft } from "../../src/listings-workspace.js";

describe("listings workspace helpers", () => {
  it("normalizes a draft with five editable bullets and image review flags", () => {
    const draft = normalizeListingDraft({
      id: "draft-1",
      title: "Acrylic badge reel",
      bullets: ["One"],
      images: [{ id: "image-1", url: "https://example.com/one.png", selected: true, main: true, approved: true }],
    });

    expect(draft.bullets).toEqual(["One", "", "", "", ""]);
    expect(draft.images[0]).toMatchObject({ id: "image-1", selected: true, main: true, approved: true });
  });

  it("keeps one selected main image when an image is chosen as main", () => {
    const draft = applyDraftChanges(normalizeListingDraft({
      id: "draft-1",
      images: [
        { id: "image-1", url: "one", selected: true, main: true, approved: true },
        { id: "image-2", url: "two", selected: true },
      ],
    }), { imageId: "image-2", main: true });

    expect(draft.images.map(({ id, main, selected }) => ({ id, main, selected }))).toEqual([
      { id: "image-1", main: false, selected: true },
      { id: "image-2", main: true, selected: true },
    ]);
  });

  it("preserves the saved snapshot and invalidates copy approval on copy edits", () => {
    const saved = normalizeListingDraft({ id: "draft-1", title: "Original", copyApproved: true });
    const changed = applyDraftChanges({ ...saved, _saved: saved }, { title: "Revised" });

    expect(changed._saved.title).toBe("Original");
    expect(changed.title).toBe("Revised");
    expect(changed.copyApproved).toBe(false);
  });

  it("preserves per-listing Amazon production details through draft edits", () => {
    const saved = normalizeListingDraft({
      id: "draft-1",
      amazonProductionDetails: {
        packageLengthInches: 3,
        packageWidthInches: 2,
        packageHeightInches: 1,
        packageWeightOunces: 1.1,
        manufacturer: "Thankful For You",
        partNumber: "TFY-4357670739",
        specialFeature: "Personalized",
        closureType: "Clip",
      },
    });
    const changed = applyDraftChanges({ ...saved, _saved: saved }, {
      amazonProductionDetails: { ...saved.amazonProductionDetails, manufacturer: "Thankful For You LLC" },
    });

    expect(saved.amazonProductionDetails).toEqual({
      packageLengthInches: 3,
      packageWidthInches: 2,
      packageHeightInches: 1,
      packageWeightOunces: 1.1,
      manufacturer: "Thankful For You",
      partNumber: "TFY-4357670739",
      specialFeature: "Personalized",
      closureType: "Clip",
    });
    expect(changed.amazonProductionDetails).toMatchObject({ manufacturer: "Thankful For You LLC", packageWeightOunces: 1.1 });
  });
});

 it("merges an uploaded image while retaining unsaved copy and image choices", async () => {
  const { mergeUploadedDraft, normalizeListingDraft } = await import("../../src/listings-workspace.js");
  const saved = normalizeListingDraft({ id: "d", revision: 1, title: "Saved", images: [{ id: "a", selected: true, main: true }] });
  const local = { ...saved, title: "Edited", images: [{ ...saved.images[0], selected: false, main: false }], _saved: saved };
  const server = { ...saved, revision: 2, images: [...saved.images, { id: "b", selected: true, main: false }] };
  const result = mergeUploadedDraft(local, server);
  expect(result.title).toBe("Edited");
  expect(result.revision).toBe(2);
  expect(result.images.map(i => [i.id, i.selected])).toEqual([["a", false], ["b", true]]);
  expect(result._saved.title).toBe("Saved");
  expect(result._saved.revision).toBe(2);
 });
