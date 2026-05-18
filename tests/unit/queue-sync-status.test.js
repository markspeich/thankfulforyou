import { describe, expect, it } from "vitest";

import { buildQueueSyncStatus } from "../../src/queue-sync-status.js";

describe("queue sync status", () => {
  it("describes a queue that only exists in browser storage", () => {
    expect(buildQueueSyncStatus("local-only", { count: 2 })).toEqual({
      tone: "warning",
      label: "Saved in this browser",
      detail: "2 designs are stored locally. Click Save to sync this batch to Neon.",
    });
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

  it("describes an empty queue", () => {
    expect(buildQueueSyncStatus("empty")).toEqual({
      tone: "pending",
      label: "No saved batch",
      detail: "Drafts stay in this browser until you save a queue to Neon.",
    });
  });
});
