import { describe, expect, it } from "vitest";
import { normalizeEtsyTransaction } from "../../api/_lib/etsy-import-normalizer.js";

describe("Etsy transaction normalizer", () => {
  it("creates the imported item contract with text and file personalization", () => {
    const result = normalizeEtsyTransaction({
      receipt: { receipt_id: 1234567890, name: "Buyer", create_timestamp: 10 },
      transaction: { transaction_id: 987, listing_id: 456, quantity: 2, title: "Badge", expected_ship_date: 1783400340, variations: [
        { property_id: 200, formatted_name: "Color", formatted_value: "Teal" },
        { property_id: 54, formatted_name: "Name", formatted_value: "Jamie" },
        { property_id: "54", formatted_name: "Credentials", formatted_value: "RN" },
        { property_id: 54, formatted_name: "Upload", formatted_value: "https://files.test/a" },
      ] },
      image: { url_75x75: "https://image.test/75" }, getPresetIdForListingId: (id) => `preset-${id}`,
    });
    expect(result).toMatchObject({ id: "transaction:987", text: "Jamie\nRN", presetId: "preset-456", source: { orderNumber: "1234567890", transactionId: "987", listingId: "456", colorName: "Teal", quantity: "2", expected_ship_date: 1783400340, shipByDate: "2026-07-06", listingImageUrl75x75: "https://image.test/75" } });
    expect(result.source).not.toHaveProperty("customizationNeeded");
    expect(result.source.personalizationResponses).toEqual([
      { kind: "text", name: "Name", value: "Jamie" }, { kind: "text", name: "Credentials", value: "RN" }, { kind: "file", name: "Upload", value: "https://files.test/a" },
    ]);
  });

  it("retains a missing Etsy expected ship date as null", () => {
    const result = normalizeEtsyTransaction({
      receipt: { receipt_id: 123 },
      transaction: { transaction_id: 456, listing_id: 789, variations: [] },
    });

    expect(result.source.expected_ship_date).toBeNull();
    expect(result.source.shipByDate).toBe("");
  });

  it("supports renamed questions/dropdowns, excludes ordinary variations, and cleans imported text", () => {
    const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: "1", variations: [
      { property_id: "54", formatted_name: "Who is this for?", formatted_value: "JosÃ© &amp; Ana" },
      { property_id: 54, formatted_name: "Badge choice", formatted_value: "PICU" },
      { property_id: 20, formatted_name: "Font", formatted_value: "Skywalk" },
    ] } });
    expect(result.text).toBe("José & Ana\nPICU");
    expect(result.source.variations).toHaveLength(3);
  });

  it("allows missing, blank, or URL-only Etsy personalization without requesting review", () => {
    for (const variations of [
      [],
      [{ property_id: 54, formatted_name: "Name", formatted_value: " " }],
      [{ property_id: 54, formatted_name: "Upload", formatted_value: "https://x.test/a" }],
    ]) {
      const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: 1, variations } });
      expect(result.text).toBe("");
      expect(result.source).not.toHaveProperty("customizationNeeded");
    }
  });
});
