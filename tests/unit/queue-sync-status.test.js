import { describe, expect, it } from "vitest";

import { buildQueueSyncStatus } from "../../src/queue-sync-status.js";

describe("queue sync status", () => {
  it("suppresses a queue that only exists in browser storage", () => {
    expect(buildQueueSyncStatus("local-only", { count: 2 })).toBeNull();
  });

  it("suppresses a queue restored from browser storage", () => {
    expect(buildQueueSyncStatus("restored-local", { count: 2 })).toBeNull();
  });

  it("describes a queue restored from Neon", () => {
    expect(buildQueueSyncStatus("restored-remote", { count: 1 })).toEqual({
      tone: "ok",
      label: "Restored from Neon",
      detail: "1 design was loaded from the remote saved batch.",
    });
  });

  it("describes a queue saved to Neon", () => {
    expect(buildQueueSyncStatus("saved-remote", { count: 3 })).toEqual({
      tone: "ok",
      label: "Saved to Neon",
      detail: "3 designs are synced to the remote saved batch.",
    });
  });

  it("suppresses an empty queue notice", () => {
    expect(buildQueueSyncStatus("empty")).toBeNull();
  });
});
