import { describe, expect, it } from "vitest";

import {
  chooseProductionBatchStartupState,
  createProductionBatchSnapshot,
  getNextRevision,
} from "../../src/production-batch-model.js";

describe("production batch model", () => {
  it("prefers remote snapshot when it exists", () => {
    const remoteSnapshot = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T21:00:00.000Z",
      },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 3 }],
    };
    const localCache = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseProductionBatchStartupState({
      remoteSnapshot,
      localCache,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
    });
  });

  it("falls back to local cache only when no remote batch exists", () => {
    const localCache = {
      batch: {
        id: "batch-1",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseProductionBatchStartupState({
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

  it("returns batch metadata, activeOrderItemId, and orders unchanged", () => {
    expect(createProductionBatchSnapshot({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    })).toEqual({
      batch: { id: "batch-1", workspaceId: "workspace-1" },
      activeOrderItemId: "order-1",
      orderItems: [{ id: "order-1", revision: 1 }],
    });
  });
});
