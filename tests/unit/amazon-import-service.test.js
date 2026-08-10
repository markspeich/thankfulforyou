import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAmazonNoteBlocks,
  normalizeShipStationItem,
} from "../../api/_lib/amazon-customization-normalizer.js";
import {
  AmazonImportError,
  createAmazonImportService,
} from "../../api/_lib/amazon-import-service.js";
import { createAmazonImportDiagnostics } from "../../api/_lib/amazon-import-diagnostics.js";
import { createAmazonItemEnricher } from "../../api/_lib/amazon-import-enrichment.js";
import { ShipStationError } from "../../api/_lib/shipstation-client.js";

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

function flattenDiagnosticLogger(logger) {
  const adapt = (level) => (_message, envelope = {}) => {
    const { event, details, ...context } = envelope;
    return logger?.[level]?.(event, { ...context, ...(details || {}) });
  };
  return { info: adapt("info"), error: adapt("error") };
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
  ...overrides
} = {}) {
  return {
    shipment_id: id,
    external_order_id: `order-${id}`,
    ship_by_date: "2026-08-01",
    items,
    tags,
    notes_to_buyer: notes,
    ...overrides,
  };
}

function fixture({
  shipments = [shipment("shipment-1")],
  clock,
  acquire = true,
  persistenceResult,
  fetchResult = customization(),
  appendNotes = appendAmazonNoteBlocks,
  normalizeItem = normalizeShipStationItem,
  enrichItem = (value) => value,
  diagnostics,
} = {}) {
  let now = new Date(STARTED_AT);
  let activeNormalizeItem = normalizeItem;
  let activeEnrichItem = enrichItem;
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
  const serviceEnrichItem = (value, context) => (
    activeEnrichItem.supportsPerCallEnrichmentSummary
      ? activeEnrichItem(value, context)
      : activeEnrichItem(value)
  );
  serviceEnrichItem.supportsPerCallEnrichmentSummary = true;
  const service = createAmazonImportService({
    store,
    createShipStationClient,
    fetchCustomizationJson,
    normalizeItem: (input) => activeNormalizeItem(input),
    appendNoteBlocks: appendNotes,
    enrichItem: serviceEnrichItem,
    diagnostics,
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
    normalizeItem,
    setNormalizeItem(value) {
      activeNormalizeItem = value;
    },
    setEnrichItem(value) {
      activeEnrichItem = value;
    },
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
  it("emits ordered correlated safe events for a successful customized item", async () => {
    // Break caught: production imports complete without correlated boundary diagnostics or expose customer values.
    const diagnosticEvents = [];
    const logger = flattenDiagnosticLogger({
      info: (event, context) => diagnosticEvents.push({ level: "info", event, context }),
      error: (event, context) => diagnosticEvents.push({ level: "error", event, context }),
    });
    const diagnostics = createAmazonImportDiagnostics({
      logger,
      runId: "run-123",
      workspaceId: "workspace-1",
    });
    const enrichItem = createAmazonItemEnricher({
      presetSnapshot: {
        defaultPresetId: "preset-amazon",
        presets: [{
          id: "preset-amazon",
          globalDefaults: {},
          lineDefaults: { fontId: "candlepin" },
          lineRules: [],
          listingAssignments: [],
        }],
      },
      fontOptions: [{ id: "skywalk-internal", displayName: "CUSTOMER FONT SECRET" }],
    });
    const privateUrl = "https://zme-caps.amazon.com/private-archive?token=URL-SECRET";
    const f = fixture({
      diagnostics,
      enrichItem,
      shipments: [shipment("shipment-safe", {
        notes: "BUYER NOTE SECRET",
        items: [item("item-safe", {
          name: "PRODUCT TITLE SECRET",
          customizedUrl: privateUrl,
        })],
      })],
      fetchResult: {
        "version3.0": {
          customizationInfo: {
            surfaces: [{
              areas: [
                { customizationType: "text", label: "Name", text: "CUSTOMER TEXT SECRET" },
                { customizationType: "option", label: "Name Font", optionValue: "CUSTOMER FONT SECRET" },
                { customizationType: "option", label: "Color", optionValue: "CUSTOMER COLOR SECRET" },
              ],
            }],
          },
        },
      },
    });
    f.client.iteratePendingShipments.mockImplementation(async function* () {
      yield {
        ...shipment("shipment-safe", {
          notes: "BUYER NOTE SECRET",
          items: [item("item-safe", {
            name: "PRODUCT TITLE SECRET",
            customizedUrl: privateUrl,
          })],
        }),
        ship_to: { name: "BUYER NAME SECRET", address_line1: "ADDRESS SECRET" },
      };
    });

    const result = await run(f);

    expect(diagnosticEvents).toEqual([
      { level: "info", event: "amazon_import.run.started", context: { runId: "run-123", workspaceId: "workspace-1" } },
      { level: "info", event: "amazon_import.shipments.fetched", context: { runId: "run-123", workspaceId: "workspace-1", shipmentCount: 1 } },
      { level: "info", event: "amazon_import.shipment.started", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", itemCount: 1, processedTagPresent: false } },
      { level: "info", event: "amazon_import.item.started", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", orderItemId: "item-safe", customizationUrlPresent: true } },
      { level: "info", event: "amazon_import.item.customization_fetched", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", orderItemId: "item-safe", summary: { format: "v3", surfaceCount: 1, areaCount: 3, candidateNodeCount: 3, acceptedTextCount: 1, acceptedConfigurationCount: 2, acceptedLabels: ["Name", "Name Font", "Color"], rejectedCounts: {} } } },
      { level: "info", event: "amazon_import.item.normalized", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", orderItemId: "item-safe", textLineCount: 1, personalizationResponseCount: 3, fontSelectionCount: 1, customizationNeeded: false } },
      { level: "info", event: "amazon_import.item.enriched", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", orderItemId: "item-safe", presetId: "preset-amazon", designLineCount: 1, selectionCount: 1, recognizedCount: 1, unknownCount: 0, effectiveFontIds: ["skywalk-internal"] } },
      { level: "info", event: "amazon_import.item.persisted", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", orderItemId: "item-safe", persistenceOutcome: "imported" } },
      { level: "info", event: "amazon_import.shipment.completed", context: { runId: "run-123", workspaceId: "workspace-1", shipmentId: "shipment-safe", orderNumber: "order-shipment-safe", importedItems: 1, existingItems: 0, notesUpdated: true, processedTagUpdated: true } },
      { level: "info", event: "amazon_import.run.completed", context: { runId: "run-123", workspaceId: "workspace-1", processedShipments: 1, importedItems: 1, existingItems: 0, alreadyProcessedShipments: 0, customizationNeeded: 0, warnings: 0, failed: 0 } },
    ]);
    expect(result).toMatchObject({ processedShipments: 1, importedItems: 1, failed: 0 });
    const serialized = JSON.stringify(diagnosticEvents);
    for (const secret of [
      "CUSTOMER TEXT SECRET",
      "CUSTOMER FONT SECRET",
      "CUSTOMER COLOR SECRET",
      "BUYER NOTE SECRET",
      "BUYER NAME SECRET",
      "ADDRESS SECRET",
      "PRODUCT TITLE SECRET",
      privateUrl,
      "URL-SECRET",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ["customization_fetch", (f, failure) => f.fetchCustomizationJson.mockRejectedValueOnce(failure)],
    ["normalization", (f, failure) => {
      const normalize = f.normalizeItem;
      f.setNormalizeItem(({ item: currentItem, ...input }) => {
        if (currentItem.external_order_item_id === "bad-item") throw failure;
        return normalize({ item: currentItem, ...input });
      });
    }],
    ["enrichment", (f, failure) => f.setEnrichItem((normalized) => {
      if (normalized.source.amazonOrderItemId === "bad-item") throw failure;
      return normalized;
    })],
    ["persistence", (f, failure) => f.store.importAmazonOrderItemsTransactional.mockRejectedValueOnce(failure)],
  ])("reports a safe %s shipment failure once and continues", async (stage, injectFailure) => {
    // Break caught: a shipment boundary failure is unattributed, leaks an error, or stops later shipments.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: `run-${stage}`,
      workspaceId: "workspace-1",
    });
    const failure = Object.assign(new Error("CUSTOMER ERROR MESSAGE SECRET"), {
      name: "StageFailure",
      code: "stage_failure",
      statusCode: 422,
      retryable: false,
      requestId: "request-safe",
      stack: "CUSTOMER ERROR STACK SECRET",
    });
    const f = fixture({
      diagnostics,
      shipments: [
        shipment("bad", { items: [item("bad-item", { customizedUrl: "https://amazon.example/URL-SECRET" })] }),
        shipment("good"),
      ],
    });
    injectFailure(f, failure);

    const result = await run(f);

    const failedEvents = calls.filter(({ event }) => event === "amazon_import.shipment.failed");
    expect(failedEvents).toEqual([{
      level: "error",
      event: "amazon_import.shipment.failed",
      context: {
        runId: `run-${stage}`,
        workspaceId: "workspace-1",
        shipmentId: "bad",
        orderNumber: "order-bad",
        ...(["customization_fetch", "normalization", "enrichment"].includes(stage)
          ? { orderItemId: "bad-item" }
          : {}),
        stage,
        errorName: null,
        errorCode: null,
        statusCode: 422,
        retryable: false,
        requestId: null,
      },
    }]);
    expect(result).toMatchObject({ processedShipments: 1, failed: 1 });
    expect(calls.filter(({ event }) => event === "amazon_import.run.completed")[0].context.failed).toBe(1);
    expect(JSON.stringify(calls)).not.toContain("CUSTOMER ERROR MESSAGE SECRET");
    expect(JSON.stringify(calls)).not.toContain("CUSTOMER ERROR STACK SECRET");
    expect(JSON.stringify(calls)).not.toContain("URL-SECRET");
  });

  it("persists an oversized-note shipment, records a safe warning, and continues", async () => {
    // Break caught: a Notes to Buyer size limit prevents valid order items from importing or stops later shipments.
    const overflowItems = Array.from({ length: 6 }, (_, index) => item(`overflow-${index + 1}`, {
      customizedUrl: `https://zme-caps.amazon.com/overflow-${index + 1}.zip`,
    }));
    const appendNotes = vi.fn((input) => {
      if (input.blocks.length === 6) {
        throw new RangeError("ShipStation notes exceed 1000 characters");
      }
      return appendAmazonNoteBlocks(input);
    });
    const f = fixture({
      appendNotes,
      shipments: [
        shipment("overflow", {
          external_order_id: "114-7445306-8228220",
          items: overflowItems,
        }),
        shipment("good"),
      ],
    });

    const result = await run(f);

    expect(f.store.importAmazonOrderItemsTransactional.mock.calls[0][0].items.map(({ id }) => id)).toEqual([
      "amazon-order-item:overflow-1",
      "amazon-order-item:overflow-2",
      "amazon-order-item:overflow-3",
      "amazon-order-item:overflow-4",
      "amazon-order-item:overflow-5",
      "amazon-order-item:overflow-6",
    ]);
    expect(f.client.addShipmentTag.mock.calls.map(([request]) => request.shipmentId)).toEqual(["good"]);
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 7,
      existingItems: 0,
      warnings: 1,
      failed: 0,
      warningDetails: [{
        orderNumber: "114-7445306-8228220",
        stage: "notes_update",
        summary: "ShipStation Notes to Buyer is too long to update.",
      }],
    });
  });

  it("treats a tag failure after persistence as a safe synchronization warning", async () => {
    // Break caught: a tag synchronization error recategorizes persisted imports as failed or exposes provider data.
    const f = fixture({
      shipments: [shipment("tag-warning", {
        external_order_id: "114-7445306-8228220",
      })],
    });
    f.client.addShipmentTag.mockRejectedValueOnce(new Error("PRIVATE SHIPSTATION TAG ERROR"));

    const result = await run(f);

    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      processedShipments: 0,
      importedItems: 1,
      existingItems: 0,
      warnings: 1,
      failed: 0,
      warningDetails: [{
        orderNumber: "114-7445306-8228220",
        stage: "tag_update",
        summary: "ShipStation synchronization could not be completed.",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE SHIPSTATION TAG ERROR");
  });

  it("retries persisted items as existing when a prior notes update warned", async () => {
    // Break caught: retrying an untagged shipment creates duplicate order items instead of finishing its ShipStation synchronization.
    const retryShipment = shipment("retry-warning", {
      external_order_id: "114-7445306-8228220",
      items: [item("retry-warning-item", {
        customizedUrl: "https://zme-caps.amazon.com/retry-warning.zip",
      })],
    });
    const first = fixture({
      shipments: [retryShipment],
      appendNotes: () => {
        throw new RangeError("ShipStation notes exceed 1000 characters");
      },
    });

    const firstResult = await run(first);

    const second = fixture({
      shipments: [retryShipment],
      persistenceResult: {
        importedOrderItemIds: [],
        existingOrderItemIds: ["amazon-order-item:retry-warning-item"],
      },
    });
    const secondResult = await run(second);

    expect(firstResult).toMatchObject({
      importedItems: 1,
      existingItems: 0,
      warnings: 1,
      failed: 0,
    });
    expect(secondResult).toMatchObject({
      processedShipments: 1,
      importedItems: 0,
      existingItems: 1,
      warnings: 0,
      failed: 0,
    });
    expect(second.client.updateNotesToBuyer).toHaveBeenCalledOnce();
    expect(second.client.addShipmentTag).toHaveBeenCalledOnce();
  });

  it("reports a trusted notes update warning without exposing arbitrary error data", async () => {
    // Break caught: a ShipStation notes synchronization error discards persisted items or leaks upstream error content.
    const rawResponseBody = '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}';
    const diagnosticEvents = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        error: (event, context) => diagnosticEvents.push({ event, context }),
      }),
    });
    const failure = new ShipStationError("invalid_response", {
      rawResponseBody,
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    Object.assign(failure, {
      message: "PRIVATE CUSTOMER ERROR MESSAGE",
      response: { body: "PRIVATE UPSTREAM RESPONSE" },
      arbitraryProperty: "PRIVATE ARBITRARY PROPERTY",
    });
    const f = fixture({
      diagnostics,
      shipments: [shipment("invalid-notes", {
        external_order_id: "111-0318024-9415409",
        items: [item("invalid-notes-item", { customizedUrl: "https://amazon.example/customization" })],
      })],
    });
    f.client.updateNotesToBuyer.mockRejectedValueOnce(failure);

    const result = await run(f);

    expect(result).toMatchObject({
      processedShipments: 0,
      importedItems: 1,
      existingItems: 0,
      alreadyProcessedShipments: 0,
      customizationNeeded: 0,
      warnings: 1,
      failed: 0,
      warningDetails: [{
        orderNumber: "111-0318024-9415409",
        stage: "notes_update",
        summary: "ShipStation synchronization could not be completed.",
      }],
    });
    const serialized = JSON.stringify(result);
    expect(diagnosticEvents.find(({ event }) => event === "amazon_import.shipment.warning")?.context)
      .toMatchObject({ rawShipStationResponse: rawResponseBody });
    expect(Object.keys(result.warningDetails[0]).sort()).toEqual(["orderNumber", "stage", "summary"]);
    for (const secret of [
      "PRIVATE CUSTOMER ERROR MESSAGE",
      "PRIVATE UPSTREAM RESPONSE",
      "PRIVATE ARBITRARY PROPERTY",
      "PRIVATE SHIPSTATION ERROR",
      "PRIVATE VALUE",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps a raw-response shipment warning unchanged when the server logger throws", async () => {
    // Break caught: emitting the trusted raw response changes a shipment-level warning into a run-level failure.
    const rawResponseBody = '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}';
    const diagnostics = createAmazonImportDiagnostics({
      logger: {
        info() {},
        error(_message, envelope) {
          if (envelope?.details?.rawShipStationResponse === rawResponseBody) {
            throw new Error("logger unavailable");
          }
        },
      },
    });
    const failure = new ShipStationError("invalid_response", {
      rawResponseBody,
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    const f = fixture({
      diagnostics,
      shipments: [shipment("logger-failure", {
        external_order_id: "111-0318024-9415409",
        items: [item("logger-failure-item", { customizedUrl: "https://amazon.example/customization" })],
      })],
    });
    f.client.updateNotesToBuyer.mockRejectedValueOnce(failure);

    const result = await run(f);

    expect(result).toMatchObject({ processedShipments: 0, importedItems: 1, warnings: 1, failed: 0 });
    expect(result.warningDetails).toEqual([{
      orderNumber: "111-0318024-9415409",
      stage: "notes_update",
      summary: "ShipStation synchronization could not be completed.",
    }]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE SHIPSTATION ERROR");
    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
  });

  it("caps public synchronization warning records at ten while retaining the total warning count", async () => {
    // Break caught: a large warning batch can grow a public completion payload without bound or undercount warnings.
    const failure = new ShipStationError("invalid_response", {
      validation: {
        reasonCode: "invalid_field_value",
        field: "shipping_service",
        summary: "The selected shipping service is invalid.",
      },
    });
    const f = fixture({
      shipments: Array.from({ length: 11 }, (_, index) => shipment(`invalid-${index + 1}`, {
        external_order_id: `111-${String(index + 1).padStart(7, "0")}-${String(index + 1).padStart(7, "0")}`,
        items: [item(`invalid-item-${index + 1}`, { customizedUrl: "https://amazon.example/customization" })],
      })),
    });
    f.client.updateNotesToBuyer.mockRejectedValue(failure);

    const result = await run(f);

    expect(result.importedItems).toBe(11);
    expect(result.warnings).toBe(11);
    expect(result.failed).toBe(0);
    expect(result.warningDetails).toHaveLength(10);
    expect(result.warningDetails).toEqual(Array.from({ length: 10 }, (_, index) => ({
      orderNumber: `111-${String(index + 1).padStart(7, "0")}-${String(index + 1).padStart(7, "0")}`,
      stage: "notes_update",
      summary: "ShipStation synchronization could not be completed.",
    })));
  });

  it("omits public warning details when ShipStation supplies a fallback order identifier", async () => {
    // Break caught: a loose fallback identifier crosses the public warning boundary and is later rejected by the browser.
    const failure = new ShipStationError("invalid_response", {
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    const f = fixture({
      shipments: [shipment("fallback-id", {
        external_order_id: "order-fallback-id",
        items: [item("fallback-id-item", { customizedUrl: "https://amazon.example/customization" })],
      })],
    });
    f.client.updateNotesToBuyer.mockRejectedValueOnce(failure);

    const result = await run(f);

    expect(result).toMatchObject({ importedItems: 1, warnings: 1, failed: 0, warningDetails: [] });
  });

  it("attributes note construction to the failing item and clears item context for shipment-wide work", async () => {
    // Break caught: note construction is mislabeled as enrichment, or later shipment failures name the final item.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-notes-build",
      workspaceId: "workspace-1",
    });
    const f = fixture({
      diagnostics,
      shipments: [shipment("multi-item", {
        items: [
          item("good-item", { customizedUrl: "https://zme-caps.amazon.com/good.zip" }),
          item("bad-title-item", { name: "", customizedUrl: "https://zme-caps.amazon.com/bad.zip" }),
        ],
      })],
    });

    await expect(run(f)).resolves.toMatchObject({ processedShipments: 0, importedItems: 2, warnings: 1, failed: 0 });

    expect(calls.filter(({ event }) => event === "amazon_import.shipment.warning")).toEqual([{
      level: "error",
      event: "amazon_import.shipment.warning",
      context: {
        runId: "run-notes-build",
        workspaceId: "workspace-1",
        shipmentId: "multi-item",
        orderNumber: "order-multi-item",
        orderItemId: "bad-title-item",
        stage: "notes_build",
        errorName: "TypeError",
        errorCode: null,
        statusCode: null,
        retryable: null,
        requestId: null,
      },
    }]);
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
  });

  it("attributes a fatal shipment-listing failure to shipment fetch", async () => {
    // Break caught: a global iterator failure has correlation but no safe pipeline stage.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-shipment-fetch",
      workspaceId: "workspace-1",
    });
    const failure = new ShipStationError("request_failed", {
      statusCode: 401,
      retryable: false,
      requestId: "shipment-fetch-request",
    });
    const f = fixture({ diagnostics });
    f.client.iteratePendingShipments.mockImplementation(async function* () {
      throw failure;
    });

    await expect(run(f)).rejects.toBe(failure);

    expect(calls.filter(({ event }) => event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      event: "amazon_import.run.failed",
      context: {
        runId: "run-shipment-fetch",
        workspaceId: "workspace-1",
        stage: "shipment_fetch",
        errorName: "ShipStationError",
        errorCode: "request_failed",
        statusCode: 401,
        retryable: false,
        requestId: "shipment-fetch-request",
      },
    }]);
  });

  it("emits a safe run failure without changing release behavior", async () => {
    // Break caught: globally fatal shipment errors escape without the current safe stage or disrupt lock release.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-global",
      workspaceId: "workspace-1",
    });
    const failure = Object.assign(new ShipStationError("request_failed", {
      statusCode: 401,
      retryable: false,
      requestId: "request-global",
    }), {
      message: "AUTHORIZATION SECRET",
      stack: "AUTHORIZATION STACK SECRET",
    });
    const f = fixture({
      diagnostics,
      shipments: [shipment("fatal", {
        items: [item("fatal-item", { customizedUrl: "https://amazon.example/private" })],
      })],
    });
    f.client.updateNotesToBuyer.mockRejectedValueOnce(failure);

    await expect(run(f)).rejects.toBe(failure);

    expect(calls.filter(({ event }) => event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      event: "amazon_import.run.failed",
      context: {
        runId: "run-global",
        workspaceId: "workspace-1",
        shipmentId: "fatal",
        orderNumber: "order-fatal",
        stage: "notes_update",
        errorName: "ShipStationError",
        errorCode: "request_failed",
        statusCode: 401,
        retryable: false,
        requestId: "request-global",
      },
    }]);
    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
    expect(JSON.stringify(calls)).not.toContain("AUTHORIZATION SECRET");
    expect(JSON.stringify(calls)).not.toContain("AUTHORIZATION STACK SECRET");
  });

  it("emits a safe run failure when primary lock release escapes run", async () => {
    // Break caught: release errors thrown from run's finally bypass the global failure diagnostic.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-release",
      workspaceId: "workspace-1",
    });
    const failure = Object.assign(new Error("RELEASE CREDENTIAL SECRET"), {
      name: "ReleaseFailure",
      code: "release_failed",
      statusCode: 503,
      retryable: true,
      requestId: "request-release",
      stack: "RELEASE STACK SECRET",
    });
    const f = fixture({ diagnostics });
    f.store.releaseAmazonImportLock.mockRejectedValueOnce(failure);

    await expect(run(f)).rejects.toBe(failure);

    expect(calls.filter(({ event }) => event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      event: "amazon_import.run.failed",
      context: {
        runId: "run-release",
        workspaceId: "workspace-1",
        stage: "release",
        errorName: null,
        errorCode: null,
        statusCode: 503,
        retryable: true,
        requestId: null,
      },
    }]);
    expect(calls.filter(({ event }) => event === "amazon_import.run.completed")).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("RELEASE CREDENTIAL SECRET");
    expect(JSON.stringify(calls)).not.toContain("RELEASE STACK SECRET");
  });

  it("does not emit run completion when the final progress callback fails", async () => {
    // Break caught: terminal transport failure produces contradictory run.completed and run.failed events.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-terminal-progress",
      workspaceId: "workspace-1",
    });
    const failure = Object.assign(new Error("TERMINAL TRANSPORT SECRET"), {
      name: "ProgressFailure",
      code: "progress_failed",
      statusCode: 503,
      retryable: true,
      requestId: "request-terminal",
      stack: "TERMINAL STACK SECRET",
    });
    const f = fixture({ diagnostics });

    await expect(run(f, {
      onProgress(event) {
        if (event.type === "complete") throw failure;
      },
    })).rejects.toBe(failure);

    expect(calls.filter(({ event }) => event === "amazon_import.run.completed")).toEqual([]);
    expect(calls.filter(({ event }) => event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      event: "amazon_import.run.failed",
      context: {
        runId: "run-terminal-progress",
        workspaceId: "workspace-1",
        stage: "progress_delivery",
        errorName: null,
        errorCode: null,
        statusCode: 503,
        retryable: true,
        requestId: null,
      },
    }]);
    expect(f.store.releaseAmazonImportLock).toHaveBeenCalledOnce();
    expect(JSON.stringify(calls)).not.toContain("TERMINAL TRANSPORT SECRET");
    expect(JSON.stringify(calls)).not.toContain("TERMINAL STACK SECRET");
  });

  it("keeps import results unchanged when injected diagnostics throw or reject", async () => {
    // Break caught: optional production logging changes the transactional import outcome.
    for (const diagnostics of [
      { info: () => { throw new Error("logger unavailable"); }, error: () => { throw new Error("logger unavailable"); } },
      { info: () => Promise.reject(new Error("logger unavailable")), error: () => Promise.reject(new Error("logger unavailable")) },
    ]) {
      const f = fixture({ diagnostics });
      await expect(run(f)).resolves.toMatchObject({
        processedShipments: 1,
        importedItems: 1,
        failed: 0,
      });
      await flushMicrotasks();
      expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    }
  });

  it("keeps normalization and import results unchanged for deeply nested diagnostic documents", async () => {
    // Break caught: optional empty-document diagnostics overflow before the real normalizer and persistence run.
    let deeplyNested = {};
    for (let depth = 0; depth < 20_000; depth += 1) {
      deeplyNested = { customizationData: deeplyNested };
    }
    const f = fixture({
      fetchResult: deeplyNested,
      shipments: [shipment("deep-document", {
        items: [item("deep-item", { customizedUrl: "https://zme-caps.amazon.com/deep.zip" })],
      })],
    });

    await expect(run(f)).resolves.toMatchObject({
      processedShipments: 1,
      importedItems: 1,
      customizationNeeded: 1,
      failed: 0,
    });
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
  });

  it("falls back safely when structural summary construction throws", async () => {
    // Break caught: a diagnostics-only summary exception changes an otherwise valid import result.
    const explosiveDocument = {};
    Object.defineProperty(explosiveDocument, "version3.0", {
      get() { throw new Error("diagnostic summary failed"); },
    });
    const diagnosticEvents = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => diagnosticEvents.push({ event, context }),
        error: vi.fn(),
      }),
      runId: "run-summary-fallback",
      workspaceId: "workspace-1",
    });
    const f = fixture({
      diagnostics,
      fetchResult: explosiveDocument,
      normalizeItem: ({ item: currentItem }) => ({
        id: `amazon-order-item:${currentItem.external_order_item_id}`,
        text: "Safe normalized text",
        source: {
          amazonOrderItemId: currentItem.external_order_item_id,
          personalizationResponses: [],
          customizationNeeded: false,
        },
      }),
      shipments: [shipment("summary-fallback", {
        items: [item("summary-item", { customizedUrl: "https://zme-caps.amazon.com/summary.zip" })],
      })],
    });

    await expect(run(f)).resolves.toMatchObject({ processedShipments: 1, importedItems: 1, failed: 0 });
    const summaryEvent = diagnosticEvents.find(({ event }) => event === "amazon_import.item.customization_fetched");
    expect(summaryEvent.context.summary).toEqual({
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

  it("reports a safe font-resolution summary without changing the enriched item shape", () => {
    // Break caught: enrichment diagnostics expose customer font values or become persisted item data.
    const onEnriched = vi.fn();
    const enrich = createAmazonItemEnricher({
      presetSnapshot: {
        presets: [{
          id: "preset-amazon",
          globalDefaults: { backingMm: 4.2 },
          lineDefaults: { fontId: "candlepin", bridgeMm: 0.6 },
          lineRules: [],
          listingAssignments: [],
        }],
      },
      fontOptions: [{ id: "skywalk", displayName: "Skywalk" }],
      onEnriched,
    });
    const input = {
      text: "Maria\nRN",
      source: {
        customerFontSelections: [
          { lineIndex: 0, name: "Skywalk" },
          { lineIndex: 1, name: "TOP SECRET FONT VALUE" },
        ],
      },
    };

    const enriched = enrich(input);

    expect(enriched).toEqual({
      ...input,
      presetId: "preset-amazon",
      settings: {
        backingMm: 4.2,
        presetId: "preset-amazon",
        lines: [
          { fontId: "skywalk", bridgeMm: 0.6 },
          { fontId: "candlepin", bridgeMm: 0.6 },
        ],
      },
    });
    expect(onEnriched).toHaveBeenCalledWith({
      presetId: "preset-amazon",
      designLineCount: 2,
      selectionCount: 2,
      recognizedCount: 1,
      unknownCount: 1,
      effectiveFontIds: ["skywalk", "candlepin"],
    });
    const [summary] = onEnriched.mock.calls[0];
    expect(JSON.stringify(summary)).not.toContain("Skywalk");
    expect(JSON.stringify(summary)).not.toContain("TOP SECRET FONT VALUE");
    expect(enriched).not.toHaveProperty("diagnostics");
    expect(enriched.source).toBe(input.source);
  });

  it("reports persistence-compatible line and font diagnostics when no preset is available", () => {
    // Break caught: no-preset diagnostics claim no lines exist and ignore resolvable workspace font selections.
    const onEnriched = vi.fn();
    const enrich = createAmazonItemEnricher({
      presetSnapshot: { presets: [] },
      fontOptions: [{ id: "skywalk", displayName: "Skywalk" }],
      onEnriched,
    });

    expect(enrich({
      text: "Maria\nRN",
      source: { customerFontSelections: [
        { lineIndex: 0, name: "Skywalk" },
        { lineIndex: 1, name: "PRIVATE UNKNOWN FONT" },
      ] },
    })).toEqual({
      text: "Maria\nRN",
      source: { customerFontSelections: [
        { lineIndex: 0, name: "Skywalk" },
        { lineIndex: 1, name: "PRIVATE UNKNOWN FONT" },
      ] },
    });
    expect(onEnriched).toHaveBeenCalledWith({
      presetId: null,
      designLineCount: 2,
      selectionCount: 2,
      recognizedCount: 1,
      unknownCount: 1,
      effectiveFontIds: ["candlepin", "candlepin"],
    });
    expect(JSON.stringify(onEnriched.mock.calls)).not.toContain("PRIVATE UNKNOWN FONT");
  });

  it("keeps importing when font-diagnostic callbacks throw or reject", async () => {
    // Break caught: optional diagnostics turn callback failures into failed imports or unhandled rejections.
    for (const onEnriched of [
      () => { throw new Error("diagnostic callback failed"); },
      () => Promise.reject(new Error("diagnostic callback rejected")),
    ]) {
      const enrichItem = createAmazonItemEnricher({
        presetSnapshot: { presets: [] },
        fontOptions: [],
        onEnriched,
      });
      const f = fixture({ enrichItem });

      await expect(run(f)).resolves.toMatchObject({ importedItems: 1 });
      await flushMicrotasks();
      expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    }
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
    const diagnosticEvents = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => diagnosticEvents.push({ event, context }),
        error: vi.fn(),
      }),
      runId: "run-skipped",
      workspaceId: "workspace-1",
    });
    const f = fixture({
      diagnostics,
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
    expect(diagnosticEvents.filter(({ event }) => event === "amazon_import.shipment.skipped")).toEqual([
      {
        event: "amazon_import.shipment.skipped",
        context: {
          runId: "run-skipped",
          workspaceId: "workspace-1",
          shipmentId: "object-tag",
          orderNumber: "order-object-tag",
          skipReason: "processed_tag_present",
        },
      },
      {
        event: "amazon_import.shipment.skipped",
        context: {
          runId: "run-skipped",
          workspaceId: "workspace-1",
          shipmentId: "string-tag",
          orderNumber: "order-string-tag",
          skipReason: "processed_tag_present",
        },
      },
    ]);
  });

  it("imports every line item and treats only exact CustomizedURL options as archives", async () => {
    const customizationDocument = customization("Alicia", "Glitter Blue");
    const f = fixture({
      fetchResult: customizationDocument,
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
    expect(persisted.items.map(({ amazonCustomizationJson }) => amazonCustomizationJson)).toEqual([
      customizationDocument,
      null,
      null,
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
    expect(f.sequence.findIndex((entry) => entry.startsWith("persist:")))
      .toBeLessThan(f.sequence.indexOf("notes:marker-content"));
    expect(f.sequence.indexOf("notes:marker-content"))
      .toBeLessThan(f.sequence.indexOf("tag:marker-content"));
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 2,
      failed: 0,
    });
  });

  it("persists customized items, then appends note blocks in shipment order and tags last", async () => {
    const shipmentItems = [
      item("first", {
        name: "First Reel",
        customizedUrl: "https://zme-caps.amazon.com/first.zip",
      }),
      item("second", {
        name: "Second Reel",
        customizedUrl: "https://zme-caps.amazon.com/second.zip",
      }),
    ];
    const f = fixture({
      shipments: [shipment("ordered", {
        notes: "Original buyer note",
        ship_to: { name: "Buyer" },
        warehouse_id: "se-warehouse",
        carrier_id: "se-carrier",
        service_code: "usps_ground_advantage",
        requested_shipment_service: "USPS Ground Advantage",
        shipping_rule_id: "se-rule",
        packages: [{ package_code: "package", weight: { value: 1.1, unit: "ounce" } }],
        items: shipmentItems,
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
      shipTo: { name: "Buyer" },
      shipFrom: undefined,
      warehouseId: "se-warehouse",
      carrierId: "se-carrier",
      serviceCode: "usps_ground_advantage",
      requestedShipmentService: "USPS Ground Advantage",
      shippingRuleId: "se-rule",
      packages: [{ package_code: "package", weight: { value: 1.1, unit: "ounce" } }],
      items: shipmentItems,
      signal: undefined,
    });
    expect(f.sequence.findIndex((entry) => entry.startsWith("persist:")))
      .toBeLessThan(f.sequence.indexOf("notes:ordered"));
    expect(f.sequence.indexOf("notes:ordered"))
      .toBeLessThan(f.sequence.indexOf("tag:ordered"));
    expect(f.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      processedShipments: 1,
      importedItems: 1,
      existingItems: 1,
      customizationNeeded: 0,
      warnings: 0,
      failed: 0,
      failures: [],
    });
  });

  it("includes Amazon v3 text-area fonts in Notes to Buyer", async () => {
    // Break caught: parsed customer fonts reach design enrichment but disappear before ShipStation note generation.
    const f = fixture({
      shipments: [shipment("font-notes", {
        items: [item("font-item", {
          customizedUrl: "https://zme-caps.amazon.com/font-item.zip",
        })],
      })],
      fetchResult: {
        "version3.0": {
          customizationInfo: {
            surfaces: [{
              areas: [
                { customizationType: "text", label: "Name", text: "Jane", fontFamily: "Skywalk" },
                { customizationType: "text", label: "Title", text: "RN", fontFamily: "Somekind" },
              ],
            }],
          },
        },
      },
    });

    await run(f);

    const updatedNotes = f.client.updateNotesToBuyer.mock.calls[0][0].notesToBuyer;
    expect(updatedNotes).toContain([
      "Name: Jane",
      "Name Font: Skywalk",
      "Title: RN",
      "Title Font: Somekind",
    ].join("\n"));
  });

  it("uses an existing item marker to repair app persistence and tagging without rewriting notes", async () => {
    const diagnosticEvents = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => diagnosticEvents.push({ event, context }),
        error: vi.fn(),
      }),
      runId: "run-existing",
      workspaceId: "workspace-1",
    });
    const existingBlock = [
      "Amazon Customization -- Retry Reel",
      "Name: Jane",
      "Color: Teal",
      "Amazon Order Item: retry-item",
    ].join("\n");
    const f = fixture({
      diagnostics,
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
    expect(diagnosticEvents.filter(({ event }) => event === "amazon_import.item.persisted")).toEqual([{
      event: "amazon_import.item.persisted",
      context: {
        runId: "run-existing",
        workspaceId: "workspace-1",
        shipmentId: "retry",
        orderNumber: "order-retry",
        orderItemId: "retry-item",
        persistenceOutcome: "existing",
      },
    }]);
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
      warnings: 1,
      failed: 0,
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
    expect(auth.store.importAmazonOrderItemsTransactional).toHaveBeenCalledOnce();
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
      warnings: 0,
      failed: 0,
      failures: [],
      warningDetails: [],
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
    // Break caught: cancellation releases a prepared lease before run and the correlated terminal failure disappears.
    const calls = [];
    const diagnostics = createAmazonImportDiagnostics({
      logger: flattenDiagnosticLogger({
        info: (event, context) => calls.push({ level: "info", event, context }),
        error: (event, context) => calls.push({ level: "error", event, context }),
      }),
      runId: "run-released-before-start",
      workspaceId: "workspace-1",
    });
    const released = fixture({ diagnostics });
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
    expect(calls.filter(({ event }) => event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      event: "amazon_import.run.failed",
      context: {
        runId: "run-released-before-start",
        workspaceId: "workspace-1",
        stage: "preparation",
        errorName: "AmazonImportError",
        errorCode: "import_not_active",
        statusCode: 409,
        retryable: null,
        requestId: null,
      },
    }]);

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
