import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAmazonNoteBlocks,
  normalizeShipStationItem,
} from "../../api/_lib/amazon-customization-normalizer.js";
import {
  AmazonImportError,
  createAmazonImportService,
} from "../../api/_lib/amazon-import-service.js";

const PROCESSED_TAG = "Amazon Customization Imported";
const STARTED_AT = new Date("2026-07-25T15:00:00.000Z");

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
    appendNoteBlocks: appendAmazonNoteBlocks,
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
  vi.unstubAllEnvs();
});

describe("Amazon import service", () => {
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
