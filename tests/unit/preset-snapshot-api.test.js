import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPresetSnapshotMock = vi.fn();
const savePresetSnapshotMock = vi.fn();

vi.mock("../../api/_lib/preset-store.js", () => ({
  loadPresetSnapshot: loadPresetSnapshotMock,
  savePresetSnapshot: savePresetSnapshotMock,
}));

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  loadPresetSnapshotMock.mockReset();
  savePresetSnapshotMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preset snapshot api", () => {
  it("returns 404 when no remote preset snapshot exists", async () => {
    loadPresetSnapshotMock.mockResolvedValue(null);
    const { default: handler } = await import("../../api/preset-snapshot.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", query: { workspaceKey: "primary" } }, response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: "Preset snapshot not found." });
  });

  it("validates put payloads before saving", async () => {
    const { default: handler } = await import("../../api/preset-snapshot.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        workspaceKey: "primary",
        snapshot: { version: 1, presets: [] },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "snapshot.version, snapshot.defaultPresetId, and snapshot.presets are required." });
  });

  it("saves valid preset snapshots", async () => {
    const snapshot = {
      version: 1,
      defaultPresetId: "preset-a1f4c8e2b601",
      presets: [{ id: "preset-a1f4c8e2b601", name: "All Candlepin" }],
    };
    savePresetSnapshotMock.mockResolvedValue({
      workspaceKey: "primary",
      snapshot,
      updatedAt: "2026-05-25T00:00:00.000Z",
    });
    const { default: handler } = await import("../../api/preset-snapshot.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        workspaceKey: "primary",
        snapshot,
      },
    }, response);

    expect(savePresetSnapshotMock).toHaveBeenCalledWith("primary", snapshot);
    expect(response.statusCode).toBe(200);
    expect(response.body.snapshot).toEqual(snapshot);
  });
});
