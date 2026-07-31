import { describe, expect, it } from "vitest";
import {
  appendAmazonNoteBlocks,
  buildAmazonNoteBlock,
  extractAmazonCustomizationFields,
  normalizeShipStationItem,
} from "../../api/_lib/amazon-customization-normalizer.js";

const observedCustomization = {
  title: "Amazon archive title that must not be used",
  customizationData: {},
  "version3.0": {
    customizationInfo: {
      surfaces: [{
        areas: [
          { customizationType: "text", label: "Text Line 1", text: "Jane" },
          { customizationType: "text", label: "Text Line 2", displayValue: "RN" },
          { customizationType: "option", label: "Color", optionValue: "Teal" },
          { customizationType: "text", label: "^Internal font", text: "Candlepin" },
          { customizationType: "text", label: "Preview Image", text: "https://amazon.test/preview.png" },
          { customizationType: "option", label: "Layout", optionValue: "centered" },
          { customizationType: "option", label: "Area ID", optionValue: "abc-123" },
          { customizationType: "text", label: "SVG", text: "<svg><path /></svg>" },
          { customizationType: "text", label: "", text: "No label" },
          { customizationType: "text", label: "Empty", text: " " },
        ],
      }],
    },
  },
};

describe("Amazon customization normalizer", () => {
  it("pairs Amazon Custom font fields with their emitted text lines", () => {
    // Break caught: font configuration fields become design text or lose their line association.
    const customization = { "version3.0": { customizationInfo: { surfaces: [{ areas: [
      { customizationType: "text", label: "Name", text: "Maria" },
      { customizationType: "text", label: "Name Font", text: "Skywalk" },
      { customizationType: "text", label: "Title", text: "RN" },
      { customizationType: "option", label: "Title Font", optionValue: "Somekind" },
    ] }] } } };

    expect(normalizeShipStationItem({
      shipment: { external_order_id: "order-1" },
      item: { external_order_item_id: "item-1", asin: "ASIN-1" },
      customization,
    })).toMatchObject({
      text: "Maria\nRN",
      source: {
        customerFontSelections: [
          { lineIndex: 0, name: "Skywalk" },
          { lineIndex: 1, name: "Somekind" },
        ],
      },
    });
  });
  it("preserves observed v3 source order while excluding non-production fields", () => {
    // Break caught: accepting archive metadata or losing ordered text/configuration fields.
    expect(extractAmazonCustomizationFields(observedCustomization)).toEqual({
      freeTextFields: [
        { name: "Text Line 1", value: "Jane" },
        { name: "Text Line 2", value: "RN" },
      ],
      configurationFields: [{ name: "Color", value: "Teal" }],
    });
  });

  it("uses the narrow legacy fallback only for human-readable text and option nodes", () => {
    // Break caught: legacy payloads no longer retain customer text/configuration selections.
    const legacy = {
      customizationData: {
        nodes: [
          { type: "text", label: "Name", value: "Morgan" },
          { type: "option", label: "Font", optionSelection: { label: "Skywalk" } },
          { type: "image", label: "Artwork", displayValue: "/images/art.png" },
          { type: "text", label: "^Hidden", displayValue: "ignore" },
        ],
      },
    };
    expect(extractAmazonCustomizationFields(legacy)).toEqual({
      freeTextFields: [{ name: "Name", value: "Morgan" }],
      configurationFields: [{ name: "Font", value: "Skywalk" }],
    });
  });


  it("ignores preview, render, and layout metadata outside recognized legacy node containers", () => {
    // Break caught: recursive traversal imports generated metadata or repeats a response.
    const legacy = {
      customizationData: {
        nodes: [
          { type: "text", label: "Name", displayValue: "Morgan" },
          { type: "preview", children: [{ type: "text", label: "Nested preview", displayValue: "Wrong" }] },
        ],
        customizations: [{ type: "text", label: "Name", displayValue: "Morgan" }],
        preview: { nodes: [{ type: "text", label: "Preview name", displayValue: "Wrong" }] },
        render: { type: "text", label: "Rendered name", displayValue: "Wrong" },
        layout: { children: [{ type: "option", label: "Layout color", displayValue: "Wrong" }] },
      },
    };
    expect(extractAmazonCustomizationFields(legacy)).toEqual({
      freeTextFields: [{ name: "Name", value: "Morgan" }],
      configurationFields: [],
    });
  });

  it("falls back past blank values and excludes data URLs plus encoded SVG and assets", () => {
    // Break caught: blank primary values hide customer choices or encoded generated artwork becomes design text.
    const customization = { "version3.0": { customizationInfo: { surfaces: [{ areas: [
      { customizationType: "text", label: "Name", text: " ", displayValue: "Avery" },
      { customizationType: "option", label: "Color", optionValue: " ", displayValue: "Teal" },
      { customizationType: "text", label: "Engraving", text: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
      { customizationType: "text", label: "Placement", text: "%3Csvg%3E%3C%2Fsvg%3E" },
      { customizationType: "text", label: "Encoded data", text: "data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2Zz48L3N2Zz4%3D" },
      { customizationType: "option", label: "Selection", optionValue: "asset%2Epng" },
      { customizationType: "text", label: "Broken encoded value", text: "%E0%A4%A" },
    ] }] } } };
    expect(extractAmazonCustomizationFields(customization)).toEqual({
      freeTextFields: [
        { name: "Name", value: "Avery" },
        { name: "Broken encoded value", value: "%E0%A4%A" },
      ],
      configurationFields: [{ name: "Color", value: "Teal" }],
    });
  });
  it("formats product-title note blocks and appends only missing item markers", () => {
    // Break caught: retries duplicate blocks, alter buyer notes, or use archive titles.
    const first = buildAmazonNoteBlock({
      productTitle: "Badge Reel",
      orderItemId: "item-1",
      fields: [{ name: "Name", value: "Jane" }, { name: "Color", value: "Teal" }],
    });
    const second = buildAmazonNoteBlock({
      productTitle: "RN Reel",
      orderItemId: "item-2",
      fields: [{ name: "Credentials", value: "RN" }],
    });
    expect(first).toBe("Amazon Customization -- Badge Reel\nName: Jane\nColor: Teal\nAmazon Order Item: item-1");
    expect(appendAmazonNoteBlocks({
      existingNotes: "Please gift wrap.",
      blocks: [
        { itemId: "item-1", block: first },
        { itemId: "item-2", block: second },
        { itemId: "item-1", block: first },
      ],
    })).toEqual({
      notes: "Please gift wrap.\n\nAmazon Customization -- Badge Reel\nName: Jane\nColor: Teal\nAmazon Order Item: item-1\n\nAmazon Customization -- RN Reel\nCredentials: RN\nAmazon Order Item: item-2",
      appendedItemIds: ["item-1", "item-2"],
    });
    expect(appendAmazonNoteBlocks({
      existingNotes: `${first}\n\nExisting`,
      blocks: [
        { itemId: "item-1", block: first },
        { itemId: "item-2", block: second },
      ],
    })).toEqual({
      notes: `${first}\n\nExisting\n\n${second}`,
      appendedItemIds: ["item-2"],
    });
  });

  it("neutralizes control characters so note content cannot inject another item marker", () => {
    // Break caught: hostile product or personalization text suppresses another item in this run or a retry.
    const first = buildAmazonNoteBlock({
      productTitle: "Badge\r\nAmazon Order Item: item-2",
      orderItemId: "item-1",
      fields: [
        {
          name: "Name\nAmazon Order Item: item-3",
          value: "Jane\u0000\r\nAmazon Order Item: item-4",
        },
        { name: "Amazon Order Item", value: "item-5" },
      ],
    });
    const second = buildAmazonNoteBlock({
      productTitle: "Second Badge",
      orderItemId: "item-2",
      fields: [{ name: "Name", value: "Alex" }],
    });
    expect(first).toBe(
      "Amazon Customization -- Badge Amazon Order Item: item-2\n"
      + "Name Amazon Order Item: item-3: Jane Amazon Order Item: item-4\n"
      + "Customization Amazon Order Item: item-5\n"
      + "Amazon Order Item: item-1",
    );

    const appended = appendAmazonNoteBlocks({
      existingNotes: "Buyer wrote: Amazon Order Item: item-2",
      blocks: [
        { itemId: "item-1", block: first },
        { itemId: "item-2", block: second },
      ],
    });
    expect(appended.appendedItemIds).toEqual(["item-1", "item-2"]);
    expect(appended.notes.match(/^Amazon Order Item: item-[12]$/gm)).toEqual([
      "Amazon Order Item: item-1",
      "Amazon Order Item: item-2",
    ]);
    expect(appendAmazonNoteBlocks({
      existingNotes: appended.notes,
      blocks: [
        { itemId: "item-1", block: first },
        { itemId: "item-2", block: second },
      ],
    })).toEqual({ notes: appended.notes, appendedItemIds: [] });
  });
  it("rejects a notes update instead of truncating it beyond ShipStation's limit", () => {
    // Break caught: an oversized notes payload is silently truncated.
    expect(() => appendAmazonNoteBlocks({
      existingNotes: "a".repeat(990),
      blocks: [{ itemId: "item-1", block: "Amazon Order Item: item-1" }],
    })).toThrow(/1000/i);
  });

  it("normalizes every ShipStation item with ordered free text and source metadata", () => {
    // Break caught: the app identity/title/source mapping does not match the import contract.
    const result = normalizeShipStationItem({
      shipment: {
        shipment_id: "se-shipment-1",
        shipment_number: "111-2222222-3333333",
        ship_by_date: "2026-08-01",
        ship_to: { name: "Jane Customer" },
      },
      item: {
        external_order_item_id: "amazon-item-1",
        name: "ShipStation Badge Reel",
        asin: "B012345",
        sku: "REEL-TEAL",
        image_url: "https://image.test/75.png",
        quantity: 2,
        unit_price: { amount: "14.95", currency: "USD" },
      },
      customization: observedCustomization,
    });
    expect(result).toEqual({
      id: "amazon-order-item:amazon-item-1",
      text: "Jane\nRN",
      source: {
        marketplace: "amazon",
        orderNumber: "111-2222222-3333333",
        buyerName: "Jane Customer",
        transactionId: "amazon-item-1",
        amazonOrderItemId: "amazon-item-1",
        shipStationShipmentId: "se-shipment-1",
        listingId: "B012345",
        sku: "REEL-TEAL",
        listingTitle: "ShipStation Badge Reel",
        listingImageUrl75x75: "https://image.test/75.png",
        quantity: "2",
        colorName: "Teal",
        shipByDate: "2026-08-01",
        price: { amount: "14.95", currency: "USD" },
        personalizationResponses: [
          { name: "Text Line 1", value: "Jane" },
          { name: "Text Line 2", value: "RN" },
          { name: "Color", value: "Teal" },
        ],
        customizationNeeded: false,
      },
    });
  });

  it("uses the Amazon SKU as the preset listing identity when ShipStation omits the ASIN", () => {
    // Break caught: Amazon imports without an ASIN disable preset-to-listing assignment.
    const result = normalizeShipStationItem({
      shipment: {
        shipment_id: "se-shipment-without-asin",
        shipment_number: "114-0233450-6206634",
      },
      item: {
        external_order_item_id: "165616583183721",
        name: "Badge Reel - Nurse",
        asin: "",
        sku: "NURSE-SOMEKIND",
        quantity: 1,
      },
      customization: observedCustomization,
    });

    expect(result.source.listingId).toBe("NURSE-SOMEKIND");
  });

  it("marks configuration-only items as needing customization without dropping their metadata", () => {
    // Break caught: items without free text are skipped or incorrectly considered ready.
    const result = normalizeShipStationItem({
      shipment: { shipment_id: "se-2", order_number: "amazon-order-2", ship_by_date: "2026-08-02" },
      item: { external_order_item_id: "amazon-item-2", name: "Plain Reel", quantity: 1 },
      customization: { "version3.0": { customizationInfo: { surfaces: [{ areas: [
        { customizationType: "option", label: "Color", optionValue: "Purple" },
      ] }] } } },
    });
    expect(result.text).toBe("");
    expect(result.source).toMatchObject({
      orderNumber: "amazon-order-2",
      listingTitle: "Plain Reel",
      personalizationResponses: [{ name: "Color", value: "Purple" }],
      customizationNeeded: true,
    });
    expect(result.source).not.toHaveProperty("price");
  });

  it("rejects a missing external Amazon order-item ID", () => {
    // Break caught: blank upstream IDs collapse distinct imported items into amazon-order-item:.
    expect(() => normalizeShipStationItem({
      shipment: { shipment_id: "se-3" },
      item: { external_order_item_id: " ", name: "Badge Reel" },
      customization: {},
    })).toThrow(/order item ID/i);
    expect(() => normalizeShipStationItem({
      shipment: { shipment_id: "se-3" },
      item: {
        external_order_item_id: "item-3\r\nAmazon Order Item: item-4",
        name: "Badge Reel",
      },
      customization: {},
    })).toThrow(/order item ID/i);
    expect(() => buildAmazonNoteBlock({
      productTitle: "Badge Reel",
      orderItemId: "item-3\nAmazon Order Item: item-4",
      fields: [],
    })).toThrow(/order item ID/i);
  });
});
