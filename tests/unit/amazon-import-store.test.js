import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  calls: [],
  responses: [],
}));

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => ({
    from: (table) => createBuilder({ table, filters: [] }),
    rpc: async (name, args) => {
      database.calls.push({ operation: "rpc", name, args });
      return database.responses.shift() || { data: null, error: null };
    },
  }),
}));

function takeResponse() {
  return database.responses.shift() || { data: null, error: null };
}

function createBuilder(call) {
  return {
    upsert(payload, options) {
      call.operation = "upsert";
      call.payload = payload;
      call.options = options;
      database.calls.push(call);
      return Promise.resolve(takeResponse());
    },
    update(payload) {
      call.operation = "update";
      call.payload = payload;
      return this;
    },
    eq(column, value) {
      call.filters.push(["eq", column, value]);
      return this;
    },
    gt(column, value) {
      call.filters.push(["gt", column, value]);
      return this;
    },
    or(value) {
      call.filters.push(["or", value]);
      return this;
    },
    select(columns) {
      call.select = columns;
      return this;
    },
    maybeSingle() {
      database.calls.push(call);
      return Promise.resolve(takeResponse());
    },
  };
}

beforeEach(() => {
  database.calls = [];
  database.responses = [];
});

describe("Amazon import store", () => {
  it("conditionally acquires a ten-minute workspace lease", async () => {
    database.responses.push(
      { data: null, error: null },
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );
    const { acquireAmazonImportLock } = await import("../../api/_lib/amazon-import-store.js");
    const now = new Date("2026-07-25T15:00:00.000Z");

    await expect(acquireAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "token-a",
      now,
    })).resolves.toBe(true);
    await expect(acquireAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "token-b",
      now,
    })).resolves.toBe(false);

    expect(database.calls[0]).toMatchObject({
      table: "amazon_import_state",
      operation: "upsert",
      payload: { workspace_id: "workspace-1" },
      options: { onConflict: "workspace_id", ignoreDuplicates: true },
    });
    expect(database.calls[1]).toMatchObject({
      table: "amazon_import_state",
      operation: "update",
      payload: {
        import_lock_token: "token-a",
        import_lock_until: "2026-07-25T15:10:00.000Z",
        updated_at: "2026-07-25T15:00:00.000Z",
      },
    });
    expect(database.calls[1].filters).toEqual([
      ["eq", "workspace_id", "workspace-1"],
      ["or", "import_lock_until.is.null,import_lock_until.lte.2026-07-25T15:00:00.000Z"],
    ]);
  });

  it("renews and releases only the matching lease owner", async () => {
    database.responses.push(
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: null, error: null },
      { data: { workspace_id: "workspace-1" }, error: null },
      { data: null, error: null },
    );
    const {
      releaseAmazonImportLock,
      renewAmazonImportLock,
    } = await import("../../api/_lib/amazon-import-store.js");
    const now = new Date("2026-07-25T15:05:00.000Z");

    await expect(renewAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "token-a",
      now,
    })).resolves.toBe(true);
    await expect(renewAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "stale",
      now,
    })).resolves.toBe(false);
    await expect(releaseAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "token-a",
    })).resolves.toBe(true);
    await expect(releaseAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "stale",
    })).resolves.toBe(false);

    expect(database.calls[0].filters).toEqual([
      ["eq", "workspace_id", "workspace-1"],
      ["eq", "import_lock_token", "token-a"],
      ["gt", "import_lock_until", "2026-07-25T15:05:00.000Z"],
    ]);
    expect(database.calls[0].payload.import_lock_until).toBe("2026-07-25T15:15:00.000Z");
    expect(database.calls[2]).toMatchObject({
      operation: "update",
      payload: {
        import_lock_until: null,
        import_lock_token: null,
      },
    });
    expect(database.calls[2].filters).toEqual([
      ["eq", "workspace_id", "workspace-1"],
      ["eq", "import_lock_token", "token-a"],
    ]);
  });

  it("rejects missing workspace and lock identifiers before querying", async () => {
    const {
      acquireAmazonImportLock,
      releaseAmazonImportLock,
      renewAmazonImportLock,
    } = await import("../../api/_lib/amazon-import-store.js");

    await expect(acquireAmazonImportLock({
      workspaceId: "",
      lockToken: "token",
    })).rejects.toThrow("workspaceId is required");
    await expect(renewAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: " ",
    })).rejects.toThrow("lockToken is required");
    await expect(releaseAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "",
    })).rejects.toThrow("lockToken is required");
    expect(database.calls).toEqual([]);
  });

  it("packages the generic order payload for the exact transactional RPC", async () => {
    database.responses.push({
      data: {
        importedOrderItemIds: ["amazon-order-item:NEW"],
        existingOrderItemIds: [],
      },
      error: null,
    });
    const { importAmazonOrderItemsTransactional } = await import("../../api/_lib/amazon-import-store.js");
    const items = [{
      id: "amazon-order-item:NEW",
      text: "Ada\nRN",
      presetId: "preset-1",
      source: {
        orderNumber: "114-1",
        buyerName: "Ada",
        listingId: "listing-1",
        transactionId: "amazon-item-1",
        colorName: "Teal",
        shipByDate: "2026-07-28",
        quantity: 2,
      },
      settings: {
        boundingSizePresetId: "size-1",
        backingMm: 4.2,
        lines: [
          { fontId: "skywalk", fontSizeMm: 18 },
          { fontId: "somekind", bridgeMm: 0.7 },
        ],
      },
    }];

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items,
    })).resolves.toEqual({
      importedOrderItemIds: ["amazon-order-item:NEW"],
      existingOrderItemIds: [],
    });

    expect(database.calls).toEqual([{
      operation: "rpc",
      name: "import_amazon_order_items",
      args: {
        p_workspace_id: "11111111-1111-4111-8111-111111111111",
        p_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        p_items: [{
          orderItem: expect.objectContaining({
            id: "amazon-order-item:NEW",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            status: "open",
            order_number: "114-1",
            ship_by_date: "2026-07-28",
            quantity: 2,
            source_json: items[0].source,
            updated_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          }),
          design: expect.objectContaining({
            workspace_id: "11111111-1111-4111-8111-111111111111",
            order_item_id: "amazon-order-item:NEW",
            design_text: "Ada\nRN",
            preset_id: "preset-1",
            size_guide_id: "size-1",
            backing_border_mm: 4.2,
            updated_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          }),
          lines: [
            expect.objectContaining({
              line_index: 0,
              text: "Ada",
              font_id: "skywalk",
              text_height_mm: 18,
            }),
            expect.objectContaining({
              line_index: 1,
              text: "RN",
              font_id: "somekind",
              letter_bridge_mm: 0.7,
            }),
          ],
        }],
      },
    }]);
    expect(database.calls[0].args.p_items[0].lines[0]).not.toHaveProperty("design_id");
  });

  it("rejects duplicate requested item IDs before calling the RPC", async () => {
    const { importAmazonOrderItemsTransactional } = await import("../../api/_lib/amazon-import-store.js");
    const duplicate = {
      id: "amazon-order-item:DUPLICATE",
      text: "Ada",
      source: { orderNumber: "1001" },
    };

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: "workspace-1",
      userId: "user-1",
      items: [duplicate, { ...duplicate, text: "Replacement" }],
    })).rejects.toMatchObject({
      name: "AmazonImportStoreError",
      code: "amazon_import_store_error",
      message: "Amazon import items must have unique order item IDs.",
    });
    expect(database.calls).toEqual([]);
  });

  it.each([
    {
      label: "missing a requested ID",
      data: {
        importedOrderItemIds: ["amazon-order-item:A"],
        existingOrderItemIds: [],
      },
    },
    {
      label: "returns an unrequested ID",
      data: {
        importedOrderItemIds: ["amazon-order-item:A"],
        existingOrderItemIds: ["amazon-order-item:UNREQUESTED"],
      },
    },
    {
      label: "duplicates an ID within one result array",
      data: {
        importedOrderItemIds: ["amazon-order-item:A", "amazon-order-item:A"],
        existingOrderItemIds: ["amazon-order-item:B"],
      },
    },
    {
      label: "overlaps imported and existing IDs",
      data: {
        importedOrderItemIds: ["amazon-order-item:A"],
        existingOrderItemIds: ["amazon-order-item:A", "amazon-order-item:B"],
      },
    },
  ])("rejects an RPC result that $label", async ({ data }) => {
    database.responses.push({ data, error: null });
    const { importAmazonOrderItemsTransactional } = await import("../../api/_lib/amazon-import-store.js");

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: "workspace-1",
      userId: "user-1",
      items: [
        { id: "amazon-order-item:A", text: "Ada" },
        { id: "amazon-order-item:B", text: "RN" },
      ],
    })).rejects.toMatchObject({
      name: "AmazonImportStoreError",
      code: "amazon_import_store_error",
      message: "Amazon import database returned an invalid response.",
    });
  });

  it("strictly validates RPC results and hides database details", async () => {
    const { importAmazonOrderItemsTransactional } = await import("../../api/_lib/amazon-import-store.js");
    database.responses.push({ data: { importedOrderItemIds: [123], existingOrderItemIds: [] }, error: null });
    await expect(importAmazonOrderItemsTransactional({
      workspaceId: "workspace-1",
      userId: null,
      items: [],
    })).rejects.toThrow("invalid response");

    database.responses.push({ data: null, error: new Error("password=database-secret") });
    const error = await importAmazonOrderItemsTransactional({
      workspaceId: "workspace-1",
      userId: null,
      items: [],
    }).catch((caught) => caught);
    expect(error.message).toBe("Unable to import Amazon order items.");
    expect(error.message).not.toContain("database-secret");
    expect(error.cause?.message).toContain("database-secret");
  });

  it("hides lock database errors behind an operation-safe message", async () => {
    database.responses.push({ data: null, error: new Error("password=database-secret") });
    const { acquireAmazonImportLock } = await import("../../api/_lib/amazon-import-store.js");

    const error = await acquireAmazonImportLock({
      workspaceId: "workspace-1",
      lockToken: "token-a",
    }).catch((caught) => caught);

    expect(error.message).toBe("Unable to acquire Amazon import lock.");
    expect(error.message).not.toContain("database-secret");
    expect(error.cause?.message).toContain("database-secret");
  });
});
