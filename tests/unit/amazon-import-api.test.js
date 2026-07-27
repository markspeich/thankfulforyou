import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAmazonImportHandler } from "../../api/amazon-import.js";
import { AmazonImportError } from "../../api/_lib/amazon-import-service.js";

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

describe("Amazon import API", () => {
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
    const error = Object.assign(new Error("secret body"), {
      name: "ShipStationError",
      code: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: "req-safe",
      stack: "secret stack",
    });
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
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret body");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret stack");
    consoleError.mockRestore();
  });

  it("logs allowlisted metadata when run fails after streaming starts", async () => {
    const error = Object.assign(new Error("secret body"), {
      name: "ShipStationError",
      code: "request_failed",
      statusCode: 401,
      retryable: false,
      requestId: "req-safe",
      stack: "secret stack",
    });
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
      requestId: "req-safe",
      streaming: true,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret body");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret stack");
    consoleError.mockRestore();
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
