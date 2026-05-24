import { afterEach, describe, expect, it, vi } from "vitest";

import { savePresetDefinition } from "../../src/preset-api.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preset api client", () => {
  it("uses post for new presets, put for updates, and surfaces server errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
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

    await savePresetDefinition({
      preset: { id: "new-preset", name: "New Preset" },
    });
    await savePresetDefinition({
      preset: { id: "renamed-preset", name: "Renamed Preset" },
      previousId: "old-preset",
    });

    await expect(savePresetDefinition({
      preset: { id: "bad-preset", name: "Bad Preset" },
    })).rejects.toThrow("Server said no.");

    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
  });
});
