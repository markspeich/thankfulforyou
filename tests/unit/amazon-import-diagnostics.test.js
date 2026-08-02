import { describe, expect, it, vi } from "vitest";
import {
  createAmazonImportDiagnostics,
  safeAmazonImportError,
} from "../../api/_lib/amazon-import-diagnostics.js";

const PRIVATE_CUSTOMIZATION_URL = "https://amazon.example/customization/private-token";
const PRIVATE_ADDRESS = "123 Private Lane, Exampletown";
const PRIVATE_CREDENTIAL = "Bearer super-secret-token";

describe("Amazon import diagnostics", () => {
  it("emits a bounded safe envelope with correlation and structural details", () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const diagnostics = createAmazonImportDiagnostics({
      logger,
      runId: "run-123",
      workspaceId: "workspace-456",
    });

    diagnostics.info("item_processed", {
      shipmentId: "shipment-1",
      orderItemId: "order-item-2",
      presetId: "preset-3",
      fontIds: ["font-1", "font-2", "font-3"],
      persistenceOutcome: "created",
      summary: {
        format: "v3",
        surfaceCount: 1,
        areaCount: 3,
        candidateNodeCount: 3,
        acceptedTextCount: 1,
        acceptedConfigurationCount: 1,
        acceptedLabels: ["Name", "Color"],
        rejectedCounts: { internal: 1 },
      },
    });

    expect(logger.info).toHaveBeenCalledWith("amazon_import.item_processed", {
      runId: "run-123",
      workspaceId: "workspace-456",
      shipmentId: "shipment-1",
      orderItemId: "order-item-2",
      presetId: "preset-3",
      fontIds: ["font-1", "font-2", "font-3"],
      persistenceOutcome: "created",
      summary: {
        format: "v3",
        surfaceCount: 1,
        areaCount: 3,
        candidateNodeCount: 3,
        acceptedTextCount: 1,
        acceptedConfigurationCount: 1,
        acceptedLabels: ["Name", "Color"],
        rejectedCounts: { internal: 1 },
      },
    });
  });

  it("omits private inputs and limits details to bounded allowlisted fields", () => {
    const logger = { info: vi.fn() };
    const diagnostics = createAmazonImportDiagnostics({ logger, runId: "run-1", workspaceId: "workspace-1" });

    diagnostics.info("item_processed", {
      shipmentId: "shipment-1",
      customerText: "PRIVATE CUSTOMER TEXT",
      customizationUrl: PRIVATE_CUSTOMIZATION_URL,
      buyerAddress: PRIVATE_ADDRESS,
      authorization: PRIVATE_CREDENTIAL,
      archive: { contents: "PRIVATE CUSTOMER TEXT" },
      persistenceOutcome: "PRIVATE CUSTOMER TEXT",
      fontIds: Array.from({ length: 45 }, (_, index) => `font-${index}`),
      summary: {
        format: "legacy",
        acceptedLabels: ["Label\u0000 with control", ...Array.from({ length: 45 }, () => "x".repeat(100))],
        rejectedCounts: { internal: 2, unknown: 99 },
        ignored: "PRIVATE CUSTOMER TEXT",
      },
    });

    const serialized = JSON.stringify(logger.info.mock.calls[0]);
    expect(serialized).not.toContain("PRIVATE CUSTOMER TEXT");
    expect(serialized).not.toContain(PRIVATE_CUSTOMIZATION_URL);
    expect(serialized).not.toContain(PRIVATE_ADDRESS);
    expect(serialized).not.toContain(PRIVATE_CREDENTIAL);
    expect(logger.info.mock.calls[0][1].fontIds).toHaveLength(40);
    expect(logger.info.mock.calls[0][1].summary.acceptedLabels).toHaveLength(40);
    expect(logger.info.mock.calls[0][1].summary.acceptedLabels[0]).toBe("Label with control");
    expect(logger.info.mock.calls[0][1].summary.acceptedLabels[1]).toHaveLength(80);
    expect(logger.info.mock.calls[0][1].summary.rejectedCounts).toEqual({ internal: 2 });
  });

  it("returns only allowlisted safe error properties", () => {
    const error = Object.assign(new Error("PRIVATE CUSTOMER TEXT"), {
      code: "rate_limited",
      statusCode: 429,
      retryable: true,
      requestId: "request-123",
      stack: "PRIVATE CUSTOMER TEXT",
      authorization: PRIVATE_CREDENTIAL,
    });

    expect(safeAmazonImportError(error)).toEqual({
      errorName: "Error",
      errorCode: "rate_limited",
      statusCode: 429,
      retryable: true,
      requestId: "request-123",
    });
  });

  it("isolates logger failures from the import path", () => {
    const diagnostics = createAmazonImportDiagnostics({
      logger: { info: () => { throw new Error("logger unavailable"); }, error: () => { throw new Error("logger unavailable"); } },
      runId: "run-1",
      workspaceId: "workspace-1",
    });

    expect(() => diagnostics.info("item_processed", { orderItemId: "item-1" })).not.toThrow();
    expect(() => diagnostics.error("item_failed", { error: new Error("PRIVATE CUSTOMER TEXT") })).not.toThrow();
  });
});
