import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildImportedBatchIdentity,
  parseImportedItems,
} from "../../src/etsy-import.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Etsy import parsing", () => {
  it("parses object payload items into normalized imported items", () => {
    const getPresetIdForListingId = vi.fn((listingId) => {
      return listingId === "listing-1" ? "preset-candlepin" : null;
    });
    const payload = {
      items: [
        {
          personalization: "  Jane &amp; Max  ",
          orderNumber: 1234,
          listingId: "listing-1",
          buyerName: "Ava &amp; Co",
          colorName: "  Ruby &gt; Clear ",
          quantity: 2,
          listingTitle: "Badge &quot;Reel&quot;",
          listingImageUrl75x75: " https://example.test/image.jpg ",
          transactionId: " txn-1 ",
        },
      ],
    };

    expect(parseImportedItems(JSON.stringify(payload), { getPresetIdForListingId })).toEqual([
      {
        text: "Jane & Max",
        presetId: "preset-candlepin",
        source: {
          orderNumber: "1234",
          listingId: "listing-1",
          buyerName: "Ava & Co",
          colorName: "Ruby > Clear",
          quantity: "2",
          listingTitle: "Badge \"Reel\"",
          listingImageUrl75x75: "https://example.test/image.jpg",
          transactionId: "txn-1",
        },
      },
    ]);
    expect(getPresetIdForListingId).toHaveBeenCalledWith("listing-1");
  });

  it("preserves Etsy order entries without personalization text", () => {
    const payload = {
      items: [
        { personalization: "", listingId: "listing-1", orderNumber: "1001" },
        { listingId: "listing-2", transactionId: "txn-2" },
        { text: "  Chris  ", listingId: "listing-3" },
      ],
    };

    expect(parseImportedItems(JSON.stringify(payload))).toEqual([
      {
        text: "",
        presetId: null,
        source: {
          orderNumber: "1001",
          listingId: "listing-1",
          buyerName: "",
          colorName: "",
          quantity: "",
          listingTitle: "",
          listingImageUrl75x75: "",
          transactionId: "",
        },
      },
      {
        text: "",
        presetId: null,
        source: {
          orderNumber: "",
          listingId: "listing-2",
          buyerName: "",
          colorName: "",
          quantity: "",
          listingTitle: "",
          listingImageUrl75x75: "",
          transactionId: "txn-2",
        },
      },
      {
        text: "Chris",
        presetId: null,
        source: {
          orderNumber: "",
          listingId: "listing-3",
          buyerName: "",
          colorName: "",
          quantity: "",
          listingTitle: "",
          listingImageUrl75x75: "",
          transactionId: "",
        },
      },
    ]);
  });

  it("preserves malformed numeric HTML entities in personalization text", () => {
    expect(parseImportedItems(JSON.stringify({
      items: [{ personalization: "A &#999999999999; B" }],
    }))).toMatchObject([
      { text: "A &#999999999999; B" },
    ]);
  });

  it("preserves malformed numeric HTML entities when document exists", () => {
    const documentStub = {
      createElement: vi.fn(() => {
        return {
          value: "",
          set innerHTML(value) {
            this.value = value.replace("&#999999999999;", "\ufffd");
          },
        };
      }),
    };
    vi.stubGlobal("document", documentStub);

    expect(parseImportedItems(JSON.stringify({
      items: [{ personalization: "A &#999999999999; B" }],
    }))).toMatchObject([
      { text: "A &#999999999999; B" },
    ]);
  });

  it("builds stable imported identities using transaction id first", () => {
    expect(buildImportedBatchIdentity({
      transactionId: " txn-9 ",
      orderNumber: "1000",
      listingId: "listing-1",
      buyerName: "Morgan",
    }, "Ignored")).toBe("transaction:txn-9");
  });

  it("builds stable imported identities using fallback order details", () => {
    expect(buildImportedBatchIdentity({
      orderNumber: " 1000 ",
      listingId: " listing-1 ",
      buyerName: " Morgan ",
    }, "  Jordan RN  ")).toBe("fallback:1000|listing-1|Morgan|Jordan RN");
  });

  it("returns an empty import list when every raw entry lacks text and Etsy identity", () => {
    expect(parseImportedItems(JSON.stringify({ items: [
      { personalization: "   " },
      {},
    ] }))).toEqual([]);
  });

  it("throws when payloads do not contain Etsy designs", () => {
    expect(() => parseImportedItems(JSON.stringify({ items: [] }))).toThrow(
      "Clipboard data did not contain any Etsy designs.",
    );
  });
});
