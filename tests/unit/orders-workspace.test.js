import { describe, expect, it } from "vitest";

import {
  filterGroupedOrders,
  getCheckedOrderIdsForBulkAction,
  getEtsyConnectionActionDescriptor,
  getEtsyImportProgressDescriptor,
  getEtsyImportSummary,
  getOrderItemCustomizationWarning,
  getCopyableSavedBuild,
  getOrderLifecycleStatusDescriptor,
  getOrderItemStatusDescriptor,
  getOrderItemListingText,
  getSelectedGroupedOrder,
  getVisibleOrderSelectionState,
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

  it("normalizes direct orders workspace state", () => {
    const result = normalizeOrdersWorkspaceState({
      orders: [
        { id: "order:1751", buyerName: "Ada" },
        { id: "order:1752", buyerName: "Grace" },
      ],
      selectedOrderId: "order:1752",
      checkedOrderIds: ["order:1751", "order:missing"],
    });

    expect(result.orders).toEqual([
      { id: "order:1751", buyerName: "Ada" },
      { id: "order:1752", buyerName: "Grace" },
    ]);
    expect(result.selectedOrderId).toBe("order:1752");
    expect(result.checkedOrderIds).toBeInstanceOf(Set);
    expect([...result.checkedOrderIds]).toEqual(["order:1751"]);
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

  it("returns the imported Etsy listing title from source metadata", () => {
    expect(getOrderItemListingText({
      source: { listingTitle: "Custom RN Badge Reel" },
    })).toBe("Custom RN Badge Reel");
  });

  it("describes grouped order lifecycle status for UI indicators", () => {
    expect(getOrderLifecycleStatusDescriptor({ status: "open", items: [] })).toEqual({
      status: "open",
      label: "Open",
      className: "is-open",
    });

    expect(getOrderLifecycleStatusDescriptor({
      status: "open",
      items: [{ status: "complete" }, { status: "complete" }],
    })).toEqual({
      status: "complete",
      label: "Complete",
      className: "is-complete",
    });

    expect(getOrderLifecycleStatusDescriptor({
      items: [{ status: "skipped" }],
    })).toEqual({
      status: "skipped",
      label: "Skipped",
      className: "is-skipped",
    });
  });

  it("describes order item status for detail cards", () => {
    expect(getOrderItemStatusDescriptor({ status: "complete", isInActiveBatch: false })).toEqual({
      status: "complete",
      label: "Complete",
      detail: "Can be added back to the active batch",
      className: "is-complete",
    });

    expect(getOrderItemStatusDescriptor({ status: "skipped", isInActiveBatch: false })).toEqual({
      status: "skipped",
      label: "Skipped",
      detail: "Excluded from production batching",
      className: "is-skipped",
    });

    expect(getOrderItemStatusDescriptor({ status: "open", isInActiveBatch: true })).toEqual({
      status: "open",
      label: "Open",
      detail: "Already in active batch",
      className: "is-open",
    });
  });
  it("describes visible order selection for select-all controls", () => {
    expect(getVisibleOrderSelectionState([
      { id: "order:5001" },
      { id: "order:5002" },
    ], new Set(["order:5001"]))).toEqual({
      visibleOrderCount: 2,
      checkedVisibleOrderCount: 1,
      allVisibleChecked: false,
      someVisibleChecked: true,
    });

    expect(getVisibleOrderSelectionState([
      { id: "order:5001" },
      { id: "order:5002" },
    ], new Set(["order:5001", "order:5002", "order:hidden"]))).toEqual({
      visibleOrderCount: 2,
      checkedVisibleOrderCount: 2,
      allVisibleChecked: true,
      someVisibleChecked: false,
    });

    expect(getVisibleOrderSelectionState([], new Set(["order:hidden"]))).toEqual({
      visibleOrderCount: 0,
      checkedVisibleOrderCount: 0,
      allVisibleChecked: false,
      someVisibleChecked: false,
    });
  });

  it("filters grouped orders by search text, status, and active batch membership", () => {
    const orders = [
      {
        id: "order:1001",
        orderNumber: "1001",
        buyerName: "Ada Lovelace",
        status: "open",
        isInActiveBatch: true,
        items: [{
          id: "item-1",
          listingId: "listing-1",
          transactionId: "txn-1",
          importedColor: "Pink",
          isInActiveBatch: true,
          design: { text: "Ada RN", lines: [{ text: "Ada" }, { text: "RN" }] },
          source: { listingTitle: "Badge Reel" },
        }],
      },
      {
        id: "order:1002",
        orderNumber: "1002",
        buyerName: "Grace Hopper",
        status: "complete",
        isInActiveBatch: false,
        items: [{
          id: "item-2",
          listingId: "listing-2",
          transactionId: "txn-2",
          importedColor: "Blue",
          isInActiveBatch: false,
          design: { text: "Grace MD", lines: [{ text: "Grace" }, { text: "MD" }] },
          source: { listingTitle: "Stethoscope Badge" },
        }],
      },
      {
        id: "order:1003",
        orderNumber: "1003",
        buyerName: "Katherine Johnson",
        status: "skipped",
        isInActiveBatch: false,
        items: [{
          id: "item-3",
          listingId: "listing-3",
          transactionId: "txn-3",
          importedColor: "Green",
          isInActiveBatch: false,
          status: "skipped",
          design: { text: "Katherine RN", lines: [{ text: "Katherine" }, { text: "RN" }] },
          source: { listingTitle: "Skipped Badge" },
        }],
      },
    ];

    expect(filterGroupedOrders(orders, {
      searchTerm: "stethoscope",
      statusFilter: "all",
      batchFilter: "all",
    }).map((order) => order.id)).toEqual(["order:1002"]);

    expect(filterGroupedOrders(orders, {
      searchTerm: "",
      statusFilter: "open",
      batchFilter: "inBatch",
    }).map((order) => order.id)).toEqual(["order:1001"]);

    expect(filterGroupedOrders(orders, {
      searchTerm: "",
      statusFilter: "complete",
      batchFilter: "notInBatch",
    }).map((order) => order.id)).toEqual(["order:1002"]);

    expect(filterGroupedOrders(orders, {
      searchTerm: "",
      statusFilter: "skipped",
      batchFilter: "notInBatch",
    }).map((order) => order.id)).toEqual(["order:1003"]);

    expect(filterGroupedOrders(orders, {
      searchTerm: "",
      statusFilter: "open",
      batchFilter: "all",
    }).map((order) => order.id)).toEqual(["order:1001"]);
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
describe("Etsy workspace descriptors", () => {
  it("describes connection actions and importing state", () => {
    expect(getEtsyConnectionActionDescriptor({ status: "disconnected" })).toEqual({
      label: "Connect Etsy Shop", disabled: false,
    });
    expect(getEtsyConnectionActionDescriptor({ status: "connected" })).toEqual({
      label: "Import from Etsy", disabled: false,
    });
    expect(getEtsyConnectionActionDescriptor({ status: "reconnect_required" })).toEqual({
      label: "Reconnect Etsy Shop", disabled: false,
    });
    expect(getEtsyConnectionActionDescriptor({ status: "connected", importing: true })).toEqual({
      label: "Import from Etsy", disabled: true,
    });
  });

  it("normalizes progress and summarizes all outcomes", () => {
    expect(getEtsyImportProgressDescriptor({ stage: "fetching_receipts" })).toEqual({
      label: "Fetching Etsy receipts\u2026", determinate: false, value: null, max: null,
    });
    expect(getEtsyImportProgressDescriptor({ stage: "importing_items", processed: 6, total: 14 })).toEqual({
      label: "Importing Etsy items\u2026 6 of 14", determinate: true, value: 6, max: 14,
    });
    expect(getEtsyImportProgressDescriptor({ stage: "importing_items", processed: 99, total: -3 })).toMatchObject({
      value: 0, max: 0,
    });
    expect(getEtsyImportSummary({ imported: 1, existing: 2, customizationNeeded: 1, failed: 0 }))
      .toBe("1 order imported, 2 existing orders, 1 item needing customization, 0 failures.");
  });

  it("warns for direct and mapped Etsy source metadata", () => {
    expect(getOrderItemCustomizationWarning({ source: { customizationNeeded: true } })).not.toBeNull();
    expect(getOrderItemCustomizationWarning({ source: { source: { customizationNeeded: true } } })).not.toBeNull();
    expect(getOrderItemCustomizationWarning({ source: { customizationNeeded: false } })).toBeNull();
  });
});
