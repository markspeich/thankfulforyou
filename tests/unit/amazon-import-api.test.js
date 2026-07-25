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
    const calls = [];
    const resolveAuth = vi.fn(async () => {
      calls.push("auth");
      return { workspaceId: "workspace-1", userId: "user-1" };
    });
    const release = vi.fn(async () => { calls.push("release"); });
    const serviceFactory = vi.fn(() => ({
      prepare: async ({ onProgress, signal }) => {
        calls.push("prepare");
        expect(signal).toBe(abortController.signal);
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
