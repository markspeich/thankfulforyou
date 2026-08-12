import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { normalizeEtsyTransaction } from "../../api/_lib/etsy-import-normalizer.js";

const capturedFontChoiceTransaction = JSON.parse(readFileSync(
  new URL("../fixtures/etsy-font-choice-transaction.json", import.meta.url),
  "utf8",
));

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

  it("classifies captured Etsy font dropdown selections without adding them to design text", () => {
    const result = normalizeEtsyTransaction({ receipt: {}, transaction: capturedFontChoiceTransaction });

    expect(result.text).toBe("CPL EDWARDS");
    expect(result.source.customerFontSelections).toEqual([{ lineIndex: 0, name: "Candlepin" }]);
    expect(result.source.variations).toEqual([
      {
        property_id: 514,
        value_id: 114393148710,
        formatted_name: "Badge Reel",
        formatted_value: "Swivel Alligator",
      },
      {
        property_id: 513,
        value_id: 52625096996,
        formatted_name: "Color",
        formatted_value: "Pink",
      },
      {
        property_id: 54,
        value_id: null,
        formatted_name: "Personalization",
        formatted_value: "CPL EDWARDS",
      },
      {
        property_id: 54,
        value_id: 1463105574344,
        formatted_name: "Font Choice",
        formatted_value: "Candlepin",
      },
    ]);
  });

  it("retains non-font dropdown and font-labeled free-text responses as design text", () => {
    const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: "1", variations: [
      { property_id: 54, formatted_name: "Badge Choice", formatted_value: "PICU", value_id: "badge-choice" },
      { property_id: 54, formatted_name: "Font notes", formatted_value: "Use block letters", value_id: null },
    ] } });

    expect(result.text).toBe("PICU\nUse block letters");
    expect(result.source).not.toHaveProperty("customerFontSelections");
  });

  it("does not classify empty or URL-valued font dropdown responses as customer font selections", () => {
    const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: "1", variations: [
      { property_id: 54, formatted_name: "Font Choice", formatted_value: " ", value_id: 100 },
      { property_id: 54, formatted_name: "Font Choice", formatted_value: "https://files.test/font", value_id: 101 },
      { property_id: 54, formatted_name: "Personalization", formatted_value: "Avery", value_id: null },
    ] } });

    expect(result.text).toBe("Avery");
    expect(result.source).not.toHaveProperty("customerFontSelections");
  });

  it("pairs customer font dropdowns ordinally with existing design lines and ignores unmatched selections", () => {
    const result = normalizeEtsyTransaction({ receipt: {}, transaction: { transaction_id: "1", variations: [
      { property_id: 54, formatted_name: "Name", formatted_value: "Maria", value_id: null },
      { property_id: 54, formatted_name: "Credentials", formatted_value: "RN", value_id: null },
      { property_id: 54, formatted_name: "Font Choice", formatted_value: "Skywalk", value_id: "font-1" },
      { property_id: 54, formatted_name: "Font Choice", formatted_value: "Somekind", value_id: "font-2" },
      { property_id: 54, formatted_name: "Font Choice", formatted_value: "Unmatched Font", value_id: "font-3" },
    ] } });

    expect(result.text).toBe("Maria\nRN");
    expect(result.source.customerFontSelections).toEqual([
      { lineIndex: 0, name: "Skywalk" },
      { lineIndex: 1, name: "Somekind" },
    ]);
  });
});
