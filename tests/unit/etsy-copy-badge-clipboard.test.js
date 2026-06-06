import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SCRIPT_PATH = path.resolve("tools/etsy-copy-badge-clipboard.js");
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, "utf8");

function loadClipboardScript(orders, options = {}) {
  const clipboardWrites = [];
  const warnings = [];
  const infos = [];
  const createdButton = {
    style: {},
    dataset: {},
    addEventListener: vi.fn(),
  };
  const querySelector = vi.fn(() => {
    return options.existingCopyButton === false ? null : { dataset: { badgeClipboardCopy: "true" } };
  });
  const createElement = vi.fn(() => createdButton);
  const append = vi.fn();

  const context = {
    window: {
      Etsy: {
        Context: {
          data: {
            initial_data: {
              orders: {
                orders_search: {
                  orders,
                },
              },
            },
          },
        },
      },
    },
    navigator: {
      clipboard: {
        writeText: vi.fn(async (value) => {
          clipboardWrites.push(value);
        }),
      },
    },
    document: {
      querySelector,
      createElement,
      body: { append },
    },
    console: {
      warn: vi.fn((...args) => warnings.push(args)),
      info: vi.fn((...args) => infos.push(args)),
      error: vi.fn(),
    },
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    Date,
    JSON,
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

describe("etsy copy badge clipboard", () => {
  it("labels the injected Etsy copy button as Copy Orders", () => {
    const { createdButton, append } = loadClipboardScript([], { existingCopyButton: false });

    expect(createdButton.textContent).toBe("Copy Orders");
    expect(append).toHaveBeenCalledWith(createdButton);
  });

  it("reports skipped orders that have no personalization variation", async () => {
    const { context, warnings, clipboardWrites } = loadClipboardScript([
      {
        order_id: 1,
        fulfillment: { to_address: { name: "Taylor" } },
        transactions: [
          {
            transaction_id: 11,
            listing_id: 111,
            quantity: 1,
            product: { title: "Badge Reel" },
            variations: [
              { property: "Color", value: "Pink" },
              { property: "Personalization", value: "Taylor RN" },
            ],
          },
        ],
      },
      {
        order_id: 2,
        fulfillment: { to_address: { name: "Jordan" } },
        transactions: [
          {
            transaction_id: 22,
            listing_id: 222,
            quantity: 1,
            product: { title: "Admin Assistant Badge Reel" },
            variations: [
              { property: "Color", value: "Glitter White" },
            ],
          },
        ],
      },
    ]);

    await context.copyBadgeBatchPayload();

    expect(clipboardWrites).toHaveLength(1);
    expect(warnings).toContainEqual([
      "Skipped 1 Etsy order(s) while building the badge batch.",
      [
        {
          orderNumber: "2",
          buyerName: "Jordan",
          transactionId: "22",
          listingId: "222",
          listingTitle: "Admin Assistant Badge Reel",
          reason: "Missing Personalization variation",
        },
      ],
    ]);
  });

  it("reports when nothing is copied because every order was skipped", async () => {
    const { context, warnings, clipboardWrites } = loadClipboardScript([
      {
        order_id: 9,
        fulfillment: { to_address: { name: "Casey" } },
        transactions: [
          {
            transaction_id: 99,
            listing_id: 999,
            quantity: 1,
            product: { title: "Acrylic Blank" },
            variations: [
              { property: "Size", value: "2.5 inches" },
            ],
          },
        ],
      },
    ]);

    await context.copyBadgeBatchPayload();

    expect(clipboardWrites).toHaveLength(0);
    expect(warnings).toContainEqual([
      "No personalized Etsy line items found on this page.",
      [
        {
          orderNumber: "9",
          buyerName: "Casey",
          transactionId: "99",
          listingId: "999",
          listingTitle: "Acrylic Blank",
          reason: "Missing Personalization variation",
        },
      ],
    ]);
  });
});
