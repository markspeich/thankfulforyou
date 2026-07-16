import { describe, expect, it } from "vitest";
import { normalizeEtsyTransaction } from "../../api/_lib/etsy-import-normalizer.js";

describe("Etsy transaction normalizer", () => {
  it("creates the imported item contract with text and file personalization", () => {
    const result = normalizeEtsyTransaction({
      receipt: { receipt_id: 1234567890, name: "Buyer", create_timestamp: 10 },
      transaction: { transaction_id: 987, listing_id: 456, quantity: 2, title: "Badge", variations: [
        { property_id: 200, formatted_name: "Color", formatted_value: "Teal" },
        { property_id: 54, formatted_name: "Name", formatted_value: "Jamie" },
        { property_id: "54", formatted_name: "Credentials", formatted_value: "RN" },
        { property_id: 54, formatted_name: "Upload", formatted_value: "https://files.test/a" },
      ] },
      image: { url_75x75: "https://image.test/75" }, getPresetIdForListingId: (id) => `preset-${id}`,
    });
    expect(result).toMatchObject({ id: "transaction:987", text: "Jamie\nRN", presetId: "preset-456", source: { orderNumber: "1234567890", transactionId: "987", listingId: "456", colorName: "Teal", quantity: "2", listingImageUrl75x75: "https://image.test/75", customizationNeeded: false } });
    expect(result.source.personalizationResponses.map(({ kind, label, value }) => ({ kind, label, value }))).toEqual([
      { kind: "text", label: "Name", value: "Jamie" }, { kind: "text", label: "Credentials", value: "RN" }, { kind: "file", label: "Upload", value: "https://files.test/a" },
    ]);
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

  it("marks missing, blank, or URL-only personalization for customization", () => {
    for (const variations of [[], [{ property_id: 54, formatted_name: "Name", formatted_value: " " }], [{ property_id: 54, formatted_name: "Upload", formatted_value: "https://x.test/a" }]]) {
      const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: 1, variations } });
      expect(result.text).toBe(""); expect(result.source.customizationNeeded).toBe(true);
    }
  });
});
