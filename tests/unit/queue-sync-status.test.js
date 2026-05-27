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
      label: "Shared queue loaded",
      detail: "1 design was loaded from the shared queue.",
    });
  });

  it("describes a queue saved to Neon", () => {
    expect(buildQueueSyncStatus("saved-remote", { count: 3 })).toEqual({
      tone: "ok",
      label: "Shared queue saved",
      detail: "3 designs were saved to the shared queue.",
    });
  });

  it("describes local recovery mode when shared sync is unavailable", () => {
    expect(buildQueueSyncStatus("local-recovery", { count: 2 })).toEqual({
      tone: "warning",
      label: "Local recovery only",
      detail: "Shared queue sync is unavailable. 2 designs are being kept only in this browser for recovery.",
    });
  });

  it("suppresses an empty queue notice", () => {
    expect(buildQueueSyncStatus("empty")).toBeNull();
  });
});
