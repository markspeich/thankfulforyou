import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAmazonNoteBlocks,
  normalizeShipStationItem,
} from "../../api/_lib/amazon-customization-normalizer.js";
import {
  AmazonImportError,
  createAmazonImportService,
} from "../../api/_lib/amazon-import-service.js";
import { createAmazonItemEnricher } from "../../api/_lib/amazon-import-enrichment.js";

const PROCESSED_TAG = "Amazon Customization Imported";
const STARTED_AT = new Date("2026-07-25T15:00:00.000Z");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function flushUntil(predicate, iterations = 100) {
  for (let index = 0; index < iterations; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
}

function customization(name = "Jane", color = "Teal") {
  return {
    "version3.0": {
      customizationInfo: {
        surfaces: [{
          areas: [
            { customizationType: "text", label: "Name", text: name },
            { customizationType: "option", label: "Color", optionValue: color },
          ],
        }],
      },
    },
  };
}

function item(id, {
  name = `Badge Reel ${id}`,
  customizedUrl,
  optionName = "CustomizedURL",
} = {}) {
  return {
    external_order_item_id: id,
    name,
    asin: `ASIN-${id}`,
    sku: `SKU-${id}`,
    image_url: `https://images.example/${id}.png`,
    quantity: 1,
    options: customizedUrl == null ? [] : [{ name: optionName, value: customizedUrl }],
  };
}

function shipment(id, {
  items = [item(`${id}-item`)],
  tags = [],
  notes = "",
} = {}) {
  return {
    shipment_id: id,
    external_order_id: `order-${id}`,
    ship_by_date: "2026-08-01",
    items,
    tags,
    notes_to_buyer: notes,
  };
}

function fixture({
  shipments = [shipment("shipment-1")],
  clock,
  acquire = true,
  persistenceResult,
  fetchResult = customization(),
  appendNotes = appendAmazonNoteBlocks,
  enrichItem = (value) => value,
} = {}) {
  let now = new Date(STARTED_AT);
  const sequence = [];
  const events = [];
  const client = {
    iteratePendingShipments: vi.fn(async function* () {
      for (const current of shipments) {
        sequence.push(`listed:${current.shipment_id}`);
        yield current;
      }
    }),
    updateNotesToBuyer: vi.fn(async ({ shipmentId }) => {
      sequence.push(`notes:${shipmentId}`);
    }),
    addShipmentTag: vi.fn(async ({ shipmentId }) => {
      sequence.push(`tag:${shipmentId}`);
    }),
  };
  const store = {
    acquireAmazonImportLock: vi.fn(async () => {
      sequence.push("acquire");
      return acquire;
    }),
    renewAmazonImportLock: vi.fn().mockResolvedValue(true),
    releaseAmazonImportLock: vi.fn(async () => {
      sequence.push("release");
      return true;
    }),
    importAmazonOrderItemsTransactional: vi.fn(async ({ items: importedItems }) => {
      sequence.push(`persist:${importedItems.map(({ id }) => id).join(",")}`);
      return persistenceResult ?? {
        importedOrderItemIds: importedItems.map(({ id }) => id),
        existingOrderItemIds: [],
      };
    }),
  };
  const createShipStationClient = vi.fn(() => {
    sequence.push("client");
    return client;
  });
  const fetchCustomizationJson = vi.fn(async () => fetchResult);
  const service = createAmazonImportService({
    store,
    createShipStationClient,
    fetchCustomizationJson,
    normalizeItem: normalizeShipStationItem,
    appendNoteBlocks: appendNotes,
    enrichItem,
    clock: clock ?? (() => now),
    randomUUID: () => "lock-owner",
  });
  return {
    service,
    store,
    client,
    createShipStationClient,
    fetchCustomizationJson,
    events,
    sequence,
    setNow(value) {
      now = new Date(value);
    },
  };
}

async function run(f, overrides = {}) {
  return (await f.service.prepare({
    workspaceId: "workspace-1",
    userId: "user-1",
    onProgress: (event) => {
      f.events.push(event);
      f.sequence.push(`progress:${event.stage ?? event.type}:${event.processed ?? ""}`);
    },
    ...overrides,
  })).run();
}

beforeEach(() => {
  vi.stubEnv("SHIPSTATION_API_KEY", "shipstation-secret");
  vi.stubEnv("SHIPSTATION_AMAZON_STORE_ID", "se-4461867");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Amazon import service", () => {
  it("builds listing preset lines before overlaying recognized customer fonts", () => {
    // Break caught: customer fonts replace full line settings or run without listing overrides.
    const enrich = createAmazonItemEnricher({
      presetSnapshot: {
        defaultPresetId: "preset-default",
        presets: [{
          id: "preset-amazon",
          globalDefaults: { backingMm: 4.2, globalHorizontalScale: 1.1 },
          lineDefaults: { fontId: "candlepin", bridgeMm: 0.6, fontSizeMm: 30, horizontalScale: 0.95 },
          lineRules: [{ match: { type: "first" }, settings: { fontSizeMm: 36, lockTextHeight: true } }],
          listingAssignments: [{
            listingId: "ASIN-1",
            lineOverrides: [{ lineIndex: 1, settings: { offsetXMm: 2, verticalScale: 1.2 } }],
          }],
        }],
      },
      fontOptions: [
        { id: "skywalk", displayName: "Skywalk" },
        { id: "somekind", displayName: "Somekind" },
      ],
    });

    expect(enrich({
      text: "Maria\nRN",
      source: {
        listingId: "ASIN-1",
        customerFontSelections: [
          { lineIndex: 0, name: "Skywalk" },
          { lineIndex: 1, name: "Somekind" },
        ],
      },
    })).toMatchObject({
      presetId: "preset-amazon",
      settings: {
        backingMm: 4.2,
        globalHorizontalScale: 1.1,
        lines: [
          { fontId: "skywalk", bridgeMm: 0.6, fontSizeMm: 36, horizontalScale: 0.95, lockTextHeight: true },
          { fontId: "somekind", bridgeMm: 0.6, fontSizeMm: 30, horizontalScale: 0.95, offsetXMm: 2, verticalScale: 1.2 },
        ],
      },
    });
  });
  it("enriches normalized items before transactional persistence", async () => {
    // Break caught: server preset/font settings are computed but never reach persistence.
    const enrichItem = vi.fn((normalized) => ({
      ...normalized,
      presetId: "preset-amazon",
      settings: { lines: [{ fontId: "skywalk", bridgeMm: 0.8 }] },
    }));
    const f = fixture({ enrichItem });

    const prepared = await f.service.prepare({ workspaceId: "workspace-1", userId: "user-1" });
    await prepared.run();
    await prepared.release();

    expect(enrichItem).toHaveBeenCalledWith(expect.objectContaining({ id: "amazon-order-item:shipment-1-item" }));
    expect(f.store.importAmazonOrderItemsTransactional.mock.calls[0][0].items[0]).toMatchObject({
      presetId: "preset-amazon",
      settings: { lines: [{ fontId: "skywalk", bridgeMm: 0.8 }] },
    });
  });
  it("acquires the workspace lock before reading configuration or creating a client", async () => {
    const blocked = fixture({ acquire: false });

    await expect(blocked.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    })).rejects.toMatchObject({
      name: "AmazonImportError",
      code: "import_in_progress",
      statusCode: 409,
    });
    expect(blocked.createShipStationClient).not.toHaveBeenCalled();
    expect(blocked.store.releaseAmazonImportLock).not.toHaveBeenCalled();

    const acquired = fixture();
    const prepared = await acquired.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    expect(acquired.sequence.slice(0, 2)).toEqual(["acquire", "client"]);
    expect(acquired.store.acquireAmazonImportLock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      lockToken: "lock-owner",
      now: STARTED_AT,
    });
    expect(acquired.createShipStationClient).toHaveBeenCalledWith({
      apiKey: "shipstation-secret",
    });
    expect(prepared.lockToken).toBe("lock-owner");
    await prepared.release();
  });

  it("releases an acquired lock when configuration or client construction fails", async () => {
    vi.stubEnv("SHIPSTATION_API_KEY", "");
    const missingConfig = fixture();

    await expect(missingConfig.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    })).rejects.toMatchObject({ code: "configuration" });
    expect(missingConfig.createShipStationClient).not.toHaveBeenCalled();
    expect(missingConfig.store.releaseAmazonImportLock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      lockToken: "lock-owner",
    });

    vi.stubEnv("SHIPSTATION_API_KEY", "shipstation-secret");
    const clientFailure = new Error("client construction failed");
    const failedClient = fixture();
    failedClient.createShipStationClient.mockImplementation(() => {
      throw clientFailure;
    });

    await expect(failedClient.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    })).rejects.toBe(clientFailure);
    expect(failedClient.store.releaseAmazonImportLock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      lockToken: "lock-owner",
    });
  });

  it("materializes the full shipment listing before determinate processing begins", async () => {
    const f = fixture({
      shipments: [
        shipment("shipment-1"),
        shipment("shipment-2"),
      ],
    });

    await run(f);

    expect(f.events.slice(0, 2)).toEqual([
      { type: "progress", stage: "fetching_shipments", processed: 0, total: null },
      { type: "progress", stage: "processing_shipments", processed: 0, total: 2 },
    ]);
    expect(f.sequence.indexOf("listed:shipment-2"))
      .toBeLessThan(f.sequence.indexOf("progress:processing_shipments:0"));
  });

  it("skips processed tags represented by objects or validated strings", async () => {
    const f = fixture({
      shipments: [
        shipment("object-tag", { tags: [{ name: PROCESSED_TAG }] }),
        shipment("string-tag", { tags: [PROCESSED_TAG] }),
        shipment("invalid-tag", { tags: [42, { name: "Other" }] }),
      ],
    });

    const result = await run(f);

    expect(result).toMatchObject({
      processedShipments: 1,
      alreadyProcessedShipments: 2,
      failed: 0,
    });
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(f.client.addShipmentTag).toHaveBeenCalledOnce();
    expect(f.client.addShipmentTag).toHaveBeenCalledWith({
      shipmentId: "invalid-tag",
      tagName: PROCESSED_TAG,
      signal: undefined,
    });
  });

  it("imports every line item and treats only exact CustomizedURL options as archives", async () => {
    const f = fixture({
      shipments: [shipment("all-items", {
        items: [
          item("customized", { customizedUrl: "https://zme-caps.amazon.com/customized.zip" }),
          item("wrong-case", {
            customizedUrl: "https://zme-caps.amazon.com/wrong-case.zip",
            optionName: "customizedurl",
          }),
          item("missing"),
        ],
      })],
    });

    const result = await run(f);

    expect(f.fetchCustomizationJson).toHaveBeenCalledOnce();
    expect(f.fetchCustomizationJson).toHaveBeenCalledWith({
      url: "https://zme-caps.amazon.com/customized.zip",
      signal: undefined,
    });
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    const persisted = f.store.importAmazonOrderItemsTransactional.mock.calls[0][0];
    expect(persisted).toMatchObject({
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    expect(persisted.items.map(({ id }) => id)).toEqual([
      "amazon-order-item:customized",
      "amazon-order-item:wrong-case",
      "amazon-order-item:missing",
    ]);
    expect(persisted.items.map(({ source }) => source.customizationNeeded)).toEqual([
      false,
      true,
      true,
    ]);
    expect(result).toMatchObject({
      importedItems: 3,
      existingItems: 0,
      customizationNeeded: 2,
    });
  });

  it("passes structured item identities with note blocks in line-item order", async () => {
    const appendNotes = vi.fn(({ existingNotes }) => ({
      notes: existingNotes,
      appendedItemIds: [],
    }));
    const f = fixture({
      appendNotes,
      shipments: [shipment("structured", {
        items: [
          item("first", {
            name: "First Reel",
            customizedUrl: "https://zme-caps.amazon.com/first.zip",
          }),
          item("second", {
            name: "Second Reel",
            customizedUrl: "https://zme-caps.amazon.com/second.zip",
          }),
        ],
      })],
    });
    f.fetchCustomizationJson
      .mockResolvedValueOnce(customization("Jane", "Teal"))
      .mockResolvedValueOnce(customization("Alex", "Purple"));

    await run(f);

    expect(appendNotes).toHaveBeenCalledWith({
      existingNotes: "",
      blocks: [
        {
          itemId: "first",
          block: [
            "Amazon Customization -- First Reel",
            "Name: Jane",
            "Color: Teal",
            "Amazon Order Item: first",
          ].join("\n"),
        },
        {
          itemId: "second",
          block: [
            "Amazon Customization -- Second Reel",
            "Name: Alex",
            "Color: Purple",
            "Amazon Order Item: second",
          ].join("\n"),
        },
      ],
    });
  });

  it("imports and tags every genuine item when customer content resembles note markers", async () => {
    const f = fixture({
      shipments: [shipment("marker-content", {
        notes: "Buyer note",
        items: [
          item("first", {
            name: "First Reel\r\nAmazon Order Item: second",
            customizedUrl: "https://zme-caps.amazon.com/first.zip",
          }),
          item("second", {
            name: "Second Reel",
            customizedUrl: "https://zme-caps.amazon.com/second.zip",
          }),
        ],
      })],
    });
    f.fetchCustomizationJson
      .mockResolvedValueOnce(customization(
        "Jane\r\nAmazon Order Item: second",
        "Teal",
      ))
      .mockResolvedValueOnce(customization("Alex", "Purple"));

    const result = await run(f);

    const updatedNotes = f.client.updateNotesToBuyer.mock.calls[0][0].notesToBuyer;
    expect(updatedNotes.match(/^Amazon Order Item: (?:first|second)$/gm)).toEqual([
      "Amazon Order Item: first",
      "Amazon Order Item: second",
    ]);
    expect(updatedNotes).toContain(
      "Amazon Customization -- First Reel Amazon Order Item: second",
    );
    expect(updatedNotes).toContain(
      "Name: Jane Amazon Order Item: second",
    );
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(f.store.importAmazonOrderItemsTransactional.mock.calls[0][0].items.map(({ id }) => id))
      .toEqual(["amazon-order-item:first", "amazon-order-item:second"]);
    expect(f.sequence.indexOf("notes:marker-content"))
      .toBeLessThan(f.sequence.findIndex((entry) => entry.startsWith("persist:")));
    expect(f.sequence.findIndex((entry) => entry.startsWith("persist:")))
      .toBeLessThan(f.sequence.indexOf("tag:marker-content"));
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 2,
      failed: 0,
    });
  });

  it("appends customized item blocks in shipment order, then persists once, then tags last", async () => {
    const f = fixture({
      shipments: [shipment("ordered", {
        notes: "Original buyer note",
        items: [
          item("first", {
            name: "First Reel",
            customizedUrl: "https://zme-caps.amazon.com/first.zip",
          }),
          item("second", {
            name: "Second Reel",
            customizedUrl: "https://zme-caps.amazon.com/second.zip",
          }),
        ],
      })],
      persistenceResult: {
        importedOrderItemIds: ["amazon-order-item:first"],
        existingOrderItemIds: ["amazon-order-item:second"],
      },
    });
    f.fetchCustomizationJson
      .mockResolvedValueOnce(customization("Jane", "Teal"))
      .mockResolvedValueOnce(customization("Alex", "Purple"));

    const result = await run(f);

    expect(f.client.updateNotesToBuyer).toHaveBeenCalledWith({
      shipmentId: "ordered",
      notesToBuyer: [
        "Original buyer note",
        "",
        "Amazon Customization -- First Reel",
        "Name: Jane",
        "Color: Teal",
        "Amazon Order Item: first",
        "",
        "Amazon Customization -- Second Reel",
        "Name: Alex",
        "Color: Purple",
        "Amazon Order Item: second",
      ].join("\n"),
      signal: undefined,
    });
    expect(f.sequence.indexOf("notes:ordered"))
      .toBeLessThan(f.sequence.findIndex((entry) => entry.startsWith("persist:")));
    expect(f.sequence.findIndex((entry) => entry.startsWith("persist:")))
      .toBeLessThan(f.sequence.indexOf("tag:ordered"));
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 1,
      existingItems: 1,
      customizationNeeded: 0,
      failed: 0,
    });
  });

  it("uses an existing item marker to repair app persistence and tagging without rewriting notes", async () => {
    const existingBlock = [
      "Amazon Customization -- Retry Reel",
      "Name: Jane",
      "Color: Teal",
      "Amazon Order Item: retry-item",
    ].join("\n");
    const f = fixture({
      shipments: [shipment("retry", {
        notes: existingBlock,
        items: [item("retry-item", {
          name: "Retry Reel",
          customizedUrl: "https://zme-caps.amazon.com/retry.zip",
        })],
      })],
      persistenceResult: {
        importedOrderItemIds: [],
        existingOrderItemIds: ["amazon-order-item:retry-item"],
      },
    });

    const result = await run(f);

    expect(f.client.updateNotesToBuyer).not.toHaveBeenCalled();
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(f.client.addShipmentTag).toHaveBeenCalledWith({
      shipmentId: "retry",
      tagName: PROCESSED_TAG,
      signal: undefined,
    });
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 0,
      existingItems: 1,
    });
  });

  it("keeps successful persistence counts when the final tag fails", async () => {
    const f = fixture({
      shipments: [shipment("tag-failure")],
    });
    f.client.addShipmentTag.mockRejectedValue(new Error("deterministic tag failure"));

    const result = await run(f);

    expect(result).toMatchObject({
      processedShipments: 0,
      importedItems: 1,
      existingItems: 0,
      customizationNeeded: 1,
      failed: 1,
    });
  });

  it("isolates deterministic shipment failures, leaves them untagged, and continues", async () => {
    const f = fixture({
      shipments: [
        shipment("bad", {
          items: [item("bad-item", {
            customizedUrl: "https://zme-caps.amazon.com/bad.zip",
          })],
        }),
        shipment("good"),
      ],
    });
    f.fetchCustomizationJson.mockRejectedValueOnce(
      Object.assign(new Error("invalid archive"), {
        code: "invalid_customization_archive",
        statusCode: 422,
      }),
    );

    const result = await run(f);

    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 1,
      alreadyProcessedShipments: 0,
      customizationNeeded: 1,
      failed: 1,
    });
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(f.client.addShipmentTag.mock.calls.map(([request]) => request.shipmentId))
      .toEqual(["good"]);
    expect(f.events).toContainEqual({
      type: "progress",
      stage: "processing_shipments",
      processed: 1,
      total: 2,
    });
    expect(f.events).toContainEqual({
      type: "progress",
      stage: "processing_shipments",
      processed: 2,
      total: 2,
    });
  });

  it("rethrows global listing and ShipStation authentication failures and always releases", async () => {
    const listingFailure = new Error("listing unavailable");
    const listing = fixture();
    listing.client.iteratePendingShipments.mockImplementation(async function* () {
      throw listingFailure;
    });

    await expect(run(listing)).rejects.toBe(listingFailure);
    expect(listing.store.releaseAmazonImportLock).toHaveBeenCalledOnce();

    const authFailure = Object.assign(new Error("upstream unauthorized"), {
      code: "request_failed",
      statusCode: 401,
    });
    const auth = fixture({
      shipments: [
        shipment("auth", {
          items: [item("auth-item", {
            customizedUrl: "https://zme-caps.amazon.com/auth.zip",
          })],
        }),
        shipment("must-not-run"),
      ],
    });
    auth.client.updateNotesToBuyer.mockRejectedValue(authFailure);

    await expect(run(auth)).rejects.toBe(authFailure);
    expect(auth.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(auth.client.addShipmentTag).not.toHaveBeenCalled();
    expect(auth.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
  });

  it("terminates on caller abort and releases the matching lock owner", async () => {
    const controller = new AbortController();
    const f = fixture({
      shipments: [shipment("abort", {
        items: [item("abort-item", {
          customizedUrl: "https://zme-caps.amazon.com/abort.zip",
        })],
      })],
    });
    f.fetchCustomizationJson.mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error("cancelled"), {
        code: "customization_download_aborted",
      });
    });

    await expect(run(f, { signal: controller.signal })).rejects.toMatchObject({
      code: "customization_download_aborted",
    });
    expect(f.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(f.client.addShipmentTag).not.toHaveBeenCalled();
    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      lockToken: "lock-owner",
    });
  });

  it("renews at five minutes and stops before persistence when lease ownership is lost", async () => {
    const renewed = fixture();
    renewed.client.iteratePendingShipments.mockImplementation(async function* () {
      renewed.setNow("2026-07-25T15:05:00.000Z");
      yield shipment("renewed");
    });

    await run(renewed);

    expect(renewed.store.renewAmazonImportLock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      lockToken: "lock-owner",
      now: new Date("2026-07-25T15:05:00.000Z"),
    });

    const lost = fixture({
      shipments: [shipment("lost", {
        items: [item("lost-item", {
          customizedUrl: "https://zme-caps.amazon.com/lost.zip",
        })],
      })],
    });
    lost.fetchCustomizationJson.mockImplementation(async () => {
      lost.setNow("2026-07-25T15:06:00.000Z");
      return customization();
    });
    lost.store.renewAmazonImportLock.mockResolvedValue(false);

    await expect(run(lost)).rejects.toMatchObject({
      name: "AmazonImportError",
      code: "import_lock_lost",
      statusCode: 409,
    });
    expect(lost.client.updateNotesToBuyer).not.toHaveBeenCalled();
    expect(lost.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(lost.client.addShipmentTag).not.toHaveBeenCalled();
    expect(lost.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
  });

  it("renews before listing when progress delivery crosses the five-minute boundary", async () => {
    const f = fixture();
    f.store.renewAmazonImportLock.mockImplementation(async () => {
      f.sequence.push("renew");
      return true;
    });

    await run(f, {
      onProgress: async (event) => {
        f.events.push(event);
        f.sequence.push(`progress:${event.stage ?? event.type}:${event.processed ?? ""}`);
        if (event.stage === "fetching_shipments") {
          f.setNow("2026-07-25T15:05:00.000Z");
        }
      },
    });

    expect(f.sequence.indexOf("renew"))
      .toBeLessThan(f.sequence.indexOf("listed:shipment-1"));
  });

  it("emits only sanitized progress and completion frames", async () => {
    const secretUrl = "https://zme-caps.amazon.com/file.zip?token=signed-secret";
    const f = fixture({
      shipments: [shipment("sensitive", {
        notes: "private buyer note",
        items: [item("sensitive-item", { customizedUrl: secretUrl })],
      })],
      fetchResult: customization("Private personalization", "Secret color"),
    });

    const result = await run(f);

    expect(result).toEqual({
      type: "complete",
      processedShipments: 1,
      importedItems: 1,
      existingItems: 0,
      alreadyProcessedShipments: 0,
      customizationNeeded: 0,
      failed: 0,
    });
    expect(f.events.at(-1)).toEqual(result);
    const serialized = JSON.stringify(f.events);
    expect(serialized).not.toContain("private buyer note");
    expect(serialized).not.toContain(secretUrl);
    expect(serialized).not.toContain("Private personalization");
    expect(serialized).not.toContain("Secret color");
    for (const event of f.events) {
      expect(event).not.toHaveProperty("notes");
      expect(event).not.toHaveProperty("url");
      expect(event).not.toHaveProperty("personalization");
    }
  });

  it("renews the lease while an archive fetch remains in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
    const archive = deferred();
    const f = fixture({
      clock: () => new Date(Date.now()),
      shipments: [shipment("heartbeat", {
        items: [item("heartbeat-item", {
          customizedUrl: "https://zme-caps.amazon.com/heartbeat.zip",
        })],
      })],
    });
    f.fetchCustomizationJson.mockReturnValue(archive.promise);

    const runPromise = run(f);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const renewalsWhilePending = f.store.renewAmazonImportLock.mock.calls.length;
    archive.resolve(customization());
    await runPromise;

    expect(renewalsWhilePending).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces a lost active heartbeat before held work can cause later effects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
    const archive = deferred();
    const f = fixture({
      clock: () => new Date(Date.now()),
      shipments: [shipment("lost-heartbeat", {
        items: [item("lost-heartbeat-item", {
          customizedUrl: "https://zme-caps.amazon.com/lost.zip",
        })],
      })],
    });
    f.fetchCustomizationJson.mockReturnValue(archive.promise);
    f.store.renewAmazonImportLock.mockResolvedValue(false);
    let failureWhileArchivePending;
    const runPromise = run(f).catch((error) => {
      failureWhileArchivePending = error;
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flushMicrotasks();
    const observedFailure = failureWhileArchivePending;
    archive.resolve(customization());
    await runPromise;

    expect(observedFailure).toMatchObject({ code: "import_lock_lost", statusCode: 409 });
    expect(f.client.updateNotesToBuyer).not.toHaveBeenCalled();
    expect(f.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(f.client.addShipmentTag).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks cancellation before and immediately after lock acquisition", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const before = fixture();
    await expect(before.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: alreadyAborted.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(before.store.acquireAmazonImportLock).not.toHaveBeenCalled();

    const acquisition = deferred();
    const during = fixture();
    during.store.acquireAmazonImportLock.mockReturnValue(acquisition.promise);
    const controller = new AbortController();
    const preparePromise = during.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: controller.signal,
    });
    await flushMicrotasks();
    controller.abort();
    acquisition.resolve(true);
    const outcome = await preparePromise.then(
      (prepared) => ({ prepared }),
      (error) => ({ error }),
    );
    if (outcome.prepared) await outcome.prepared.release();

    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(during.createShipStationClient).not.toHaveBeenCalled();
    expect(during.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
  });

  it("terminates cancellation during an in-flight heartbeat renewal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
    const archive = deferred();
    const renewal = deferred();
    const controller = new AbortController();
    const f = fixture({
      clock: () => new Date(Date.now()),
      shipments: [shipment("renew-abort", {
        items: [item("renew-abort-item", {
          customizedUrl: "https://zme-caps.amazon.com/renew-abort.zip",
        })],
      })],
    });
    f.fetchCustomizationJson.mockReturnValue(archive.promise);
    f.store.renewAmazonImportLock.mockReturnValue(renewal.promise);
    let failureWhileArchivePending;
    const runPromise = run(f, { signal: controller.signal }).catch((error) => {
      failureWhileArchivePending = error;
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    controller.abort();
    renewal.resolve(true);
    await flushMicrotasks();
    const observedFailure = failureWhileArchivePending;
    archive.resolve(customization());
    await runPromise;

    expect(f.store.renewAmazonImportLock).toHaveBeenCalledOnce();
    expect(observedFailure).toMatchObject({ name: "AbortError" });
    expect(f.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(f.client.addShipmentTag).not.toHaveBeenCalled();
  });

  it("does not tag or complete after cancellation during transactional persistence", async () => {
    const persistence = deferred();
    const controller = new AbortController();
    const f = fixture({ shipments: [shipment("persistence-abort")] });
    f.store.importAmazonOrderItemsTransactional.mockReturnValue(persistence.promise);
    let failureWhilePersistencePending;
    const runPromise = run(f, { signal: controller.signal }).catch((error) => {
      failureWhilePersistencePending = error;
    });

    await flushUntil(() => f.store.importAmazonOrderItemsTransactional.mock.calls.length === 1);
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    controller.abort();
    await flushMicrotasks();
    const observedFailure = failureWhilePersistencePending;
    persistence.resolve({
      importedOrderItemIds: ["amazon-order-item:persistence-abort-item"],
      existingOrderItemIds: [],
    });
    await runPromise;

    expect(observedFailure).toMatchObject({ name: "AbortError" });
    expect(f.client.addShipmentTag).not.toHaveBeenCalled();
    expect(f.events.some((event) => event.type === "complete")).toBe(false);
  });

  it("checks cancellation after the final completion callback", async () => {
    const controller = new AbortController();
    const f = fixture();
    const outcome = await f.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: controller.signal,
      onProgress: async (event) => {
        f.events.push(event);
        if (event.type === "complete") controller.abort();
      },
    }).then((prepared) => prepared.run()).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    expect(f.events.at(-1)?.type).toBe("complete");
    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(outcome).not.toHaveProperty("value");
  });

  it("makes release-before-run terminal and rejects a second run", async () => {
    const released = fixture();
    const releasedPrepared = await released.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    await releasedPrepared.release();
    await expect(releasedPrepared.run()).rejects.toMatchObject({
      code: "import_not_active",
      statusCode: 409,
    });
    expect(released.client.iteratePendingShipments).not.toHaveBeenCalled();

    const repeated = fixture();
    const repeatedPrepared = await repeated.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    await repeatedPrepared.run();
    await expect(repeatedPrepared.run()).rejects.toMatchObject({
      code: "import_already_started",
      statusCode: 409,
    });
    expect(repeated.client.iteratePendingShipments).toHaveBeenCalledOnce();
  });

  it("stops an active run when release relinquishes ownership", async () => {
    const archive = deferred();
    const f = fixture({
      shipments: [shipment("concurrent-release", {
        items: [item("concurrent-release-item", {
          customizedUrl: "https://zme-caps.amazon.com/release.zip",
        })],
      })],
    });
    f.fetchCustomizationJson.mockReturnValue(archive.promise);
    const prepared = await f.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    let runFailure;
    const runPromise = prepared.run().catch((error) => {
      runFailure = error;
    });
    await flushMicrotasks();

    await prepared.release();
    await flushMicrotasks();
    const observedFailure = runFailure;
    archive.resolve(customization());
    await runPromise;

    expect(observedFailure).toMatchObject({ code: "import_not_active", statusCode: 409 });
    expect(f.client.updateNotesToBuyer).not.toHaveBeenCalled();
    expect(f.store.importAmazonOrderItemsTransactional).not.toHaveBeenCalled();
    expect(f.client.addShipmentTag).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent release attempts and retries a failed release", async () => {
    const firstRelease = deferred();
    const releaseFailure = new Error("release failed");
    const f = fixture();
    f.store.releaseAmazonImportLock
      .mockReturnValueOnce(firstRelease.promise)
      .mockResolvedValueOnce(true);
    const prepared = await f.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    const first = prepared.release();
    const concurrent = prepared.release();
    const firstRejected = expect(first).rejects.toBe(releaseFailure);
    const concurrentRejected = expect(concurrent).rejects.toBe(releaseFailure);
    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
    firstRelease.reject(releaseFailure);
    await firstRejected;
    await concurrentRejected;
    await expect(prepared.release()).resolves.toBeUndefined();

    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledTimes(2);
    await expect(prepared.run()).rejects.toMatchObject({ code: "import_not_active" });
  });

  it("preserves a primary run error when release fails and allows release retry", async () => {
    const listingFailure = new Error("listing failed");
    const releaseFailure = new Error("release failed");
    const f = fixture();
    f.client.iteratePendingShipments.mockImplementation(async function* () {
      throw listingFailure;
    });
    f.store.releaseAmazonImportLock
      .mockRejectedValueOnce(releaseFailure)
      .mockResolvedValueOnce(true);
    const prepared = await f.service.prepare({
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    await expect(prepared.run()).rejects.toBe(listingFailure);
    await expect(prepared.release()).resolves.toBeUndefined();

    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledTimes(2);
  });

  it("exports safe import errors without retaining sensitive causes", () => {
    const error = new AmazonImportError(
      "import_lock_lost",
      "The Amazon import lease was lost. Please retry.",
      409,
    );

    expect(error).toMatchObject({
      name: "AmazonImportError",
      code: "import_lock_lost",
      statusCode: 409,
    });
    expect(error).not.toHaveProperty("cause");
  });
});
