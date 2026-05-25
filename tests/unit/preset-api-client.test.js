import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRemotePresetSnapshot, savePresetSnapshot } from "../../src/preset-api.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preset api client", () => {
  it("loads remote preset snapshots, saves them with put, and surfaces server errors", async () => {
    const snapshot = {
      version: 1,
      defaultPresetId: "preset-a1f4c8e2b601",
      presets: [{ id: "preset-a1f4c8e2b601", name: "All Candlepin" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snapshot }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server said no." }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRemotePresetSnapshot()).resolves.toEqual(snapshot);
    await savePresetSnapshot(snapshot);

    await expect(savePresetSnapshot(snapshot)).rejects.toThrow("Server said no.");

    expect(fetchMock.mock.calls[0][1].headers.Accept).toContain("application/json");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
  });
});
