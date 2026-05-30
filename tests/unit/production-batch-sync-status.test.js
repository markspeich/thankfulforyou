import { describe, expect, it } from "vitest";

import { buildBatchSyncStatus } from "../../src/production-batch-sync-status.js";

describe("production batch sync status", () => {
  it("describes a production batch restored from Supabase", () => {
    expect(buildBatchSyncStatus("restored-remote", { count: 1 })).toEqual({
      tone: "ok",
      label: "Production batch loaded",
      detail: "1 design was loaded from Supabase.",
    });
  });

  it("describes a production batch saved to Supabase", () => {
    expect(buildBatchSyncStatus("saved-remote", { count: 3 })).toEqual({
      tone: "ok",
      label: "Production batch saved",
      detail: "3 designs were saved to Supabase.",
    });
  });

  it("suppresses an empty batch notice", () => {
    expect(buildBatchSyncStatus("empty")).toBeNull();
  });
});
