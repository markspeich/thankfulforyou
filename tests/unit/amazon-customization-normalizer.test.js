import { describe, expect, it } from "vitest";
import {
  appendAmazonNoteBlocks,
  buildAmazonNoteBlock,
  extractAmazonCustomizationFields,
  normalizeShipStationItem,
  summarizeAmazonCustomization,
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
  it("summarizes v3 customization structure without retaining values", () => {
    const privateUrl = "https://amazon.example/customization/private-token";
    const customization = { "version3.0": { customizationInfo: { surfaces: [
      { areas: [
        { customizationType: "text", label: "Name\u0000 Label", text: "PRIVATE CUSTOMER TEXT" },
        { customizationType: "option", label: "Color", optionValue: "Teal" },
        { customizationType: "text", label: "^Internal Font", text: "Candlepin" },
        { customizationType: "text", label: "Link", text: privateUrl },
        { customizationType: "text", label: "Artwork", text: "asset.png" },
        { customizationType: "text", label: "Artwork markup", text: "<svg><path /></svg>" },
        { customizationType: "text", label: "Placement", text: "centered" },
        { customizationType: "text", label: "Blank", text: " " },
        { customizationType: "image", label: "Artwork", displayValue: "logo" },
      ] },
      { areas: [] },
    ] } } };

    const summary = summarizeAmazonCustomization(customization);
    expect(summary).toEqual({
      format: "v3",
      surfaceCount: 2,
      areaCount: 9,
      candidateNodeCount: 9,
      acceptedTextCount: 1,
      acceptedConfigurationCount: 1,
      acceptedLabels: ["Name Label", "Color"],
      rejectedCounts: {
        internal: 1,
        url: 1,
        asset: 1,
        markup: 1,
        metadata_label: 1,
        blank: 1,
        unsupported: 1,
      },
    });
    const serialized = JSON.stringify(summary);
    for (const value of ["PRIVATE CUSTOMER TEXT", privateUrl, "Teal", "Candlepin", "asset.png", "<svg><path /></svg>", "centered", "logo"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("summarizes legacy customization candidates using extraction rules", () => {
    const legacy = { customizationData: { nodes: [
      { type: "text", label: "Name", value: "Morgan" },
      { type: "option", label: "Style", optionSelection: { label: "Skywalk" } },
      { type: "text", label: "^Internal", value: "hidden" },
      { type: "text", label: "Link", value: "https://amazon.example/private" },
      { type: "option", label: "Artwork", optionValue: "art.png" },
      { type: "text", label: "Markup", value: "<path d='private' />" },
      { type: "text", label: "Preview Image", value: "private preview" },
      { type: "text", label: "Blank", value: " " },
      { type: "image", label: "Artwork", displayValue: "private image" },
      { type: "preview", children: [{ type: "text", label: "Ignored", value: "private preview" }] },
    ] } };

    const summary = summarizeAmazonCustomization(legacy);
    expect(summary).toEqual({
      format: "legacy",
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 8,
      acceptedTextCount: 1,
      acceptedConfigurationCount: 1,
      acceptedLabels: ["Name", "Style"],
      rejectedCounts: {
        internal: 1,
        url: 1,
        asset: 1,
        markup: 1,
        metadata_label: 1,
        blank: 1,
      },
    });
    const serialized = JSON.stringify(summary);
    for (const value of ["Morgan", "Skywalk", "hidden", "https://amazon.example/private", "art.png", "<path d='private' />", "private preview", "private image"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("reports empty and unknown customization documents structurally", () => {
    const empty = {
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 0,
      acceptedTextCount: 0,
      acceptedConfigurationCount: 0,
      acceptedLabels: [],
      rejectedCounts: {},
    };
    expect(summarizeAmazonCustomization({})).toEqual({ format: "empty", ...empty });
    expect(summarizeAmazonCustomization({ unexpected: { private: "PRIVATE CUSTOMER TEXT" } })).toEqual({
      format: "unknown",
      ...empty,
    });
  });

  it("bounds empty-document inspection for deeply nested customization data", () => {
    // Break caught: optional structural diagnostics overflow the stack before normalization can run.
    let customization = {};
    for (let depth = 0; depth < 20_000; depth += 1) {
      customization = { customizationData: customization };
    }

    expect(summarizeAmazonCustomization(customization)).toEqual({
      format: "unknown",
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 0,
      acceptedTextCount: 0,
      acceptedConfigurationCount: 0,
      acceptedLabels: [],
      rejectedCounts: {},
    });
  });

  it("deduplicates legacy fields in both extraction and structural summaries", () => {
    // Break caught: diagnostics double-count fields that normalization emits only once.
    const customization = { customizationData: { nodes: [
      { type: "text", label: "Name", value: "Morgan" },
      { type: "text", label: "Name", value: "Morgan" },
      { type: "option", label: "Color", optionValue: "Teal" },
      { type: "option", label: "Color", optionValue: "Teal" },
    ] } };

    expect(extractAmazonCustomizationFields(customization)).toEqual({
      freeTextFields: [{ name: "Name", value: "Morgan" }],
      configurationFields: [{ name: "Color", value: "Teal" }],
    });
    expect(summarizeAmazonCustomization(customization)).toEqual({
      format: "legacy",
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 2,
      acceptedTextCount: 1,
      acceptedConfigurationCount: 1,
      acceptedLabels: ["Name", "Color"],
      rejectedCounts: {},
    });
  });

  it("classifies empty V3 surfaces with usable legacy nodes as legacy everywhere", () => {
    // Break caught: extraction falls back to legacy while diagnostics claim the empty V3 container won.
    const customization = {
      "version3.0": { customizationInfo: { surfaces: [] } },
      customizationData: { nodes: [
        { type: "text", label: "Unknown product label", value: "PRIVATE CUSTOMER TEXT" },
      ] },
    };

    expect(extractAmazonCustomizationFields(customization)).toEqual({
      freeTextFields: [{ name: "Unknown product label", value: "PRIVATE CUSTOMER TEXT" }],
      configurationFields: [],
    });
    const summary = summarizeAmazonCustomization(customization);
    expect(summary).toEqual({
      format: "legacy",
      surfaceCount: 0,
      areaCount: 0,
      candidateNodeCount: 1,
      acceptedTextCount: 1,
      acceptedConfigurationCount: 0,
      acceptedLabels: ["Unknown product label"],
      rejectedCounts: {},
    });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE CUSTOMER TEXT");
  });

  it("treats malformed field labels as rejected structural candidates", () => {
    expect(summarizeAmazonCustomization({ "version3.0": { customizationInfo: { surfaces: [{ areas: [
      { customizationType: "text", label: { private: "PRIVATE CUSTOMER TEXT" }, text: "private" },
    ] }] } } })).toEqual({
      format: "v3",
      surfaceCount: 1,
      areaCount: 1,
      candidateNodeCount: 1,
      acceptedTextCount: 0,
      acceptedConfigurationCount: 0,
      acceptedLabels: [],
      rejectedCounts: { blank: 1 },
    });
  });

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

  it("uses each Amazon v3 text area's fontFamily for its emitted text line", () => {
    // Break caught: v3 text is imported while its directly attached customer font is discarded.
    const customization = { "version3.0": { customizationInfo: { surfaces: [{ areas: [
      { customizationType: "Options", label: "Color", optionValue: "Glitter Blue" },
      { customizationType: "TextPrinting", label: "Name", text: "Alicia", fontFamily: "Skywalk" },
      { customizationType: "TextPrinting", label: "Title", text: "RN", fontFamily: "Somekind" },
      { customizationType: "Options", label: "Badge Reel Type", optionValue: "Swivel Alligator Clip" },
    ] }] } } };

    expect(normalizeShipStationItem({
      shipment: { external_order_id: "111-4206633-6254602" },
      item: { external_order_item_id: "166136048232641", asin: "ASIN-1" },
      customization,
    })).toMatchObject({
      text: "Alicia\nRN",
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
