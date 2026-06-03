import { describe, expect, it } from "vitest";

import {
  getCheckedOrderIdsForBulkAction,
  getCopyableSavedBuild,
  getSelectedGroupedOrder,
  normalizeOrdersWorkspaceState,
} from "../../src/orders-workspace.js";

describe("orders workspace helpers", () => {
  it("normalizes grouped order payloads and preserves selected and checked ids when possible", () => {
    const selectedOrder = { id: "order:1002", buyerName: "Grace" };
    const result = normalizeOrdersWorkspaceState({
      payload: {
        orders: [
          { id: "order:1001", buyerName: "Ada" },
          selectedOrder,
          { id: "   ", buyerName: "Missing" },
          { id: 1003, buyerName: "Invalid" },
          null,
        ],
      },
      selectedOrderId: "order:1002",
      checkedOrderIds: ["order:1001", "order:missing", "order:1002"],
    });

    expect(result.orders).toEqual([
      { id: "order:1001", buyerName: "Ada" },
      selectedOrder,
    ]);
    expect(result.selectedOrderId).toBe("order:1002");
    expect(result.checkedOrderIds).toBeInstanceOf(Set);
    expect([...result.checkedOrderIds]).toEqual(["order:1001", "order:1002"]);
  });

  it("returns checked order ids as a set with only current order ids", () => {
    const result = normalizeOrdersWorkspaceState({
      payload: {
        orders: [
          { id: "order:1501", buyerName: "Ada" },
          { id: "order:1502", buyerName: "Grace" },
        ],
      },
      selectedOrderId: "order:1501",
      checkedOrderIds: ["order:1501", "order:1501", "order:missing", "order:1502"],
    });

    expect(result).toMatchObject({
      orders: [
        { id: "order:1501", buyerName: "Ada" },
        { id: "order:1502", buyerName: "Grace" },
      ],
      selectedOrderId: "order:1501",
    });
    expect(result.checkedOrderIds).toBeInstanceOf(Set);
    expect([...result.checkedOrderIds]).toEqual(["order:1501", "order:1502"]);
  });

  it("selects the first order when selection is missing and drops stale checked ids", () => {
    const result = normalizeOrdersWorkspaceState({
      payload: {
        orders: [
          { id: "order:2001", buyerName: "Ada" },
          { id: "order:2002", buyerName: "Grace" },
        ],
      },
      selectedOrderId: "order:missing",
      checkedOrderIds: new Set(["order:missing", "order:2002"]),
    });

    expect(result.selectedOrderId).toBe("order:2001");
    expect(result.checkedOrderIds).toBeInstanceOf(Set);
    expect([...result.checkedOrderIds]).toEqual(["order:2002"]);
  });

  it("returns null selection and no checked ids when the payload has no valid orders", () => {
    const result = normalizeOrdersWorkspaceState({
      payload: { orders: [{ id: "" }, { id: 42 }] },
      selectedOrderId: "order:missing",
      checkedOrderIds: ["order:missing"],
    });

    expect(result.orders).toEqual([]);
    expect(result.selectedOrderId).toBeNull();
    expect(result.checkedOrderIds).toBeInstanceOf(Set);
    expect([...result.checkedOrderIds]).toEqual([]);
  });

  it("selects the requested grouped order or falls back to the first order", () => {
    const orders = [
      { id: "order:3001", buyerName: "Ada" },
      { id: "order:3002", buyerName: "Grace" },
    ];

    expect(getSelectedGroupedOrder(orders, "order:3002")).toBe(orders[1]);
    expect(getSelectedGroupedOrder(orders, "order:missing")).toBe(orders[0]);
    expect(getSelectedGroupedOrder([], "order:missing")).toBeNull();
  });

  it("returns checked ids for bulk add", () => {
    expect(getCheckedOrderIdsForBulkAction(new Set(["order:4001", "", "order:4002"]))).toEqual([
      "order:4001",
      "order:4002",
    ]);
    expect(getCheckedOrderIdsForBulkAction(["order:4003", 42, "order:4004"])).toEqual([
      "order:4003",
      "order:4004",
    ]);
  });

  it("detects copyable saved builds from cachedBuild or previousCompletedBuild", () => {
    const cachedBuild = {
      signature: "completed-signature",
      layout: { svg: "<svg data-current></svg>" },
      analysis: { connectedComponentCount: 1 },
    };
    const previousCompletedBuild = {
      signature: "previous-signature",
      layout: { svg: "<svg data-previous></svg>" },
      analysis: { connectedComponentCount: 2 },
    };

    expect(getCopyableSavedBuild({
      completedSettingsSignature: "completed-signature",
      cachedBuild,
      previousCompletedBuild,
    })).toEqual(cachedBuild);

    expect(getCopyableSavedBuild({
      completedSettingsSignature: "previous-signature",
      cachedBuild,
      previousCompletedBuild,
    })).toEqual(previousCompletedBuild);
  });

  it("detects copyable saved builds from nested order item design data", () => {
    const cachedBuild = {
      signature: "current-design-signature",
      layout: { svg: "<svg data-current-design></svg>" },
      analysis: { connectedComponentCount: 1 },
    };
    const previousCompletedBuild = {
      signature: "previous-design-signature",
      layout: { svg: "<svg data-previous-design></svg>" },
      analysis: { connectedComponentCount: 2 },
    };

    expect(getCopyableSavedBuild({
      design: {
        completedSettingsSignature: "previous-design-signature",
        cachedBuild,
        previousCompletedBuild,
      },
    })).toEqual(previousCompletedBuild);
  });

  it("falls back to the first valid saved build candidate when no completed signature exists", () => {
    const previousCompletedBuild = {
      signature: "previous-signature",
      layout: { svg: "<svg data-previous></svg>" },
      analysis: { connectedComponentCount: 2 },
    };

    expect(getCopyableSavedBuild({
      completedSettingsSignature: null,
      cachedBuild: { signature: "bad-cached", layout: { svg: "<svg></svg>" } },
      previousCompletedBuild,
    })).toEqual(previousCompletedBuild);

    expect(getCopyableSavedBuild({
      completedSettingsSignature: "",
      cachedBuild: {
        signature: "cached-signature",
        layout: { svg: "<svg data-current></svg>" },
        analysis: { connectedComponentCount: 1 },
      },
      previousCompletedBuild,
    })).toMatchObject({ signature: "cached-signature" });
  });
});
