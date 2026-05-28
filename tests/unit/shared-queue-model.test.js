import { describe, expect, it } from "vitest";

import {
  chooseSharedQueueStartupState,
  createSharedQueueSnapshot,
  getNextRevision,
} from "../../src/shared-queue-model.js";

describe("shared queue model", () => {
  it("prefers remote snapshot when it exists", () => {
    const remoteSnapshot = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 3 }],
    };
    const localCache = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseSharedQueueStartupState({
      remoteSnapshot,
      localCache,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
    });
  });

  it("falls back to local cache only when no remote queue exists", () => {
    const localCache = {
      queue: {
        id: "queue-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseSharedQueueStartupState({
      remoteSnapshot: null,
      localCache,
    })).toEqual({
      source: "local-cache",
      snapshot: localCache,
    });
  });

  it("returns 1 for null and increments an existing revision", () => {
    expect(getNextRevision(null)).toBe(1);
    expect(getNextRevision({ revision: 4 })).toBe(5);
  });

  it("returns queue metadata, activeOrderId, and orders unchanged", () => {
    expect(createSharedQueueSnapshot({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 1 }],
    })).toEqual({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 1 }],
    });
  });
});
