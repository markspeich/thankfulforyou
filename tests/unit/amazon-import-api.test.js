import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAmazonImportHandler } from "../../api/amazon-import.js";
import {
  AmazonImportError,
  createAmazonImportService,
} from "../../api/_lib/amazon-import-service.js";
import { createAmazonImportDiagnostics } from "../../api/_lib/amazon-import-diagnostics.js";
import { ShipStationError } from "../../api/_lib/shipstation-client.js";
import { importAmazonOrders } from "../../src/amazon-api.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function response() {
  return {
    headers: {},
    chunks: [],
    destroyed: false,
    writableEnded: false,
    writableFinished: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.body = payload; this.writableEnded = true; },
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.ended = true; this.writableEnded = true; },
    flushHeaders: vi.fn(),
  };
}

function realServiceDependencies({ client, releaseAmazonImportLock }) {
  vi.stubEnv("SHIPSTATION_API_KEY", "shipstation-secret");
  vi.stubEnv("SHIPSTATION_AMAZON_STORE_ID", "se-4461867");
  return {
    store: {
      acquireAmazonImportLock: vi.fn().mockResolvedValue(true),
      renewAmazonImportLock: vi.fn().mockResolvedValue(true),
      releaseAmazonImportLock,
      importAmazonOrderItemsTransactional: vi.fn(),
    },
    createShipStationClient: vi.fn(() => client),
    fetchCustomizationJson: vi.fn(),
    normalizeItem: vi.fn(),
    appendNoteBlocks: vi.fn(),
    loadPresetSnapshot: vi.fn().mockResolvedValue({ defaultPresetId: null, presets: [] }),
    listWorkspaceFonts: vi.fn().mockResolvedValue([]),
  };
}

function recordingDiagnosticsFactory(events) {
  return vi.fn(({ runId, workspaceId }) => createAmazonImportDiagnostics({
    logger: {
      info: (message, envelope) => events.push({ level: "info", message, envelope }),
      error: (message, envelope) => events.push({ level: "error", message, envelope }),
    },
    runId,
    workspaceId,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Amazon import API", () => {
  it("creates one authenticated correlation and passes it through service enrichment without changing NDJSON", async () => {
    // Break caught: a request creates split correlations, omits workspace scope, or exposes diagnostics publicly.
    const diagnostics = { info: vi.fn(), error: vi.fn() };
    const diagnosticsFactory = vi.fn(() => diagnostics);
    const randomUUID = vi.fn(() => "run-generated-123");
    const enrichItem = vi.fn((item) => item);
    const itemEnricherFactory = vi.fn(() => enrichItem);
    const serviceFactory = vi.fn(({ diagnostics: serviceDiagnostics, enrichItem: serviceEnricher }) => ({
      prepare: async ({ onProgress }) => ({
        run: async () => {
          expect(serviceDiagnostics).toBe(diagnostics);
          expect(serviceEnricher).toBe(enrichItem);
          await onProgress({ type: "progress", stage: "processing_shipments", processed: 1, total: 2 });
          await onProgress({
            type: "complete",
            processedShipments: 1,
            importedItems: 1,
            existingItems: 0,
            alreadyProcessedShipments: 0,
            customizationNeeded: 0,
            failed: 0,
          });
        },
        release: vi.fn(),
      }),
    }));
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-authenticated", userId: "user-1" }),
      serviceFactory,
      dependencies: {
        loadPresetSnapshot: vi.fn().mockResolvedValue({ defaultPresetId: null, presets: [] }),
        listWorkspaceFonts: vi.fn().mockResolvedValue([]),
      },
      diagnosticsFactory,
      itemEnricherFactory,
      randomUUID,
    })({ method: "POST" }, res);

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(diagnosticsFactory).toHaveBeenCalledOnce();
    expect(diagnosticsFactory).toHaveBeenCalledWith({
      logger: console,
      runId: "run-generated-123",
      workspaceId: "workspace-authenticated",
    });
    expect(itemEnricherFactory).toHaveBeenCalledWith(expect.objectContaining({ diagnostics }));
    expect(serviceFactory).toHaveBeenCalledWith(expect.objectContaining({ diagnostics, enrichItem }));
    expect(res.chunks).toEqual([
      '{"type":"progress","stage":"processing_shipments","processed":1,"total":2}\n',
      '{"type":"complete","processedShipments":1,"importedItems":1,"existingItems":0,"alreadyProcessedShipments":0,"customizationNeeded":0,"failed":0}\n',
    ]);
  });

  it("streams trusted bounded completion failures without arbitrary error response content", async () => {
    // Break caught: the NDJSON boundary drops trusted validation records or forwards arbitrary upstream error response data.
    const rawResponseBody = '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}';
    const res = response();
    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async ({ onProgress }) => ({
          run: async () => onProgress({
            type: "complete",
            processedShipments: 0,
            importedItems: 0,
            existingItems: 0,
            alreadyProcessedShipments: 0,
            customizationNeeded: 0,
            failed: 1,
            failures: [{
              orderNumber: "111-0318024-9415409",
              stage: "notes_update",
              reasonCode: "required_field",
              summary: "Package weight is required.",
              rawShipStationResponse: rawResponseBody,
              response: "PRIVATE UPSTREAM ERROR RESPONSE",
            }],
            response: "PRIVATE TOP LEVEL ERROR RESPONSE",
          }),
          release: vi.fn(),
        }),
      }),
    })({ method: "POST" }, res);

    expect(res.chunks).toEqual([
      '{"type":"complete","processedShipments":0,"importedItems":0,"existingItems":0,"alreadyProcessedShipments":0,"customizationNeeded":0,"failed":1,"failures":[{"orderNumber":"111-0318024-9415409","stage":"notes_update","reasonCode":"required_field","summary":"Package weight is required."}]}\n',
    ]);
    expect(res.chunks.join("")).not.toContain("PRIVATE UPSTREAM ERROR RESPONSE");
    expect(res.chunks.join("")).not.toContain("PRIVATE TOP LEVEL ERROR RESPONSE");
    expect(res.chunks.join("")).not.toContain("PRIVATE SHIPSTATION ERROR");
    expect(res.chunks.join("")).not.toContain("PRIVATE VALUE");
  });

  it("emits completion frames that preserve valid details through the browser parser and omit fallback IDs", async () => {
    // Break caught: the server accepts an identifier grammar that makes its own completion frame fail browser parsing.
    const completion = {
      type: "complete",
      processedShipments: 0,
      importedItems: 0,
      existingItems: 0,
      alreadyProcessedShipments: 0,
      customizationNeeded: 0,
      failed: 1,
    };
    const cases = [
      {
        failure: {
          orderNumber: "111-0318024-9415409",
          stage: "notes_update",
          reasonCode: "required_field",
          summary: "Package weight is required.",
          rawShipStationResponse: '{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}',
        },
        expectedFailures: [{
          orderNumber: "111-0318024-9415409",
          stage: "notes_update",
          reasonCode: "required_field",
          summary: "Package weight is required.",
        }],
      },
      {
        failure: {
          orderNumber: "order-fallback-id",
          stage: "notes_update",
          reasonCode: "required_field",
          summary: "Package weight is required.",
        },
        expectedFailures: [],
      },
    ];

    for (const { failure, expectedFailures } of cases) {
      const res = response();
      await createAmazonImportHandler({
        resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
        serviceFactory: () => ({
          prepare: async ({ onProgress }) => ({
            run: async () => onProgress({ ...completion, failures: [failure] }),
            release: vi.fn(),
          }),
        }),
      })({ method: "POST" }, res);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(res.chunks.join(""))));
      const events = [];

      await importAmazonOrders({ onEvent: (event) => events.push(event) });

      expect(events).toEqual([{ ...completion, failures: expectedFailures }]);
      expect(JSON.stringify(events)).not.toContain("PRIVATE SHIPSTATION ERROR");
      expect(JSON.stringify(events)).not.toContain("PRIVATE VALUE");
    }
  });

  it("loads workspace preset and font context for server item enrichment", async () => {
    // Break caught: the API imports Amazon items without workspace-specific preset/font data.
    const loadPresetSnapshot = vi.fn().mockResolvedValue({
      workspaceKey: "workspace-1",
      snapshot: {
        defaultPresetId: "preset-1",
        presets: [{ id: "preset-1", globalDefaults: {}, lineDefaults: { fontId: "candlepin" }, lineRules: [], listingAssignments: [] }],
      },
    });
    const listWorkspaceFonts = vi.fn().mockResolvedValue([
      { id: "skywalk", display_name: "Skywalk" },
    ]);
    const serviceFactory = vi.fn(() => ({
      prepare: async () => ({ run: async () => {}, release: vi.fn() }),
    }));

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory,
      dependencies: { loadPresetSnapshot, listWorkspaceFonts },
    })({ method: "POST" }, response());

    expect(loadPresetSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(listWorkspaceFonts).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    const enriched = serviceFactory.mock.calls[0][0].enrichItem({
      text: "Maria",
      source: { customerFontSelections: [{ lineIndex: 0, name: "Skywalk" }] },
    });
    expect(enriched.settings.lines[0].fontId).toBe("skywalk");
  });

  it.each([
    {
      label: "workspace context loading",
      stage: "context_loading",
      buildOptions(error) {
        return {
          serviceFactory: vi.fn(() => ({ prepare: vi.fn() })),
          dependencies: {
            loadPresetSnapshot: vi.fn().mockRejectedValue(error),
            listWorkspaceFonts: vi.fn().mockResolvedValue([]),
          },
        };
      },
    },
    {
      label: "service construction",
      stage: "preparation",
      buildOptions(error) {
        return { serviceFactory: vi.fn(() => { throw error; }) };
      },
    },
    {
      label: "service preparation",
      stage: "preparation",
      buildOptions(error) {
        return { serviceFactory: vi.fn(() => ({ prepare: vi.fn().mockRejectedValue(error) })) };
      },
    },
  ])("emits one correlated safe run failure for $label failures", async ({ stage, buildOptions }) => {
    // Break caught: failures before run starts have no run correlation or safe global stage.
    const events = [];
    const diagnosticsFactory = recordingDiagnosticsFactory(events);
    const error = Object.assign(new Error("API KEY SECRET"), {
      name: "SecretFailureType",
      code: "secret_failure_code",
      requestId: "secret-request-id",
      stack: "API KEY SECRET STACK",
    });

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-early", userId: "user-1" }),
      diagnosticsFactory,
      randomUUID: vi.fn(() => "run-early"),
      ...buildOptions(error),
    })({ method: "POST" }, response());

    expect(events.filter(({ envelope }) => envelope?.event === "amazon_import.run.failed")).toEqual([{
      level: "error",
      message: "Amazon import diagnostic",
      envelope: {
        event: "amazon_import.run.failed",
        runId: "run-early",
        workspaceId: "workspace-early",
        stage,
        details: {
          errorName: null,
          errorCode: null,
          statusCode: null,
          retryable: null,
          requestId: null,
        },
      },
    }]);
    expect(JSON.stringify(events)).not.toContain("API KEY SECRET");
    expect(JSON.stringify(events)).not.toContain("secret_failure_code");
    expect(JSON.stringify(events)).not.toContain("secret-request-id");
  });

  it("attributes real configuration/client preparation failures to one correlated run", async () => {
    // Break caught: client construction fails after acquiring a lock but before the service can emit run.started.
    const events = [];
    const diagnosticsFactory = recordingDiagnosticsFactory(events);
    const releaseAmazonImportLock = vi.fn().mockResolvedValue(undefined);
    const dependencies = realServiceDependencies({
      client: { iteratePendingShipments: vi.fn(async function* () {}) },
      releaseAmazonImportLock,
    });
    dependencies.createShipStationClient.mockImplementation(() => {
      throw new Error("CLIENT CREDENTIAL SECRET");
    });

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-client", userId: "user-1" }),
      serviceFactory: createAmazonImportService,
      dependencies,
      diagnosticsFactory,
      randomUUID: vi.fn(() => "run-client"),
    })({ method: "POST" }, response());

    const failures = events.filter(({ envelope }) => envelope?.event === "amazon_import.run.failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].envelope).toMatchObject({
      runId: "run-client",
      workspaceId: "workspace-client",
      stage: "preparation",
    });
    expect(releaseAmazonImportLock).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toContain("CLIENT CREDENTIAL SECRET");
  });

  it("authenticates and prepares before flushing headers, then writes ordered NDJSON", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = [];
    const resolveAuth = vi.fn(async () => {
      calls.push("auth");
      return { workspaceId: "workspace-1", userId: "user-1" };
    });
    const release = vi.fn(async () => { calls.push("release"); });
    const serviceFactory = vi.fn(() => ({
      prepare: async ({ onProgress, signal }) => {
        calls.push("prepare");
        expect(signal).not.toBe(abortController.signal);
        expect(signal).toBeInstanceOf(AbortSignal);
        return {
          run: async () => {
            calls.push("run");
            await onProgress({ type: "progress", processed: 0, total: 1 });
            await onProgress({ type: "complete", importedItems: 1 });
          },
          release,
        };
      },
    }));
    const abortController = new AbortController();
    const res = response();
    res.flushHeaders.mockImplementation(() => calls.push("flush"));

    await createAmazonImportHandler({ resolveAuth, serviceFactory })({ method: "POST", signal: abortController.signal }, res);

    expect(calls).toEqual(["auth", "prepare", "flush", "run", "release"]);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    });
    expect(res.chunks).toEqual([
      '{"type":"progress","processed":0,"total":1}\n',
      '{"type":"complete","importedItems":1}\n',
    ]);
    expect(res.ended).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });


  it("logs allowlisted metadata when prepare fails before streaming", async () => {
    const error = new ShipStationError("request_failed", { statusCode: 401, retryable: false, requestId: "req-safe" });
    error.message = "secret body";
    error.stack = "secret stack";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({ prepare: async () => { throw error; } }),
    })({ method: "POST" }, response());

    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", {
      stage: "prepare",
      errorName: "ShipStationError",
      errorCode: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: "req-safe",
      streaming: false,
    });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret body");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret stack");
    consoleError.mockRestore();
  });

  it("logs allowlisted metadata when run fails after streaming starts", async () => {
    const error = new ShipStationError("request_failed", { statusCode: 401, retryable: false, requestId: "secret request id" });
    error.message = "secret body";
    error.stack = "secret stack";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async () => ({ run: async () => { throw error; }, release: vi.fn() }),
      }),
    })({ method: "POST" }, response());

    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", {
      stage: "run",
      errorName: "ShipStationError",
      errorCode: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: null,
      streaming: true,
    });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret body");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret stack");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret request id");
    consoleError.mockRestore();
  });

  it("logs no unverified string metadata from an arbitrary error", async () => {
    const secrets = { body: "secret body", name: "secret-error-name", code: "secret-error-code", requestId: "secret-request-id", stack: "secret stack" };
    const error = Object.assign(new Error(secrets.body), { name: secrets.name, code: secrets.code, requestId: secrets.requestId, stack: secrets.stack, statusCode: 418, retryable: true });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await createAmazonImportHandler({ resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }), serviceFactory: () => ({ prepare: async () => { throw error; } }) })({ method: "POST" }, response());
    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", { stage: "prepare", errorName: null, errorCode: null, statusCode: 418, retryable: true, requestId: null, streaming: false });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
    for (const secret of Object.values(secrets)) expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });

  it("rejects object request IDs from log metadata without coercing them", async () => {
    const error = new ShipStationError("request_failed", { statusCode: 401 });
    error.requestId = { toString: () => "req-safe" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({ prepare: async () => { throw error; } }),
    })({ method: "POST" }, response());

    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", {
      stage: "prepare",
      errorName: "ShipStationError",
      errorCode: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: null,
      streaming: false,
    });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
  });

  it("attributes a real service primary release failure to release", async () => {
    const releaseError = new Error("release API key secret");
    const diagnosticEvents = [];
    const diagnosticsFactory = recordingDiagnosticsFactory(diagnosticEvents);
    const releaseAmazonImportLock = vi.fn()
      .mockRejectedValueOnce(releaseError)
      .mockResolvedValueOnce(undefined);
    const dependencies = realServiceDependencies({
      client: {
        iteratePendingShipments: vi.fn(async function* () {}),
      },
      releaseAmazonImportLock,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: createAmazonImportService,
      dependencies,
      waitUntil: vi.fn(),
      diagnosticsFactory,
      randomUUID: vi.fn(() => "run-release"),
    })({ method: "POST" }, response());

    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", {
      stage: "release",
      errorName: null,
      errorCode: null,
      statusCode: null,
      retryable: null,
      requestId: null,
      streaming: true,
    });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("release API key secret");
    expect(releaseAmazonImportLock).toHaveBeenCalledTimes(2);
    const terminalEvents = diagnosticEvents.filter(({ envelope }) => (
      envelope?.event === "amazon_import.run.completed" || envelope?.event === "amazon_import.run.failed"
    ));
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].envelope).toMatchObject({
      event: "amazon_import.run.failed",
      runId: "run-release",
      workspaceId: "workspace-1",
      stage: "release",
    });
  });

  it("keeps a real service cancellation failure attributed to run while release is pending", async () => {
    const source = new AbortController();
    const iterationStarted = deferred();
    const releasePending = deferred();
    const releaseAmazonImportLock = vi.fn(() => releasePending.promise);
    const dependencies = realServiceDependencies({
      client: {
        iteratePendingShipments: vi.fn(({ signal }) => ({
          [Symbol.asyncIterator]() { return this; },
          next: () => new Promise((_resolve, reject) => {
            iterationStarted.resolve();
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
        })),
      },
      releaseAmazonImportLock,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: createAmazonImportService,
      dependencies,
      waitUntil: vi.fn(),
    })({ method: "POST", signal: source.signal }, response());

    await iterationStarted.promise;
    source.abort();
    await vi.waitFor(() => expect(releaseAmazonImportLock).toHaveBeenCalledOnce());
    releasePending.resolve();
    await pending;

    expect(consoleError).toHaveBeenCalledWith("Amazon import API error", {
      stage: "run",
      errorName: null,
      errorCode: null,
      statusCode: null,
      retryable: null,
      requestId: null,
      streaming: true,
    });
    expect(consoleError.mock.calls.filter(([message]) => message === "Amazon import API error")).toHaveLength(1);
    expect(releaseAmazonImportLock).toHaveBeenCalledOnce();
  });

  it("omits notes and URLs from streamed progress frames", async () => {
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async ({ onProgress }) => ({
          run: async () => onProgress({
            type: "progress",
            stage: "https://zme-caps.amazon.com/private-archive",
            processed: 1,
            total: 1,
            note: "Sensitive customization",
          }),
          release: vi.fn(),
        }),
      }),
    })({ method: "POST" }, res);

    expect(res.chunks).toEqual(['{"type":"progress","processed":1,"total":1}\n']);
  });

  it("accepts POST only without attempting authentication", async () => {
    const resolveAuth = vi.fn();
    const res = response();

    await createAmazonImportHandler({ resolveAuth })({ method: "GET" }, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers).toMatchObject({ "Cache-Control": "no-store", Allow: "POST" });
    expect(res.body).toEqual({ error: "Method not allowed." });
    expect(resolveAuth).not.toHaveBeenCalled();
  });

  it("returns only a safe domain error before streaming", async () => {
    const secret = "shipstation-key-secret";
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockRejectedValue(Object.assign(new Error(secret), { statusCode: 500, code: secret })),
    })({ method: "POST" }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Unable to import Amazon orders." });
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it("maps domain failures to fixed safe messages before streaming", async () => {
    const secret = "ShipStation note: Sensitive customization";
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async () => { throw new AmazonImportError("import_lock_lost", secret, 409); },
      }),
    })({ method: "POST" }, res);

    expect(res).toMatchObject({ statusCode: 409, body: { code: "import_lock_lost", error: "The Amazon import lease was lost. Please retry." } });
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
  it("returns exposed authentication errors before streaming", async () => {
    const res = response();
    const authError = Object.assign(new Error("Authentication required."), { statusCode: 401, expose: true });

    await createAmazonImportHandler({ resolveAuth: vi.fn().mockRejectedValue(authError) })({ method: "POST" }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required." });
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it("maps exposed auth-shaped secrets to a fixed public response", async () => {
    const secret = "https://signed.example/archive?api_key=secret note=Sensitive body=raw";
    const res = response();
    const unsafe = Object.assign(new Error(secret), { statusCode: 401, expose: true, code: "upstream" });

    await createAmazonImportHandler({ resolveAuth: vi.fn().mockRejectedValue(unsafe) })({ method: "POST" }, res);

    expect(res).toMatchObject({ statusCode: 401, body: { error: "Authentication required." } });
    expect(JSON.stringify(res.body)).not.toContain("signed.example");
    expect(JSON.stringify(res.body)).not.toContain("api_key");
    expect(JSON.stringify(res.body)).not.toContain("Sensitive");

    expect(JSON.stringify(res.body)).not.toContain("raw");
  });
  it("writes one safe fallback error frame and releases when a run fails", async () => {
    const secret = "https://zme-caps.amazon.com/archive?key=do-not-leak";
    const release = vi.fn();
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async () => ({
          run: async () => { throw Object.assign(new Error(secret), { code: "raw-failure" }); },
          release,
        }),
      }),
    })({ method: "POST" }, res);

    expect(res.chunks).toEqual([
      '{"type":"error","code":"import_failed","message":"Unable to import Amazon orders."}\n',
    ]);
    expect(res.chunks.join("")).not.toContain(secret);
    expect(release).toHaveBeenCalledOnce();
    expect(res.ended).toBe(true);
  });

  it("releases when a disconnected client rejects a progress frame without exposing notes", async () => {
    const release = vi.fn();
    const res = response();
    res.write = vi.fn(() => { throw new Error("socket closed with note Sensitive customization"); });

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async ({ onProgress }) => ({
          run: async () => onProgress({ type: "progress", note: "Sensitive customization" }),
          release,
        }),
      }),
    })({ method: "POST" }, res);

    expect(release).toHaveBeenCalledOnce();
    expect(res.write).toHaveBeenCalledOnce();
    expect(res.chunks.join("")).not.toContain("Sensitive customization");
    expect(res.ended).not.toBe(true);
  });

  it("bridges Web request cancellation into the service signal and releases", async () => {
    const source = new AbortController();
    const release = vi.fn();
    let serviceSignal;
    let started;
    const runStarted = new Promise((resolve) => { started = resolve; });
    const res = response();
    const request = { method: "POST", signal: source.signal };

    const pending = createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async ({ signal }) => {
          serviceSignal = signal;
          return {
            run: async () => new Promise((resolve, reject) => {
              started();
              signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            }),
            release,
          };
        },
      }),
      waitUntil: vi.fn(),
    })(request, res);

    await runStarted;
    source.abort();
    await pending;

    expect(serviceSignal).not.toBe(source.signal);
    expect(serviceSignal.aborted).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("bridges legacy aborted request errors and removes its listener", async () => {
    const source = new AbortController();
    const request = new EventEmitter();
    const fallbackErrorListener = () => {};
    request.on("error", fallbackErrorListener);
    request.method = "POST";
    request.signal = source.signal;
    const release = vi.fn();
    const waitUntil = vi.fn();
    let serviceSignal;
    let started;
    const runStarted = new Promise((resolve) => { started = resolve; });

    const pending = createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async ({ signal }) => {
          serviceSignal = signal;
          return {
            run: async () => new Promise((resolve, reject) => {
              started();
              signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            }),
            release,
          };
        },
      }),
      waitUntil,
    })(request, response());

    await runStarted;
    request.emit("error", new Error("aborted"));
    await Promise.resolve();
    const abortedByLegacyError = serviceSignal.aborted;
    source.abort();
    await pending;

    expect(abortedByLegacyError).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(request.listenerCount("error")).toBe(1);
    expect(request.listeners("error")).toEqual([fallbackErrorListener]);
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("protects prepare cleanup when cancellation arrives before a release handle", async () => {
    const source = new AbortController();
    const waitUntil = vi.fn();
    let rejectPrepare;
    let started;
    const prepareStarted = new Promise((resolve) => { started = resolve; });

    const pending = createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: () => new Promise((resolve, reject) => {
          rejectPrepare = reject;
          started();
        }),
      }),
      waitUntil,
    })({ method: "POST", signal: source.signal }, response());

    await prepareStarted;
    source.abort();
    await Promise.resolve();
    const registrationsAtCancellation = waitUntil.mock.calls.length;
    rejectPrepare(new DOMException("Aborted", "AbortError"));
    await pending;

    expect(registrationsAtCancellation).toBe(1);
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("registers the memoized release promise with the function lifecycle", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async () => ({ run: async () => {}, release }),
      }),
      waitUntil,
    })({ method: "POST" }, response());

    expect(release).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("writes a safe error frame when release fails after a successful run", async () => {
    const release = vi.fn().mockRejectedValue(new Error("release API key secret"));
    const res = response();

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory: () => ({
        prepare: async () => ({ run: async () => {}, release }),
      }),
    })({ method: "POST" }, res);

    expect(release).toHaveBeenCalledOnce();
    expect(res.chunks).toEqual([
      '{"type":"error","code":"import_failed","message":"Unable to import Amazon orders."}\n',
    ]);
    expect(res.chunks.join("")).not.toContain("secret");

    expect(res.ended).toBe(true);
  });

  it("passes the exact Amazon service dependencies to its factory", async () => {
    const dependencies = {
      store: { marker: "store" },
      createShipStationClient: vi.fn(),
      fetchCustomizationJson: vi.fn(),
      normalizeItem: vi.fn(),
      appendNoteBlocks: vi.fn(),
    };
    const serviceFactory = vi.fn(() => ({
      prepare: async () => ({ run: async () => {}, release: vi.fn() }),
    }));

    await createAmazonImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory,
      dependencies,
    })({ method: "POST" }, response());

    expect(serviceFactory).toHaveBeenCalledWith(expect.objectContaining(dependencies));
  });
});
