import { describe, expect, it } from "vitest";

import {
  buildRemoteQueuePayload,
  chooseInitialQueueSnapshot,
  isQueueSnapshotEmpty,
} from "../../src/queue-sync.js";

describe("queue sync helpers", () => {
  it("wraps the existing persisted queue snapshot without reshaping it", () => {
    const snapshot = {
      version: 1,
      orderSequence: 3,
      activeOrderId: "order-2",
      orders: [
        {
          id: "order-1",
          text: "Mark",
          status: "in-progress",
          settings: {
            text: "Mark",
            presetId: "preset-a1f4c8e2b601",
            backingMm: 2.2,
            weldExportedDesign: true,
            lines: [],
          },
          source: null,
          cachedBuild: null,
          previousCompletedBuild: null,
          savedSettingsSignature: null,
          completedSettingsSignature: null,
          analysisBadge: null,
          pendingAnalysisSignature: null,
        },
      ],
    };

    expect(buildRemoteQueuePayload(snapshot)).toEqual({
      workspaceKey: "primary",
      snapshot,
    });
  });

  it("prefers local browser state over remote state at startup", () => {
    const localSnapshot = {
      version: 1,
      orderSequence: 2,
      activeOrderId: "local-1",
      orders: [{ id: "local-1" }],
    };
    const remoteSnapshot = {
      version: 1,
      orderSequence: 4,
      activeOrderId: "remote-1",
      orders: [{ id: "remote-1" }],
    };

    expect(chooseInitialQueueSnapshot({
      localSnapshot,
      remoteSnapshot,
    })).toEqual({
      source: "local",
      snapshot: localSnapshot,
    });
  });

  it("falls back to remote state when the browser has no saved queue", () => {
    const remoteSnapshot = {
      version: 1,
      orderSequence: 4,
      activeOrderId: "remote-1",
      orders: [{ id: "remote-1" }],
    };

    expect(chooseInitialQueueSnapshot({
      localSnapshot: null,
      remoteSnapshot,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
    });
  });

  it("treats a queue snapshot with no orders as empty", () => {
    expect(isQueueSnapshotEmpty(null)).toBe(true);
    expect(isQueueSnapshotEmpty({
      version: 1,
      orderSequence: 1,
      activeOrderId: null,
      orders: [],
    })).toBe(true);
    expect(isQueueSnapshotEmpty({
      version: 1,
      orderSequence: 1,
      activeOrderId: "order-1",
      orders: [{ id: "order-1" }],
    })).toBe(false);
  });
});
