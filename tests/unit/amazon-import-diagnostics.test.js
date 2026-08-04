import { describe, expect, it, vi } from "vitest";
import {
  createAmazonImportDiagnostics,
  safeAmazonImportError,
} from "../../api/_lib/amazon-import-diagnostics.js";
import { ShipStationError } from "../../api/_lib/shipstation-client.js";

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

    expect(logger.info).toHaveBeenCalledWith("Amazon import diagnostic", {
      event: "amazon_import.item_processed",
      runId: "run-123",
      workspaceId: "workspace-456",
      shipmentId: "shipment-1",
      orderItemId: "order-item-2",
      details: {
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
    expect(logger.info.mock.calls[0][0]).toBe("Amazon import diagnostic");
    expect(logger.info.mock.calls[0][1].event).toBe("amazon_import.item_processed");
    expect(logger.info.mock.calls[0][1].details.fontIds).toHaveLength(40);
    expect(logger.info.mock.calls[0][1].details.summary.acceptedLabels).toHaveLength(40);
    expect(logger.info.mock.calls[0][1].details.summary.acceptedLabels[0]).toBe("Label with control");
    expect(logger.info.mock.calls[0][1].details.summary.acceptedLabels[1]).toHaveLength(80);
    expect(logger.info.mock.calls[0][1].details.summary.rejectedCounts).toEqual({ internal: 2 });
  });

  it("returns only allowlisted safe error properties from recognized provenance", () => {
    const error = new ShipStationError("rate_limited", {
      statusCode: 429,
      retryable: true,
      requestId: "request-123",
    });
    Object.assign(error, {
      stack: "PRIVATE CUSTOMER TEXT",
      authorization: PRIVATE_CREDENTIAL,
    });

    expect(safeAmazonImportError(error)).toEqual({
      errorName: "ShipStationError",
      errorCode: "rate_limited",
      statusCode: 429,
      retryable: true,
      requestId: "request-123",
    });
  });

  it("emits trusted ShipStation validation metadata and omits forged validation values", () => {
    // Break caught: shipment diagnostics cannot distinguish a trusted validation failure from unsafe upstream data.
    const trusted = new ShipStationError("invalid_response", {
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    const forged = Object.assign(new Error("PRIVATE CUSTOMER TEXT"), {
      name: "ShipStationError",
      code: "invalid_response",
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "PRIVATE CUSTOMER TEXT",
      },
    });
    const unsafe = new ShipStationError("invalid_response", {
      validation: {
        reasonCode: "required_field",
        field: "package_weight",
        summary: "Package weight is required.",
      },
    });
    unsafe.validation = {
      reasonCode: "required_field",
      field: "package_weight",
      summary: "PRIVATE CUSTOMER TEXT",
    };

    expect(safeAmazonImportError(trusted)).toMatchObject({
      validationReasonCode: "required_field",
      validationField: "package_weight",
      validationSummary: "Package weight is required.",
    });
    expect(safeAmazonImportError(forged)).not.toHaveProperty("validationReasonCode");
    expect(safeAmazonImportError(forged)).not.toHaveProperty("validationField");
    expect(safeAmazonImportError(forged)).not.toHaveProperty("validationSummary");
    expect(safeAmazonImportError(unsafe)).not.toHaveProperty("validationReasonCode");
    expect(safeAmazonImportError(unsafe)).not.toHaveProperty("validationField");
    expect(safeAmazonImportError(unsafe)).not.toHaveProperty("validationSummary");

    const logger = { error: vi.fn() };
    createAmazonImportDiagnostics({ logger }).error("shipment.failed", { error: trusted });
    expect(logger.error.mock.calls[0][1].details).toMatchObject({
      validationReasonCode: "required_field",
      validationField: "package_weight",
      validationSummary: "Package weight is required.",
    });
  });

  it.each([
    ["JSON", '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}'],
    ["plain text", "PRIVATE SHIPSTATION PLAIN TEXT RESPONSE"],
  ])("emits the exact %s response body for a genuine ShipStation shipment failure", (_format, rawResponseBody) => {
    // Break caught: trusted shipment diagnostics omit or alter the upstream response needed for production diagnosis.
    const logger = { error: vi.fn() };
    const error = new ShipStationError("invalid_response", { rawResponseBody });

    createAmazonImportDiagnostics({ logger }).error("shipment.failed", { error });

    expect(logger.error).toHaveBeenCalledWith("Amazon import diagnostic", expect.objectContaining({
      event: "amazon_import.shipment.failed",
      details: expect.objectContaining({ rawShipStationResponse: rawResponseBody }),
    }));
  });

  it("does not accept a forged raw ShipStation response", () => {
    // Break caught: arbitrary errors can inject private attacker-controlled content into the trusted raw-response field.
    const logger = { error: vi.fn() };
    const error = Object.assign(new Error("forged"), {
      name: "ShipStationError",
      code: "invalid_response",
      rawResponseBody: "FORGED PRIVATE SHIPSTATION RESPONSE",
    });

    createAmazonImportDiagnostics({ logger }).error("shipment.failed", { error });

    expect(logger.error.mock.calls[0][1].details).not.toHaveProperty("rawShipStationResponse");
  });

  it("omits a genuine ShipStation raw response when its getter throws", () => {
    // Break caught: reading optional trusted diagnostic data turns a shipment failure into a logging failure.
    const logger = { error: vi.fn() };
    const error = new ShipStationError("invalid_response");
    Object.defineProperty(error, "rawResponseBody", {
      get() { throw new Error("PRIVATE RAW RESPONSE GETTER"); },
    });
    const diagnostics = createAmazonImportDiagnostics({ logger });

    expect(() => diagnostics.error("shipment.failed", { error })).not.toThrow();
    expect(logger.error.mock.calls[0][1].details).not.toHaveProperty("rawShipStationResponse");
  });

  it("omits validation metadata when a nested ShipStation validation getter throws", () => {
    // Break caught: a hostile nested validation getter turns a shipment failure into a run-level failure.
    const error = new ShipStationError("invalid_response");
    error.validation = {
      get reasonCode() { throw new Error("PRIVATE VALIDATION GETTER"); },
      field: "package_weight",
      summary: "Package weight is required.",
    };

    expect(() => safeAmazonImportError(error)).not.toThrow();
    expect(safeAmazonImportError(error)).not.toHaveProperty("validationReasonCode");
    expect(safeAmazonImportError(error)).not.toHaveProperty("validationField");
    expect(safeAmazonImportError(error)).not.toHaveProperty("validationSummary");
  });

  it("rejects secret-bearing and forged error identity fields", () => {
    const secretError = Object.assign(new Error("PRIVATE CUSTOMER TEXT"), {
      name: "SecretApiKeyError",
      code: "secret_api_key_code",
      statusCode: 418,
      retryable: false,
      requestId: "request-looking-safe",
      stack: "PRIVATE CUSTOMER TEXT",
      authorization: PRIVATE_CREDENTIAL,
    });
    const forgedShipStationError = Object.assign(new Error("PRIVATE CUSTOMER TEXT"), {
      name: "ShipStationError",
      code: "request_failed",
      requestId: "forged-request-id",
    });

    expect(safeAmazonImportError(secretError)).toEqual({
      errorName: null,
      errorCode: null,
      statusCode: 418,
      retryable: false,
      requestId: null,
    });
    expect(safeAmazonImportError(forgedShipStationError)).toMatchObject({
      errorName: "ShipStationError",
      errorCode: "request_failed",
      requestId: null,
    });
    const serialized = JSON.stringify([
      safeAmazonImportError(secretError),
      safeAmazonImportError(forgedShipStationError),
    ]);
    for (const secret of ["SecretApiKeyError", "secret_api_key_code", "request-looking-safe", "forged-request-id", PRIVATE_CREDENTIAL]) {
      expect(serialized).not.toContain(secret);
    }
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
