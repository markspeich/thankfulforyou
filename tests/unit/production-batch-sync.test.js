import { describe, expect, it } from "vitest";

import {
  buildRemoteBatchPayload,
  chooseInitialBatchSnapshot,
  isBatchSnapshotEmpty,
} from "../../src/production-batch-sync.js";

describe("production batch sync helpers", () => {
  it("preserves the remote payload contract and full snapshot shape", () => {
    const snapshot = {
      version: 1,
      orderSequence: 3,
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderItemId: "order-2",
      orderItems: [
        {
          id: "order-1",
          revision: 2,
          text: "Mark",
        },
      ],
    };

    expect(buildRemoteBatchPayload(snapshot)).toEqual({
      workspaceKey: "primary",
      snapshot,
    });
  });

  it("uses the remote startup snapshot", () => {
    const localSnapshot = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderItemId: "local-1",
      orderItems: [{ id: "local-1", revision: 2 }],
    };
    const remoteSnapshot = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderItemId: "remote-1",
      orderItems: [{ id: "remote-1", revision: 3 }],
    };

    expect(chooseInitialBatchSnapshot({
      localSnapshot,
      remoteSnapshot,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
    });
  });

  it("maps local-cache startup back to local for existing startup callers", () => {
    const localSnapshot = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderItemId: "local-1",
      orderItems: [{ id: "local-1", revision: 2 }],
    };

    expect(chooseInitialBatchSnapshot({
      localSnapshot,
      remoteSnapshot: null,
    })).toEqual({
      source: "local",
      snapshot: localSnapshot,
    });
  });

  it("treats a batch snapshot with no orders as empty", () => {
    expect(isBatchSnapshotEmpty(null)).toBe(true);
    expect(isBatchSnapshotEmpty({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: null,
      orderItems: [],
    })).toBe(true);
    expect(isBatchSnapshotEmpty({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1" }],
    })).toBe(false);
  });
});
