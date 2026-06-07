import { describe, expect, it } from "vitest";

import {
  normalizeFixedDesignRecord,
  normalizeFixedDesignRecords,
  resolveFixedDesignReference,
} from "../../src/fixed-designs.js";

describe("fixed design client model", () => {
  it("normalizes fixed design API rows into camelCase UI records", () => {
    expect(normalizeFixedDesignRecord({
      id: "nurse-cross",
      workspace_id: "workspace-1",
      display_name: "Nurse Cross",
      storage_bucket: "workspace-fixed-designs",
      storage_path: "workspaces/workspace-1/fixed-designs/nurse-cross/v3/nurse-cross.svg",
      public_url: "https://example.test/nurse-cross.svg",
      file_name: "nurse-cross.svg",
      version: 3,
      metadata_json: { viewBox: "0 0 100 100" },
      deleted_at: null,
      created_at: "2026-06-06T15:00:00.000Z",
      updated_at: "2026-06-06T16:00:00.000Z",
    })).toEqual({
      id: "nurse-cross",
      workspaceId: "workspace-1",
      displayName: "Nurse Cross",
      storageBucket: "workspace-fixed-designs",
      storagePath: "workspaces/workspace-1/fixed-designs/nurse-cross/v3/nurse-cross.svg",
      publicUrl: "https://example.test/nurse-cross.svg",
      fileName: "nurse-cross.svg",
      version: 3,
      metadata: { viewBox: "0 0 100 100" },
      deletedAt: null,
      createdAt: "2026-06-06T15:00:00.000Z",
      updatedAt: "2026-06-06T16:00:00.000Z",
      isDeleted: false,
      state: "active",
      stateLabel: "Available",
    });
  });

  it("preserves deleted and missing state labels for saved fixed design references", () => {
    const records = normalizeFixedDesignRecords([
      {
        id: "old-heart",
        display_name: "Old Heart",
        version: 2,
        public_url: "https://example.test/old-heart.svg",
        deleted_at: "2026-06-06T17:00:00.000Z",
      },
    ]);

    expect(records[0]).toMatchObject({
      id: "old-heart",
      displayName: "Old Heart",
      isDeleted: true,
      state: "deleted",
      stateLabel: "Deleted",
    });
    expect(resolveFixedDesignReference({
      fixedDesignId: "old-heart",
      fixedDesignName: "Old Heart",
      fixedDesignVersion: 2,
    }, records)).toMatchObject({
      id: "old-heart",
      displayName: "Old Heart",
      state: "deleted",
      stateLabel: "Deleted",
    });
    expect(resolveFixedDesignReference({
      fixedDesignId: "missing-shape",
      fixedDesignName: "Missing Shape",
      fixedDesignVersion: 5,
    }, records)).toMatchObject({
      id: "missing-shape",
      displayName: "Missing Shape",
      version: 5,
      state: "missing",
      stateLabel: "Missing",
      isDeleted: false,
    });
  });
});
