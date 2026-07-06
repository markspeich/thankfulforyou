import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SCRIPT_PATH = path.resolve("tools/amazon-copy-badge-clipboard.js");
const SCRIPT_SOURCE = fs.existsSync(SCRIPT_PATH) ? fs.readFileSync(SCRIPT_PATH, "utf8") : "";

function makeTextNode(text) {
  return {
    textContent: text,
    innerText: text,
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    closest: vi.fn(() => null),
    getAttribute: vi.fn(() => null),
  };
}

function makeElement({ text = "", innerText = text, attrs = {}, children = [] } = {}) {
  const element = {
    textContent: text,
    innerText: text,
    dataset: {},
    style: {},
    children,
    addEventListener: vi.fn((eventName, handler) => {
      element.handlers[eventName] = handler;
    }),
    append: vi.fn(),
    handlers: {},
    getAttribute: vi.fn((name) => attrs[name] ?? null),
    querySelector: vi.fn((selector) => {
      return children.find((child) => child.matches?.(selector)) || null;
    }),
    querySelectorAll: vi.fn((selector) => {
      return children.filter((child) => child.matches?.(selector));
    }),
    matches: vi.fn(() => false),
  };

  return element;
}

function loadClipboardScript({ rows = [], clipboardText = "", existingCopyButton = true } = {}) {
  const clipboardWrites = [];
  const warnings = [];
  const infos = [];
  const createdButton = makeElement();
  const append = vi.fn();

  const context = {
    window: {
      location: {
        href: "https://sellercentral.amazon.com/orders-v3/order/112-4057450-7843447",
      },
    },
    navigator: {
      clipboard: {
        readText: vi.fn(async () => clipboardText),
        writeText: vi.fn(async (value) => {
          clipboardWrites.push(value);
        }),
      },
    },
    document: {
      querySelector: vi.fn((selector) => {
        if (selector === "[data-badge-clipboard-copy]") {
          return existingCopyButton ? makeElement() : null;
        }

        if (selector === '[data-test-id="order-id-value"]') {
          return makeTextNode("112-4057450-7843447");
        }

        if (selector === '[data-test-id="shipping-section-contact-buyer-value"]') {
          return makeTextNode("Sandi");
        }

        return null;
      }),
      querySelectorAll: vi.fn((selector) => {
        if (selector === "table.a-keyvalue tbody tr") {
          return rows;
        }

        return [];
      }),
      createElement: vi.fn(() => createdButton),
      body: { append },
    },
    console: {
      warn: vi.fn((...args) => warnings.push(args)),
      info: vi.fn((...args) => infos.push(args)),
      error: vi.fn(),
    },
    setTimeout: vi.fn((handler) => {
      if (typeof handler === "function") {
        handler();
      }
    }),
    clearTimeout: vi.fn(),
    Date,
    JSON,
    URL,
  };

  vm.runInNewContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH });

  return {
    context,
    clipboardWrites,
    warnings,
    infos,
    createdButton,
    append,
  };
}

function makeOrderItemRow({
  status = "Unshipped",
  imageUrl = "https://example.test/badge.jpg",
  title = "Personalized Nurse Badge Reel",
  asin = "B0H6ND1TL3",
  sku = "SP-L6CS-62RE",
  orderItemId = "164046088443801",
  quantity = "1",
  customizationText = "",
} = {}) {
  const image = makeElement({ attrs: { src: imageUrl } });
  image.matches = vi.fn((selector) => selector === "img");

  const link = makeElement({ attrs: { href: `https://www.amazon.com/gp/product/${asin}` }, text: title });
  link.matches = vi.fn((selector) => selector === 'a[href*="/gp/product/"]');

  return makeElement({
    text: [
      status,
      title,
      `ASIN : ${asin}`,
      `SKU : ${sku}`,
      customizationText,
      `Order Item ID : ${orderItemId}`,
      quantity,
    ].join("\n"),
    children: [image, link],
  });
}

describe("amazon copy badge clipboard", () => {
  it("labels the injected Amazon copy button as Copy Orders", () => {
    const { createdButton, append } = loadClipboardScript({ existingCopyButton: false });

    expect(createdButton.textContent).toBe("Copy Orders");
    expect(append).toHaveBeenCalledWith(createdButton);
  });

  it("copies Amazon order metadata and clipboard customization text as separate design lines", async () => {
    const row = makeOrderItemRow();
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [row],
      clipboardText: [
        "Customizations:",
        "Surface 1:",
        "Color: Sky Blue",
        "Name Font: Candlepin",
        "Name Color: White (#ffffff)",
        "Name: Sandi S",
        "Title Font: Somekind",
        "Title Color: White (#ffffff)",
        "Title: RN",
        "Badge Reel Type: Belt Clip",
      ].join("\n"),
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    expect(clipboardWrites).toHaveLength(1);
    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.source).toBe("thankfulforyou-amazon-clipboard");
    expect(payload.items).toEqual([
      expect.objectContaining({
        orderNumber: "112-4057450-7843447",
        listingId: "B0H6ND1TL3",
        transactionId: "164046088443801",
        buyerName: "Sandi",
        colorName: "Sky Blue",
        quantity: "1",
        listingTitle: "Personalized Nurse Badge Reel",
        listingImageUrl75x75: "https://example.test/badge.jpg",
        personalization: "Sandi S\nRN",
      }),
    ]);
  });
  it("copies color and quantity when Amazon customization text is copied as one paragraph", async () => {
    const row = makeOrderItemRow({ quantity: "3" });
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [row],
      clipboardText: "Customizations: Surface 1: Color: Sky Blue Name Font: Candlepin Name Color: White (#ffffff) Name: Sandi S Title Font: Somekind Title Color: White (#ffffff) Title: RN Badge Reel Type: Belt Clip",
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items[0]).toMatchObject({
      colorName: "Sky Blue",
      quantity: "3",
      personalization: "Sandi S\nRN",
    });
  });
  it("copies color and design lines when Amazon customization text has labels and values on separate lines", async () => {
    const row = makeOrderItemRow();
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [row],
      clipboardText: [
        "Customizations",
        "Surface 1",
        "Color",
        "Sky Blue",
        "Name Font",
        "Candlepin",
        "Name Color",
        "White (#ffffff)",
        "Name",
        "Sandi S",
        "Title Font",
        "Somekind",
        "Title Color",
        "White (#ffffff)",
        "Title",
        "RN",
        "Badge Reel Type",
        "Belt Clip",
      ].join("\n"),
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items[0]).toMatchObject({
      colorName: "Sky Blue",
      quantity: "1",
      personalization: "Sandi S\nRN",
    });
  });

  it("maps multiple copied customization blocks to multiple Amazon item rows", async () => {
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [
        makeOrderItemRow({ orderItemId: "item-1" }),
        makeOrderItemRow({ orderItemId: "item-2", quantity: "2" }),
      ],
      clipboardText: [
        "Customizations:",
        "Surface 1:",
        "Color: Sky Blue",
        "Name: Sandi S",
        "Title: RN",
        "Customizations:",
        "Surface 1:",
        "Color: Pink",
        "Name: Lauren",
        "Title: RN",
      ].join("\n"),
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items).toMatchObject([
      { transactionId: "item-1", colorName: "Sky Blue", personalization: "Sandi S\nRN" },
      { transactionId: "item-2", colorName: "Pink", quantity: "2", personalization: "Lauren\nRN" },
    ]);
  });
  it("copies color and text lines from Amazon detail-page customization markup when clipboard text is empty", async () => {
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [makeOrderItemRow({
        customizationText: [
          "Customizations:",
          "Surface 1:",
          "Color: Navy Blue",
          "Text: Candlepin",
          "Color: White (#ffffff)",
          "Text Line 1: SAUTARIA",
          "Text Line 2: P.A.M.",
          "Text Line 3: Rehab",
          "Badge Reel Type: Swivel Alligator Clip",
        ].join("\n"),
      })],
      clipboardText: "",
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items[0]).toMatchObject({
      colorName: "Navy Blue",
      quantity: "1",
      personalization: "SAUTARIA\nP.A.M.\nRehab",
    });
  });
  it("reads hidden Amazon customization markup from textContent when innerText omits collapsed details", async () => {
    const row = makeOrderItemRow({
      customizationText: [
        "Customizations:",
        "Surface 1:",
        "Color: Navy Blue",
        "Text Line 1: SAUTARIA",
        "Text Line 2: P.A.M.",
      ].join("\n"),
    });
    row.innerText = [
      "Unshipped",
      "Personalized Nurse Badge Reel",
      "ASIN : B0H6ND1TL3",
      "SKU : SP-L6CS-62RE",
      "Order Item ID : 164046088443801",
      "1",
    ].join("\n");

    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [row],
      clipboardText: "",
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items[0]).toMatchObject({
      colorName: "Navy Blue",
      personalization: "SAUTARIA\nP.A.M.",
    });
  });
  it("uses page customization fields when the clipboard already contains an Amazon payload", async () => {
    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [makeOrderItemRow({
        customizationText: [
          "Customizations:",
          "Surface 1:",
          "Color: Slate Blue",
          "Text: Candlepin",
          "Color: White (#ffffff)",
          "Text Line 1: eLma",
          "Text Line 2: bsn, rn",
          "Badge Reel Type: Heavy Duty Metal Belt Clip",
        ].join("\n"),
      })],
      clipboardText: JSON.stringify({
        source: "thankfulforyou-amazon-clipboard",
        version: 1,
        items: [{ colorName: "", personalization: "" }],
      }, null, 2),
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items[0]).toMatchObject({
      colorName: "Slate Blue",
      quantity: "1",
      personalization: "eLma\nbsn, rn",
    });
  });

  it("deduplicates nested Amazon table rows for the same order item", async () => {
    const realRow = makeOrderItemRow({
      orderItemId: "164074811979521",
      customizationText: [
        "Customizations:",
        "Surface 1:",
        "Color: Navy Blue",
        "Text Line 1: SAUTARIA",
      ].join("\n"),
    });
    const duplicateSubtotalRow = makeOrderItemRow({
      orderItemId: "164074811979521",
      customizationText: "",
    });
    duplicateSubtotalRow.textContent = duplicateSubtotalRow.textContent.replace(
      "Order Item ID : 164074811979521\n1",
      "Order Item ID : 1640748119795211Item subtotal:$24.99",
    );
    duplicateSubtotalRow.innerText = duplicateSubtotalRow.textContent;

    const { createdButton, clipboardWrites } = loadClipboardScript({
      rows: [realRow, duplicateSubtotalRow],
      clipboardText: "",
      existingCopyButton: false,
    });

    await createdButton.handlers.click();

    const payload = JSON.parse(clipboardWrites[0]);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      transactionId: "164074811979521",
      colorName: "Navy Blue",
      personalization: "SAUTARIA",
    });
  });
});