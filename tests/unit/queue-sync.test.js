import { describe, expect, it } from "vitest";

import {
  buildRemoteQueuePayload,
  chooseInitialQueueSnapshot,
  isQueueSnapshotEmpty,
} from "../../src/queue-sync.js";

describe("queue sync helpers", () => {
  it("preserves the legacy remote payload contract and full snapshot shape", () => {
    const snapshot = {
      version: 1,
      orderSequence: 3,
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderId: "order-2",
      orders: [
        {
          id: "order-1",
          revision: 2,
          text: "Mark",
        },
      ],
    };

    expect(buildRemoteQueuePayload(snapshot)).toEqual({
      workspaceKey: "primary",
      snapshot,
    });
  });

  it("uses the remote startup snapshot", () => {
    const localSnapshot = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderId: "local-1",
      orders: [{ id: "local-1", revision: 2 }],
    };
    const remoteSnapshot = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderId: "remote-1",
      orders: [{ id: "remote-1", revision: 3 }],
    };

    expect(chooseInitialQueueSnapshot({
      localSnapshot,
      remoteSnapshot,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
    });
  });

  it("maps local-cache startup back to local for legacy callers", () => {
    const localSnapshot = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderId: "local-1",
      orders: [{ id: "local-1", revision: 2 }],
    };

    expect(chooseInitialQueueSnapshot({
      localSnapshot,
      remoteSnapshot: null,
    })).toEqual({
      source: "local",
      snapshot: localSnapshot,
    });
  });

  it("treats a queue snapshot with no orders as empty", () => {
    expect(isQueueSnapshotEmpty(null)).toBe(true);
    expect(isQueueSnapshotEmpty({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: null,
      orders: [],
    })).toBe(true);
    expect(isQueueSnapshotEmpty({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1" }],
    })).toBe(false);
  });
});
