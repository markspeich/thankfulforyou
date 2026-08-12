import { describe, expect, it, vi } from "vitest";
import { createEtsyImportHandler } from "../../api/etsy-import.js";
function response() { return { headers: {}, chunks: [], status(v) { this.statusCode = v; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(v) { this.body = v; }, write(v) { this.chunks.push(v); }, end() { this.ended = true; }, flushHeaders: vi.fn() }; }
describe("Etsy import API", () => {
  it("loads workspace fonts and the preset snapshot to enrich Etsy imports", async () => {
    const enrichItem = vi.fn((item) => item);
    const itemEnricherFactory = vi.fn(() => enrichItem);
    const serviceFactory = vi.fn(({ enrichItem: serviceEnricher }) => ({
      prepare: async ({ onProgress }) => ({
        run: async () => onProgress({ type: "complete", imported: 0 }),
        release: vi.fn(),
      }),
    }));
    const loadPresetSnapshot = vi.fn().mockResolvedValue({
      snapshot: { defaultPresetId: "preset-1", presets: [{ id: "preset-1" }] },
    });
    const listWorkspaceFonts = vi.fn().mockResolvedValue([
      { id: "font-skywalk", display_name: "Skywalk" },
    ]);

    await createEtsyImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" }),
      serviceFactory,
      itemEnricherFactory,
      dependencies: { loadPresetSnapshot, listWorkspaceFonts },
    })({ method: "POST" }, response());

    expect(loadPresetSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(listWorkspaceFonts).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(itemEnricherFactory).toHaveBeenCalledWith({
      presetSnapshot: { defaultPresetId: "preset-1", presets: [{ id: "preset-1" }] },
      fontOptions: [{ id: "font-skywalk", displayName: "Skywalk", label: undefined }],
    });
    expect(serviceFactory).toHaveBeenCalledWith(expect.objectContaining({ enrichItem }));
  });

  it("authenticates before streaming and writes newline-delimited progress", async () => {
    const order = []; const auth = vi.fn(async () => { order.push("auth"); return { workspaceId: "w", userId: "u" }; });
    const serviceFactory = () => ({ prepare: vi.fn(async ({ onProgress }) => { order.push("prepare"); return { run: async () => { onProgress({ type: "complete", imported: 0 }); }, release: vi.fn() }; }) });
    const res = response(); await createEtsyImportHandler({ resolveAuth: auth, serviceFactory, dependencies: { loadPresetSnapshot: vi.fn().mockResolvedValue({ presets: [] }) } })({ method: "POST" }, res);
    expect(order).toEqual(["auth", "prepare"]); expect(res.headers["Content-Type"]).toBe("application/x-ndjson; charset=utf-8"); expect(res.headers["Cache-Control"]).toBe("no-store"); expect(res.flushHeaders).toHaveBeenCalled(); expect(res.chunks).toEqual([JSON.stringify({ type: "complete", imported: 0 }) + "\n"]);
  });
  it("returns auth and lock conflicts as JSON before headers", async () => {
    const authError = Object.assign(new Error("Authentication required."), { statusCode: 401, expose: true });
    let res = response(); await createEtsyImportHandler({ resolveAuth: vi.fn().mockRejectedValue(authError) })({ method: "POST" }, res);
    expect(res.statusCode).toBe(401); expect(res.flushHeaders).not.toHaveBeenCalled(); expect(res.headers["Cache-Control"]).toBe("no-store");
    res = response(); const conflict = Object.assign(new Error("busy"), { statusCode: 409, code: "import_in_progress" });
    await createEtsyImportHandler({ resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "w" }), serviceFactory: () => ({ prepare: vi.fn().mockRejectedValue(conflict) }), dependencies: { loadPresetSnapshot: vi.fn().mockResolvedValue({}) } })({ method: "POST" }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("import_in_progress");
  });
  it("returns a safe streamed error and supports POST only", async () => {
    const secret = "token-secret"; const res = response();
    await createEtsyImportHandler({ resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "w" }), serviceFactory: () => ({ prepare: async () => ({ run: async () => { throw Object.assign(new Error(secret), { code: "temporary" }); }, release: vi.fn() }) }), dependencies: { loadPresetSnapshot: vi.fn().mockResolvedValue({}) } })({ method: "POST" }, res);
    expect(res.chunks.join("")).not.toContain(secret); expect(JSON.parse(res.chunks[0])).toEqual({ type: "error", code: "temporary", message: "Unable to import Etsy orders." });
    const method = response(); await createEtsyImportHandler()({ method: "GET" }, method); expect(method.statusCode).toBe(405); expect(method.headers.Allow).toBe("POST");
  });
  it("fails safely before preparing an import when no-store header setup fails", async () => {
    const release = vi.fn(); const res = response();
    res.setHeader = vi.fn(() => { throw new Error("header"); });
    await createEtsyImportHandler({ resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "w" }), serviceFactory: () => ({ prepare: async () => ({ run: vi.fn(), release }) }), dependencies: { loadPresetSnapshot: vi.fn().mockResolvedValue({}) } })({ method: "POST" }, res);
    expect(release).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
  it("releases the lock and swallows transport failure when progress and error-frame writes fail", async () => {
    const release = vi.fn();
    const res = response();
    res.write = vi.fn(() => { throw new Error("socket closed"); });
    const serviceFactory = () => ({
      prepare: async ({ onProgress }) => ({
        run: async () => { await onProgress({ type: "progress", processed: 1, total: 2 }); },
        release,
      }),
    });

    await createEtsyImportHandler({
      resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "w" }),
      serviceFactory,
      dependencies: { loadPresetSnapshot: vi.fn().mockResolvedValue({}) },
    })({ method: "POST" }, res);
    expect(release).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledTimes(2);
  });
});
