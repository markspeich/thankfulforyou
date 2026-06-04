# Orders Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated `Orders` workspace that lists non-archived database orders, imports pasted Etsy orders durably, and adds selected order items to the active production batch.

**Architecture:** Add a server-side Orders API/store beside the existing production-batch API, extract shared Etsy import helpers from `src/app.js`, then wire a new left-nav workspace that uses those contracts. Production Batch paste writes order records plus active `batch_items`; Orders paste writes order records only.

**Tech Stack:** Vanilla JS modules, Vercel-style API routes, Supabase service-role server access, Vitest, Playwright, existing production workspace CSS.

---

## File Structure

- Create: `src/etsy-import.js`
  - Shared clipboard parser, imported entry normalization, and imported identity helpers currently embedded in `src/app.js`.
- Create: `src/orders-api.js`
  - Browser client for `/api/orders`.
- Create: `src/orders-workspace.js`
  - Focused renderer/state helper for grouped Orders page data. Keep DOM wiring in `src/app.js` if direct access to existing app globals is simpler, but put pure grouping and selection helpers here.
- Create: `api/_lib/orders-store.js`
  - Supabase queries/mutations for non-archived order listing, durable imports, and idempotent batch membership inserts.
- Create: `api/orders.js`
  - Authenticated route for Orders reads/imports/batch-add actions.
- Modify: `src/app.js`
  - Use shared import helpers.
  - Add Orders workspace state, nav switching, paste behavior, add-to-batch actions, and rendering glue.
  - Keep existing Production Batch behavior but route paste through immediate server persistence.
- Modify: `src/production-batch-api.js`
  - No change expected; keep production-batch snapshot/session calls here and put Orders route calls in `src/orders-api.js`.
- Modify: `index.html`
  - Add `Orders` nav item and Orders workspace markup.
- Modify: `src/styles.css`
  - Add Orders workspace layout/card/menu/check styles using existing production visual language.
- Modify: `docs/requirements.md`
  - Only if implementation uncovers a new product decision not already captured.
- Create tests:
  - `tests/unit/etsy-import.test.js`
  - `tests/unit/orders-api.test.js`
  - `tests/unit/orders-store.test.js`
  - `tests/unit/orders-api-route.test.js`
  - `tests/unit/orders-workspace.test.js`
  - `tests/e2e/orders-workspace.spec.js`

## Data Contracts

Use this client-facing grouped response from `GET /api/orders`:

```js
{
  orders: [
    {
      id: "order:12345",
      orderNumber: "12345",
      buyerName: "Jamie",
      checked: false,
      itemCount: 2,
      activeBatchItemCount: 1,
      updatedAt: "2026-06-03T12:00:00.000Z",
      items: [
        {
          id: "transaction:67890",
          orderNumber: "12345",
          buyerName: "Jamie",
          listingId: "987",
          listingTitle: "Badge Reel",
          listingImageUrl75x75: "https://example.test/image.jpg",
          importedColor: "Red",
          quantity: 1,
          text: "Jamie\nRN",
          status: "captured",
          isInActiveBatch: true,
          source: { orderNumber: "12345", transactionId: "67890" },
          design: {
            productionStatus: "saved",
            cachedBuild: null,
            previousCompletedBuild: null,
            savedSettingsSignature: "signature",
            completedSettingsSignature: "signature",
            analysisBadge: { state: "ok", shortLabel: "1", fullLabel: "One connected face piece" },
            settings: {
              text: "Jamie\nRN",
              presetId: "preset-a1f4c8e2b601",
              boundingSizePresetId: "size-2-2x1-5",
              backingMm: 3.1,
              weldExportedDesign: true,
              lines: []
            }
          }
        }
      ]
    }
  ]
}
```

Use these `POST /api/orders` action payloads:

```js
{ action: "importClipboardItems", target: "orders", items: [normalizedItem] }
{ action: "importClipboardItems", target: "productionBatch", batchId: "batch-1", items: [normalizedItem] }
{ action: "addOrderItemToProductionBatch", batchId: "batch-1", orderItemId: "item-1" }
{ action: "addOrdersToProductionBatch", batchId: "batch-1", orderIds: ["order:12345"] }
```

All mutations return:

```js
{
  importedCount: 0,
  addedToBatchCount: 0,
  skippedCount: 0,
  orders: []
}
```

---

### Task 1: Extract Etsy Import Helpers

**Files:**
- Create: `src/etsy-import.js`
- Modify: `src/app.js`
- Test: `tests/unit/etsy-import.test.js`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/unit/etsy-import.test.js`:

```js
import { describe, expect, it, vi } from "vitest";

describe("etsy import helpers", () => {
  it("parses array and object clipboard payloads into normalized items", async () => {
    vi.resetModules();
    const { parseImportedItems } = await import("../../src/etsy-import.js");
    const payload = JSON.stringify({
      items: [{
        orderNumber: "1001",
        transactionId: "tx-1",
        listingId: "listing-1",
        buyerName: "Jamie &amp; Co",
        personalization: "Jamie\nRN",
        colorName: "Red",
        quantity: "2",
        listingTitle: "Custom Badge",
        listingImageUrl75x75: "https://example.test/image.jpg"
      }]
    });

    expect(parseImportedItems(payload, { getPresetIdForListingId: () => "preset-1" })).toEqual([{
      text: "Jamie\nRN",
      presetId: "preset-1",
      source: {
        orderNumber: "1001",
        listingId: "listing-1",
        buyerName: "Jamie & Co",
        colorName: "Red",
        quantity: "2",
        listingTitle: "Custom Badge",
        listingImageUrl75x75: "https://example.test/image.jpg",
        transactionId: "tx-1",
      },
    }]);
  });

  it("filters entries without personalization", async () => {
    const { parseImportedItems } = await import("../../src/etsy-import.js");

    expect(parseImportedItems(JSON.stringify([{ orderNumber: "1001", personalization: "" }]), {
      getPresetIdForListingId: () => null,
    })).toEqual([]);
  });

  it("builds stable imported identities from transaction id first", async () => {
    const { buildImportedBatchIdentity } = await import("../../src/etsy-import.js");

    expect(buildImportedBatchIdentity({ transactionId: "tx-1" }, "Jamie")).toBe("transaction:tx-1");
    expect(buildImportedBatchIdentity({
      orderNumber: "1001",
      listingId: "listing-1",
      buyerName: "Jamie",
    }, "RN")).toBe("fallback:1001|listing-1|Jamie|RN");
  });

  it("throws a clear error for payloads without importable designs", async () => {
    const { parseImportedItems } = await import("../../src/etsy-import.js");

    expect(() => parseImportedItems("{}", { getPresetIdForListingId: () => null }))
      .toThrow("Clipboard data did not contain any Etsy designs.");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npx vitest tests/unit/etsy-import.test.js
```

Expected: fail because `src/etsy-import.js` does not exist.

- [ ] **Step 3: Create the shared helper module**

Create `src/etsy-import.js`:

```js
const HTML_ENTITY_REPLACEMENTS = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
});

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITY_REPLACEMENTS[entity] || entity);
}

function repairImportedMojibake(value) {
  if (typeof value !== "string" || !/[\u00c3\u00c2\u00e2]/.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value, (character) => {
      const codePoint = character.codePointAt(0);
      if (typeof codePoint !== "number" || codePoint > 255) {
        throw new Error("Non-Latin1 character");
      }
      return codePoint;
    }));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

export function normalizeImportedText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return repairImportedMojibake(decodeHtmlEntities(value).trim());
}

export function normalizeImportedEntry(entry, options = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const personalization = normalizeImportedText(
    typeof entry.personalization === "string" ? entry.personalization : entry.text,
  );

  if (!personalization) {
    return null;
  }

  const listingId = entry.listingId == null ? "" : String(entry.listingId).trim();
  const getPresetIdForListingId = typeof options.getPresetIdForListingId === "function"
    ? options.getPresetIdForListingId
    : () => null;

  return {
    text: personalization,
    presetId: getPresetIdForListingId(listingId),
    source: {
      orderNumber: entry.orderNumber == null ? "" : String(entry.orderNumber).trim(),
      listingId,
      buyerName: normalizeImportedText(entry.buyerName),
      colorName: normalizeImportedText(entry.colorName),
      quantity: entry.quantity == null ? "" : String(entry.quantity).trim(),
      listingTitle: normalizeImportedText(entry.listingTitle),
      listingImageUrl75x75: typeof entry.listingImageUrl75x75 === "string"
        ? entry.listingImageUrl75x75.trim()
        : "",
      transactionId: entry.transactionId == null ? "" : String(entry.transactionId).trim(),
    },
  };
}

export function buildImportedBatchIdentity(source, text = "") {
  if (!source || typeof source !== "object") {
    return "";
  }

  const transactionId = source.transactionId == null ? "" : String(source.transactionId).trim();
  if (transactionId) {
    return `transaction:${transactionId}`;
  }

  const orderNumber = source.orderNumber == null ? "" : String(source.orderNumber).trim();
  const listingId = source.listingId == null ? "" : String(source.listingId).trim();
  const buyerName = typeof source.buyerName === "string" ? source.buyerName.trim() : "";
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!orderNumber && !listingId && !buyerName && !normalizedText) {
    return "";
  }

  return `fallback:${orderNumber}|${listingId}|${buyerName}|${normalizedText}`;
}

export function parseImportedItems(payloadText, options = {}) {
  const parsed = JSON.parse(payloadText);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [];

  if (!rawItems.length) {
    throw new Error("Clipboard data did not contain any Etsy designs.");
  }

  return rawItems
    .map((entry) => normalizeImportedEntry(entry, options))
    .filter(Boolean);
}
```

- [ ] **Step 4: Replace duplicate helpers in `src/app.js`**

Add to the import list in `src/app.js`:

```js
import {
  buildImportedBatchIdentity,
  parseImportedItems,
} from "./etsy-import.js";
```

Delete these local functions from `src/app.js`:

```js
decodeHtmlEntities
repairImportedMojibake
normalizeImportedText
normalizeImportedEntry
buildImportedBatchIdentity
parseImportedItems
```

Update the call in `importFromClipboard` from:

```js
const importedItems = parseImportedItems(clipboardText);
```

to:

```js
const importedItems = parseImportedItems(clipboardText, { getPresetIdForListingId });
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest tests/unit/etsy-import.test.js tests/unit/production-batch-api.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/etsy-import.js src/app.js tests/unit/etsy-import.test.js
git commit -m "refactor: share Etsy import parsing"
```

---

### Task 2: Add Orders Store Mapping And Queries

**Files:**
- Create: `api/_lib/orders-store.js`
- Test: `tests/unit/orders-store.test.js`

- [ ] **Step 1: Write failing store tests**

Create `tests/unit/orders-store.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = {
  calls: [],
  tableData: new Map(),
};

function createQuery(table) {
  const query = {
    table,
    operation: "select",
    payload: null,
    filters: [],
    select(value) {
      this.operation = "select";
      this.payload = value;
      supabaseMock.calls.push(this);
      return this;
    },
    insert(value) {
      this.operation = "insert";
      this.payload = value;
      supabaseMock.calls.push(this);
      return this;
    },
    upsert(value, options) {
      this.operation = "upsert";
      this.payload = value;
      this.options = options;
      supabaseMock.calls.push(this);
      return this;
    },
    eq(column, value) {
      this.filters.push(["eq", column, value]);
      return this;
    },
    neq(column, value) {
      this.filters.push(["neq", column, value]);
      return this;
    },
    in(column, value) {
      this.filters.push(["in", column, value]);
      return this;
    },
    order(column, options) {
      this.orderBy = [column, options];
      return this;
    },
    limit(value) {
      this.limitValue = value;
      return this;
    },
    maybeSingle() {
      const data = supabaseMock.tableData.get(table);
      return Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data ?? null, error: null });
    },
    then(resolve) {
      resolve({ data: supabaseMock.tableData.get(table) || [], error: null });
    },
  };
  return query;
}

vi.mock("../../api/_lib/supabase-admin.js", () => ({
  createSupabaseAdminClient: () => ({
    from: (table) => createQuery(table),
  }),
}));

beforeEach(() => {
  supabaseMock.calls = [];
  supabaseMock.tableData = new Map();
});

afterEach(() => {
  vi.resetModules();
});

describe("orders store", () => {
  it("groups non-archived order items by order number", async () => {
    supabaseMock.tableData.set("order_items", [
      {
        id: "item-1",
        workspace_id: "workspace-1",
        status: "active",
        order_number: "1001",
        buyer_name: "Jamie",
        listing_id: "listing-1",
        transaction_id: "tx-1",
        imported_color: "Red",
        quantity: 1,
        source_json: { listingTitle: "Badge" },
        updated_at: "2026-06-03T12:00:00.000Z",
      },
      {
        id: "item-2",
        workspace_id: "workspace-1",
        status: "active",
        order_number: "1001",
        buyer_name: "Jamie",
        listing_id: "listing-2",
        transaction_id: "tx-2",
        imported_color: "Blue",
        quantity: 1,
        source_json: {},
        updated_at: "2026-06-03T12:01:00.000Z",
      },
    ]);
    supabaseMock.tableData.set("designs", [
      {
        id: "design-1",
        order_item_id: "item-1",
        design_text: "Jamie",
        production_status: "saved",
        cached_build_json: null,
        previous_completed_build_json: null,
        saved_settings_signature: null,
        completed_settings_signature: null,
        analysis_badge_json: null,
        preset_id: null,
        size_guide_id: null,
        backing_border_mm: 3.1,
        weld_exported_design: true,
        global_horizontal_scale: 1,
        global_vertical_scale: 1,
      },
    ]);
    supabaseMock.tableData.set("design_lines", []);
    supabaseMock.tableData.set("batch_items", [
      { order_item_id: "item-1", status: "active" },
    ]);

    const { listWorkspaceOrders } = await import("../../api/_lib/orders-store.js");
    const result = await listWorkspaceOrders({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      id: "order:1001",
      orderNumber: "1001",
      buyerName: "Jamie",
      itemCount: 2,
      activeBatchItemCount: 1,
    });
    expect(result.orders[0].items[0]).toMatchObject({
      id: "item-1",
      isInActiveBatch: true,
      text: "Jamie",
    });
  });

  it("uses upsert for durable imports and only inserts batch items for productionBatch target", async () => {
    supabaseMock.tableData.set("production_batches", { id: "batch-1", workspace_id: "workspace-1" });
    supabaseMock.tableData.set("batch_items", []);

    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");
    await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      target: "productionBatch",
      items: [{
        text: "Jamie",
        presetId: "preset-1",
        source: { orderNumber: "1001", transactionId: "tx-1", buyerName: "Jamie" },
      }],
    });

    expect(supabaseMock.calls.find((call) => call.table === "order_items" && call.operation === "upsert")).toBeTruthy();
    expect(supabaseMock.calls.find((call) => call.table === "designs" && call.operation === "upsert")).toBeTruthy();
    expect(supabaseMock.calls.find((call) => call.table === "batch_items" && call.operation === "upsert")).toBeTruthy();
  });

  it("does not insert batch items for orders-only imports", async () => {
    const { importWorkspaceOrderItems } = await import("../../api/_lib/orders-store.js");
    await importWorkspaceOrderItems({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
      items: [{
        text: "Jamie",
        presetId: null,
        source: { orderNumber: "1001", transactionId: "tx-1" },
      }],
    });

    expect(supabaseMock.calls.find((call) => call.table === "batch_items")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npx vitest tests/unit/orders-store.test.js
```

Expected: fail because `api/_lib/orders-store.js` does not exist.

- [ ] **Step 3: Implement store helpers**

Create `api/_lib/orders-store.js`:

```js
import { createSupabaseAdminClient } from "./supabase-admin.js";

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeJsonValue(value, fallback) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value == null ? fallback : value;
}

function normalizeSource(source = {}) {
  return source && typeof source === "object" ? source : {};
}

function buildOrderItemId(item) {
  const source = normalizeSource(item.source);
  const transactionId = typeof source.transactionId === "string" ? source.transactionId.trim() : "";
  if (transactionId) {
    return `transaction:${transactionId}`;
  }

  const orderNumber = typeof source.orderNumber === "string" ? source.orderNumber.trim() : "";
  const listingId = typeof source.listingId === "string" ? source.listingId.trim() : "";
  const buyerName = typeof source.buyerName === "string" ? source.buyerName.trim() : "";
  const text = typeof item.text === "string" ? item.text.trim() : "";
  const encoded = Buffer.from(`${orderNumber}|${listingId}|${buyerName}|${text}`).toString("base64url").slice(0, 48);
  return `import:${encoded}`;
}

function buildOrderGroupId(orderItem) {
  if (orderItem.order_number) {
    return `order:${orderItem.order_number}`;
  }

  const source = normalizeJsonValue(orderItem.source_json, {});
  if (orderItem.transaction_id) {
    return `transaction:${orderItem.transaction_id}`;
  }

  return `fallback:${Buffer.from(`${orderItem.buyer_name || source.buyerName || ""}|${orderItem.listing_id || source.listingId || ""}`).toString("base64url").slice(0, 48)}`;
}

function mapProductionStatusToDesignStatus(status) {
  switch (status) {
    case "saved":
    case "export_ready":
      return "captured";
    case "exported":
      return "exported";
    case "analysis_running":
    case "in_progress":
      return "in-progress";
    case "draft":
    default:
      return "not-started";
  }
}

function mapOrderItem(orderItem, design, lines, activeBatchItemIds) {
  const source = {
    ...normalizeJsonValue(orderItem.source_json, {}),
    orderNumber: orderItem.order_number || "",
    listingId: orderItem.listing_id || "",
    transactionId: orderItem.transaction_id || "",
    buyerName: orderItem.buyer_name || "",
    colorName: orderItem.imported_color || "",
    quantity: orderItem.quantity == null ? "" : String(orderItem.quantity),
  };
  const orderedLines = [...lines].sort((first, second) => first.line_index - second.line_index);
  const text = design?.design_text ?? orderedLines.map((line) => line.text || "").join("\n");

  return {
    id: orderItem.id,
    orderNumber: orderItem.order_number || "",
    buyerName: orderItem.buyer_name || "",
    listingId: orderItem.listing_id || "",
    listingTitle: source.listingTitle || "",
    listingImageUrl75x75: source.listingImageUrl75x75 || "",
    importedColor: orderItem.imported_color || "",
    quantity: toPositiveInteger(orderItem.quantity, 1),
    text,
    status: mapProductionStatusToDesignStatus(design?.production_status),
    isInActiveBatch: activeBatchItemIds.has(orderItem.id),
    source,
    design: {
      productionStatus: design?.production_status || "draft",
      cachedBuild: normalizeJsonValue(design?.cached_build_json, null),
      previousCompletedBuild: normalizeJsonValue(design?.previous_completed_build_json, null),
      savedSettingsSignature: typeof design?.saved_settings_signature === "string" ? design.saved_settings_signature : null,
      completedSettingsSignature: typeof design?.completed_settings_signature === "string" ? design.completed_settings_signature : null,
      analysisBadge: normalizeJsonValue(design?.analysis_badge_json, null),
      settings: {
        text,
        presetId: design?.preset_id ?? null,
        boundingSizePresetId: design?.size_guide_id ?? null,
        backingMm: toNumber(design?.backing_border_mm, 3.1),
        weldExportedDesign: design?.weld_exported_design !== false,
        globalHorizontalScale: toNumber(design?.global_horizontal_scale, 1),
        globalVerticalScale: toNumber(design?.global_vertical_scale, 1),
        lines: orderedLines.map((line) => ({
          fontId: line.font_id || "candlepin",
          bridgeMm: toNumber(line.letter_bridge_mm, 0.5),
          lineBridgeMm: toNumber(line.line_bridge_mm, 0.5),
          offsetXMm: toNumber(line.offset_x_mm, 0),
          fontSizeMm: toNumber(line.text_height_mm, 34),
          horizontalScale: toNumber(line.horizontal_scale, 1),
          verticalScale: toNumber(line.vertical_scale, 1),
          lockTextHeight: Boolean(line.lock_text_height),
        })),
      },
    },
  };
}

export async function listWorkspaceOrders({ workspaceId, activeBatchId = null }) {
  const supabase = createSupabaseAdminClient();
  const { data: orderItems, error: orderItemsError } = await supabase
    .from("order_items")
    .select("id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id, imported_color, quantity, source_json, updated_at")
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (orderItemsError) {
    throw orderItemsError;
  }

  const orderItemIds = (orderItems || []).map((item) => item.id);
  const [{ data: designs, error: designsError }, { data: activeBatchItems, error: batchItemsError }] = await Promise.all([
    orderItemIds.length
      ? supabase
        .from("designs")
        .select("id, order_item_id, design_text, preset_id, size_guide_id, backing_border_mm, weld_exported_design, global_horizontal_scale, global_vertical_scale, production_status, cached_build_json, previous_completed_build_json, saved_settings_signature, completed_settings_signature, analysis_badge_json")
        .in("order_item_id", orderItemIds)
      : Promise.resolve({ data: [], error: null }),
    activeBatchId
      ? supabase
        .from("batch_items")
        .select("order_item_id, status")
        .eq("workspace_id", workspaceId)
        .eq("batch_id", activeBatchId)
        .neq("status", "archived")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (designsError) {
    throw designsError;
  }
  if (batchItemsError) {
    throw batchItemsError;
  }

  const designIds = (designs || []).map((design) => design.id);
  const { data: designLines, error: designLinesError } = designIds.length
    ? await supabase
      .from("design_lines")
      .select("design_id, line_index, text, font_id, letter_bridge_mm, line_bridge_mm, offset_x_mm, text_height_mm, horizontal_scale, vertical_scale, lock_text_height")
      .in("design_id", designIds)
      .order("line_index", { ascending: true })
    : { data: [], error: null };

  if (designLinesError) {
    throw designLinesError;
  }

  const designByOrderItemId = new Map((designs || []).map((design) => [design.order_item_id, design]));
  const linesByDesignId = new Map();
  for (const line of designLines || []) {
    linesByDesignId.set(line.design_id, [...(linesByDesignId.get(line.design_id) || []), line]);
  }
  const activeBatchItemIds = new Set((activeBatchItems || []).map((item) => item.order_item_id));
  const groups = new Map();

  for (const orderItem of orderItems || []) {
    const groupId = buildOrderGroupId(orderItem);
    const design = designByOrderItemId.get(orderItem.id);
    const mappedItem = mapOrderItem(orderItem, design, design ? linesByDesignId.get(design.id) || [] : [], activeBatchItemIds);
    const group = groups.get(groupId) || {
      id: groupId,
      orderNumber: orderItem.order_number || "",
      buyerName: orderItem.buyer_name || "",
      itemCount: 0,
      activeBatchItemCount: 0,
      updatedAt: orderItem.updated_at || null,
      items: [],
    };

    group.items.push(mappedItem);
    group.itemCount = group.items.length;
    group.activeBatchItemCount = group.items.filter((item) => item.isInActiveBatch).length;
    group.updatedAt = group.updatedAt && orderItem.updated_at
      ? (Date.parse(orderItem.updated_at) > Date.parse(group.updatedAt) ? orderItem.updated_at : group.updatedAt)
      : group.updatedAt || orderItem.updated_at || null;
    groups.set(groupId, group);
  }

  return { orders: [...groups.values()] };
}

function buildImportedRows({ workspaceId, userId, items }) {
  const orderItems = [];
  const designs = [];
  const designLines = [];

  for (const item of items) {
    const source = normalizeSource(item.source);
    const id = buildOrderItemId(item);
    const text = typeof item.text === "string" ? item.text : "";
    const lines = text ? text.split(/\r?\n/) : [];

    orderItems.push({
      id,
      workspace_id: workspaceId,
      status: "active",
      order_number: source.orderNumber || null,
      buyer_name: source.buyerName || null,
      listing_id: source.listingId || null,
      transaction_id: source.transactionId || null,
      imported_color: source.colorName || null,
      quantity: toPositiveInteger(source.quantity, 1),
      source_json: source,
      updated_by: userId || null,
      updated_at: new Date().toISOString(),
    });
    designs.push({
      workspace_id: workspaceId,
      order_item_id: id,
      design_text: text,
      preset_id: item.presetId || null,
      production_status: "in_progress",
      updated_by: userId || null,
      updated_at: new Date().toISOString(),
    });
    lines.forEach((lineText, lineIndex) => {
      designLines.push({
        order_item_id: id,
        line_index: lineIndex,
        text: lineText,
        font_id: "candlepin",
      });
    });
  }

  return { orderItems, designs, designLines };
}

export async function importWorkspaceOrderItems({ workspaceId, userId, items, target = "orders", batchId = null }) {
  const supabase = createSupabaseAdminClient();
  const rows = buildImportedRows({ workspaceId, userId, items: Array.isArray(items) ? items : [] });

  if (!rows.orderItems.length) {
    return { importedCount: 0, addedToBatchCount: 0, skippedCount: 0 };
  }

  const { error: orderItemsError } = await supabase
    .from("order_items")
    .upsert(rows.orderItems, { onConflict: "id" });
  if (orderItemsError) {
    throw orderItemsError;
  }

  const { data: savedDesigns, error: designsError } = await supabase
    .from("designs")
    .upsert(rows.designs, { onConflict: "order_item_id" })
    .select("id, order_item_id");
  if (designsError) {
    throw designsError;
  }

  const designIdByOrderItemId = new Map((savedDesigns || []).map((design) => [design.order_item_id, design.id]));
  const designLines = rows.designLines
    .map((line) => {
      const designId = designIdByOrderItemId.get(line.order_item_id);
      const { order_item_id: _orderItemId, ...lineRow } = line;
      return designId ? { ...lineRow, design_id: designId } : null;
    })
    .filter(Boolean);

  if (designLines.length) {
    const { error: linesError } = await supabase
      .from("design_lines")
      .upsert(designLines, { onConflict: "design_id,line_index" });
    if (linesError) {
      throw linesError;
    }
  }

  let addedToBatchCount = 0;
  if (target === "productionBatch" && batchId) {
    addedToBatchCount = await addOrderItemsToProductionBatch({
      workspaceId,
      userId,
      batchId,
      orderItemIds: rows.orderItems.map((item) => item.id),
    });
  }

  return {
    importedCount: rows.orderItems.length,
    addedToBatchCount,
    skippedCount: rows.orderItems.length - addedToBatchCount,
  };
}

export async function addOrderItemsToProductionBatch({ workspaceId, userId, batchId, orderItemIds }) {
  const supabase = createSupabaseAdminClient();
  const uniqueOrderItemIds = [...new Set((orderItemIds || []).filter(Boolean))];
  if (!uniqueOrderItemIds.length) {
    return 0;
  }

  const { data: existingItems, error: existingError } = await supabase
    .from("batch_items")
    .select("order_item_id, status")
    .eq("workspace_id", workspaceId)
    .eq("batch_id", batchId)
    .in("order_item_id", uniqueOrderItemIds)
    .neq("status", "archived");
  if (existingError) {
    throw existingError;
  }

  const existingIds = new Set((existingItems || []).map((item) => item.order_item_id));
  const newIds = uniqueOrderItemIds.filter((id) => !existingIds.has(id));
  if (!newIds.length) {
    return 0;
  }

  const { data: currentItems, error: currentError } = await supabase
    .from("batch_items")
    .select("batch_position")
    .eq("workspace_id", workspaceId)
    .eq("batch_id", batchId)
    .neq("status", "archived")
    .order("batch_position", { ascending: false })
    .limit(1);
  if (currentError) {
    throw currentError;
  }

  const startPosition = Number.isInteger(currentItems?.[0]?.batch_position)
    ? currentItems[0].batch_position + 1
    : 0;
  const rows = newIds.map((orderItemId, index) => ({
    workspace_id: workspaceId,
    batch_id: batchId,
    order_item_id: orderItemId,
    batch_position: startPosition + index,
    status: "active",
    added_by: userId || null,
  }));

  const { error: insertError } = await supabase
    .from("batch_items")
    .upsert(rows, { onConflict: "batch_id,order_item_id" });
  if (insertError) {
    throw insertError;
  }

  return rows.length;
}

export async function addOrderGroupsToProductionBatch({ workspaceId, userId, batchId, orderIds }) {
  const { orders } = await listWorkspaceOrders({ workspaceId, activeBatchId: batchId });
  const selectedIds = new Set(orderIds || []);
  const orderItemIds = orders
    .filter((order) => selectedIds.has(order.id))
    .flatMap((order) => order.items.map((item) => item.id));

  return addOrderItemsToProductionBatch({ workspaceId, userId, batchId, orderItemIds });
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest tests/unit/orders-store.test.js
```

Expected: pass after adapting the mock if the fluent Supabase chain needs a missing method.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/orders-store.js tests/unit/orders-store.test.js
git commit -m "feat: add orders store"
```

---

### Task 3: Add Orders API Route And Client

**Files:**
- Create: `api/orders.js`
- Create: `src/orders-api.js`
- Test: `tests/unit/orders-api-route.test.js`
- Test: `tests/unit/orders-api.test.js`

- [ ] **Step 1: Write failing route tests**

Create `tests/unit/orders-api-route.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = {
  listWorkspaceOrders: vi.fn(),
  importWorkspaceOrderItems: vi.fn(),
  addOrderItemsToProductionBatch: vi.fn(),
  addOrderGroupsToProductionBatch: vi.fn(),
};

vi.mock("../../api/_lib/production-batch-auth.js", () => ({
  resolveProductionBatchAuth: vi.fn(async () => ({ userId: "user-1", workspaceId: "workspace-1" })),
}));

vi.mock("../../api/_lib/orders-store.js", () => storeMock);

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("orders api route", () => {
  it("returns grouped orders for GET", async () => {
    storeMock.listWorkspaceOrders.mockResolvedValue({ orders: [{ id: "order:1001" }] });
    const { default: handler } = await import("../../api/orders.js");
    const res = createResponse();

    await handler({ method: "GET", query: { batchId: "batch-1" }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(storeMock.listWorkspaceOrders).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      activeBatchId: "batch-1",
    });
  });

  it("imports clipboard items to orders target", async () => {
    storeMock.importWorkspaceOrderItems.mockResolvedValue({ importedCount: 1, addedToBatchCount: 0, skippedCount: 0 });
    storeMock.listWorkspaceOrders.mockResolvedValue({ orders: [] });
    const { default: handler } = await import("../../api/orders.js");
    const res = createResponse();

    await handler({
      method: "POST",
      headers: {},
      body: {
        action: "importClipboardItems",
        target: "orders",
        items: [{ text: "Jamie", source: {} }],
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(storeMock.importWorkspaceOrderItems).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      userId: "user-1",
      target: "orders",
    }));
  });

  it("adds one order item to the production batch", async () => {
    storeMock.addOrderItemsToProductionBatch.mockResolvedValue(1);
    storeMock.listWorkspaceOrders.mockResolvedValue({ orders: [] });
    const { default: handler } = await import("../../api/orders.js");
    const res = createResponse();

    await handler({
      method: "POST",
      headers: {},
      body: {
        action: "addOrderItemToProductionBatch",
        batchId: "batch-1",
        orderItemId: "item-1",
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(storeMock.addOrderItemsToProductionBatch).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      batchId: "batch-1",
      orderItemIds: ["item-1"],
    });
  });
});
```

- [ ] **Step 2: Write failing client tests**

Create `tests/unit/orders-api.test.js`:

```js
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("orders api client", () => {
  it("fetches grouped orders with batch id and bearer token", async () => {
    const payload = { orders: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchWorkspaceOrders } = await import("../../src/orders-api.js");

    await expect(fetchWorkspaceOrders({ batchId: "batch-1", accessToken: "token-1" })).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith("/api/orders?batchId=batch-1", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token-1",
      },
    });
  });

  it("imports orders with target orders", async () => {
    const payload = { importedCount: 1, orders: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);
    const { importWorkspaceOrders } = await import("../../src/orders-api.js");

    await importWorkspaceOrders({
      target: "orders",
      items: [{ text: "Jamie" }],
      accessToken: "token-1",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "importClipboardItems",
      target: "orders",
      items: [{ text: "Jamie" }],
    });
  });

  it("throws a readable error on failed add to batch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unable to add order item." }),
    }));
    const { addOrderItemToProductionBatch } = await import("../../src/orders-api.js");

    await expect(addOrderItemToProductionBatch({
      batchId: "batch-1",
      orderItemId: "item-1",
    })).rejects.toThrow("Unable to add order item.");
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest tests/unit/orders-api-route.test.js tests/unit/orders-api.test.js
```

Expected: fail because route/client files do not exist.

- [ ] **Step 4: Implement `api/orders.js`**

Create `api/orders.js`:

```js
import { resolveProductionBatchAuth } from "./_lib/production-batch-auth.js";
import {
  addOrderGroupsToProductionBatch,
  addOrderItemsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrders,
} from "./_lib/orders-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  return req.body;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeItems(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

export default async function handler(req, res) {
  try {
    req.auth = await resolveProductionBatchAuth(req);

    if (req.method === "GET") {
      const activeBatchId = normalizeString(req.query?.batchId) || null;
      const payload = await listWorkspaceOrders({
        workspaceId: req.auth.workspaceId,
        activeBatchId,
      });
      res.status(200).json(payload);
      return;
    }

    if (req.method === "POST") {
      const body = readJsonBody(req);
      const action = normalizeString(body.action);
      const batchId = normalizeString(body.batchId);
      let mutationResult = { importedCount: 0, addedToBatchCount: 0, skippedCount: 0 };

      if (action === "importClipboardItems") {
        const target = body.target === "productionBatch" ? "productionBatch" : "orders";
        if (target === "productionBatch" && !batchId) {
          res.status(400).json({ error: "batchId is required for production batch imports." });
          return;
        }
        mutationResult = await importWorkspaceOrderItems({
          workspaceId: req.auth.workspaceId,
          userId: req.auth.userId,
          target,
          batchId: batchId || null,
          items: normalizeItems(body.items),
        });
      } else if (action === "addOrderItemToProductionBatch") {
        const orderItemId = normalizeString(body.orderItemId);
        if (!batchId || !orderItemId) {
          res.status(400).json({ error: "batchId and orderItemId are required." });
          return;
        }
        const addedToBatchCount = await addOrderItemsToProductionBatch({
          workspaceId: req.auth.workspaceId,
          userId: req.auth.userId,
          batchId,
          orderItemIds: [orderItemId],
        });
        mutationResult = { importedCount: 0, addedToBatchCount, skippedCount: addedToBatchCount ? 0 : 1 };
      } else if (action === "addOrdersToProductionBatch") {
        if (!batchId) {
          res.status(400).json({ error: "batchId is required." });
          return;
        }
        const addedToBatchCount = await addOrderGroupsToProductionBatch({
          workspaceId: req.auth.workspaceId,
          userId: req.auth.userId,
          batchId,
          orderIds: Array.isArray(body.orderIds) ? body.orderIds.map(normalizeString).filter(Boolean) : [],
        });
        mutationResult = { importedCount: 0, addedToBatchCount, skippedCount: 0 };
      } else {
        res.status(400).json({ error: "Unsupported orders action." });
        return;
      }

      const ordersPayload = await listWorkspaceOrders({
        workspaceId: req.auth.workspaceId,
        activeBatchId: batchId || null,
      });
      res.status(200).json({ ...mutationResult, ...ordersPayload });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    if (error?.statusCode && error?.expose) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("Orders API error", error);
    res.status(500).json({
      error: error instanceof Error && error.message ? error.message : "Unable to process orders request.",
    });
  }
}
```

- [ ] **Step 5: Implement `src/orders-api.js`**

Create `src/orders-api.js`:

```js
async function readJsonOrFallback(response, fallback) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

function buildAuthHeaders(accessToken, headers) {
  return {
    ...headers,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function buildOrdersUrl(batchId) {
  const normalizedBatchId = typeof batchId === "string" ? batchId.trim() : "";
  return normalizedBatchId
    ? `/api/orders?batchId=${encodeURIComponent(normalizedBatchId)}`
    : "/api/orders";
}

async function postOrdersAction(body, options = {}) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: buildAuthHeaders(options.accessToken, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(body),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to update orders.");
  }

  return payload;
}

export async function fetchWorkspaceOrders(options = {}) {
  const response = await fetch(buildOrdersUrl(options.batchId), {
    headers: buildAuthHeaders(options.accessToken, {
      Accept: "application/json",
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load orders.");
  }

  return payload;
}

export function importWorkspaceOrders({ target, items, batchId = null, accessToken = null }) {
  return postOrdersAction({
    action: "importClipboardItems",
    target,
    ...(batchId ? { batchId } : {}),
    items: Array.isArray(items) ? items : [],
  }, { accessToken });
}

export function addOrderItemToProductionBatch({ batchId, orderItemId, accessToken = null }) {
  return postOrdersAction({
    action: "addOrderItemToProductionBatch",
    batchId,
    orderItemId,
  }, { accessToken });
}

export function addOrdersToProductionBatch({ batchId, orderIds, accessToken = null }) {
  return postOrdersAction({
    action: "addOrdersToProductionBatch",
    batchId,
    orderIds: Array.isArray(orderIds) ? orderIds : [],
  }, { accessToken });
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest tests/unit/orders-api-route.test.js tests/unit/orders-api.test.js tests/unit/orders-store.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add api/orders.js api/_lib/orders-store.js src/orders-api.js tests/unit/orders-api-route.test.js tests/unit/orders-api.test.js tests/unit/orders-store.test.js
git commit -m "feat: add orders api"
```

---

### Task 4: Add Orders Workspace Pure Helpers

**Files:**
- Create: `src/orders-workspace.js`
- Test: `tests/unit/orders-workspace.test.js`

- [ ] **Step 1: Write failing pure helper tests**

Create `tests/unit/orders-workspace.test.js`:

```js
import { describe, expect, it } from "vitest";

describe("orders workspace helpers", () => {
  it("normalizes grouped order payloads and preserves selected order when possible", async () => {
    const { normalizeOrdersWorkspaceState } = await import("../../src/orders-workspace.js");
    const state = normalizeOrdersWorkspaceState({
      payload: {
        orders: [
          { id: "order:1001", items: [{ id: "item-1" }] },
          { id: "order:1002", items: [] },
        ],
      },
      selectedOrderId: "order:1001",
      checkedOrderIds: new Set(["order:1002", "missing"]),
    });

    expect(state.selectedOrderId).toBe("order:1001");
    expect([...state.checkedOrderIds]).toEqual(["order:1002"]);
  });

  it("selects the first order when the current selection is missing", async () => {
    const { normalizeOrdersWorkspaceState } = await import("../../src/orders-workspace.js");
    const state = normalizeOrdersWorkspaceState({
      payload: { orders: [{ id: "order:1001", items: [] }] },
      selectedOrderId: "missing",
      checkedOrderIds: new Set(),
    });

    expect(state.selectedOrderId).toBe("order:1001");
  });

  it("returns all checked ids for bulk add", async () => {
    const { getCheckedOrderIdsForBulkAction } = await import("../../src/orders-workspace.js");

    expect(getCheckedOrderIdsForBulkAction(new Set(["order:1", "", "order:2"]))).toEqual(["order:1", "order:2"]);
  });

  it("detects copyable saved design builds", async () => {
    const { getCopyableSavedBuild } = await import("../../src/orders-workspace.js");

    expect(getCopyableSavedBuild({
      design: {
        cachedBuild: { signature: "a", layout: {}, analysis: {} },
        completedSettingsSignature: "a",
      },
    })).toEqual({ signature: "a", layout: {}, analysis: {} });
    expect(getCopyableSavedBuild({ design: { cachedBuild: null } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest tests/unit/orders-workspace.test.js
```

Expected: fail because `src/orders-workspace.js` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/orders-workspace.js`:

```js
function normalizeOrder(order) {
  const id = typeof order?.id === "string" ? order.id.trim() : "";
  if (!id) {
    return null;
  }

  return {
    id,
    orderNumber: typeof order.orderNumber === "string" ? order.orderNumber : "",
    buyerName: typeof order.buyerName === "string" ? order.buyerName : "",
    itemCount: Number.isFinite(Number(order.itemCount)) ? Number(order.itemCount) : 0,
    activeBatchItemCount: Number.isFinite(Number(order.activeBatchItemCount)) ? Number(order.activeBatchItemCount) : 0,
    updatedAt: typeof order.updatedAt === "string" ? order.updatedAt : null,
    items: Array.isArray(order.items) ? order.items : [],
  };
}

export function normalizeOrdersWorkspaceState({ payload, selectedOrderId, checkedOrderIds }) {
  const orders = (Array.isArray(payload?.orders) ? payload.orders : [])
    .map(normalizeOrder)
    .filter(Boolean);
  const orderIds = new Set(orders.map((order) => order.id));
  const nextSelectedOrderId = orderIds.has(selectedOrderId)
    ? selectedOrderId
    : orders[0]?.id || null;
  const nextCheckedOrderIds = new Set(
    [...(checkedOrderIds instanceof Set ? checkedOrderIds : new Set())]
      .filter((id) => orderIds.has(id)),
  );

  return {
    orders,
    selectedOrderId: nextSelectedOrderId,
    checkedOrderIds: nextCheckedOrderIds,
  };
}

export function getCheckedOrderIdsForBulkAction(checkedOrderIds) {
  return [...(checkedOrderIds instanceof Set ? checkedOrderIds : new Set())]
    .filter((id) => typeof id === "string" && id.trim());
}

export function getSelectedGroupedOrder(orders, selectedOrderId) {
  return (Array.isArray(orders) ? orders : []).find((order) => order.id === selectedOrderId) || null;
}

export function getCopyableSavedBuild(item) {
  const design = item?.design;
  const candidates = [design?.cachedBuild, design?.previousCompletedBuild];
  const completedSignature = typeof design?.completedSettingsSignature === "string"
    ? design.completedSettingsSignature
    : typeof design?.savedSettingsSignature === "string"
      ? design.savedSettingsSignature
      : "";

  return candidates.find((build) => (
    build
    && typeof build === "object"
    && build.layout
    && build.analysis
    && (!completedSignature || build.signature === completedSignature)
  )) || null;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest tests/unit/orders-workspace.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/orders-workspace.js tests/unit/orders-workspace.test.js
git commit -m "feat: add orders workspace helpers"
```

---

### Task 5: Add Orders Workspace Markup And Navigation

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/e2e/orders-workspace.spec.js`

- [ ] **Step 1: Write failing Playwright smoke test**

Create `tests/e2e/orders-workspace.spec.js`:

```js
import { expect, test } from "@playwright/test";

test("Orders workspace is available from the left navigation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Orders" })).toBeVisible();
  await page.getByRole("button", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(page.getByLabel("Orders list")).toBeVisible();
  await expect(page.getByLabel("Selected order items")).toBeVisible();
});
```

- [ ] **Step 2: Run the failing smoke test**

Run after starting the dev server with `npm start`:

```bash
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: fail because the Orders nav/workspace does not exist.

- [ ] **Step 3: Add nav and workspace markup**

In `index.html`, add this nav button after the Production Batch button:

```html
<button
  id="ordersWorkspaceButton"
  class="workspace-nav-item"
  type="button"
  aria-label="Orders"
>
  <span class="workspace-nav-icon workspace-nav-icon-database-orders" aria-hidden="true"></span>
  <span class="workspace-nav-label">Orders</span>
</button>
```

Add this workspace section before `presetsWorkspace`:

```html
<section id="databaseOrdersWorkspace" class="workspace-view" aria-label="Orders workspace" hidden>
  <section class="production-workspace database-orders-workspace">
    <aside class="orders-panel database-orders-panel" aria-label="Orders list">
      <div class="batch-header">
        <h1>Orders</h1>
        <div class="batch-header-actions">
          <button
            id="ordersPasteButton"
            class="batch-primary-action"
            type="button"
            aria-label="Paste"
            title="Paste Etsy clipboard data into saved orders."
          >
            <span class="batch-tool-label">Paste</span>
          </button>
          <details id="ordersToolsMenu" class="batch-tools-menu">
            <summary class="batch-tools-toggle" aria-label="Orders tools"></summary>
            <div class="batch-tools-popover">
              <div class="batch-tools-actions" role="menu" aria-label="Orders actions">
                <div class="batch-tools-group">
                  <p class="batch-tools-heading">Orders</p>
                  <button id="addCheckedOrdersToBatchButton" class="batch-tool-button" type="button">
                    <span class="batch-tool-label">Add Checked to Production Batch</span>
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
      <p class="batch-tools-note">Browse non-archived saved orders and add selected work to the active production batch.</p>
      <div id="databaseOrdersList" class="database-orders-list" role="list" aria-label="Orders list"></div>
    </aside>
    <section class="editor-panel database-order-items-panel" aria-label="Selected order items">
      <header class="editor-header">
        <div>
          <p class="eyebrow">Saved Order</p>
          <h2 id="selectedDatabaseOrderTitle">No order selected</h2>
          <p id="selectedDatabaseOrderMeta" class="editor-meta">Paste orders or select an order to inspect saved designs.</p>
        </div>
      </header>
      <div class="editor-body">
        <section id="databaseOrderItemsList" class="database-order-items-list" aria-label="Selected order items"></section>
      </div>
    </section>
  </section>
</section>
```

- [ ] **Step 4: Wire navigation in `src/app.js`**

Add DOM references near the other workspace refs:

```js
const databaseOrdersWorkspace = document.querySelector("#databaseOrdersWorkspace");
const ordersWorkspaceButton = document.querySelector("#ordersWorkspaceButton");
const ordersPasteButton = document.querySelector("#ordersPasteButton");
const ordersToolsMenu = document.querySelector("#ordersToolsMenu");
const addCheckedOrdersToBatchButton = document.querySelector("#addCheckedOrdersToBatchButton");
const databaseOrdersList = document.querySelector("#databaseOrdersList");
const selectedDatabaseOrderTitle = document.querySelector("#selectedDatabaseOrderTitle");
const selectedDatabaseOrderMeta = document.querySelector("#selectedDatabaseOrderMeta");
const databaseOrderItemsList = document.querySelector("#databaseOrderItemsList");
```

Add Orders to workspace validation in `setActiveWorkspace`:

```js
activeWorkspace = ["orders", "databaseOrders", "presets", "fonts", "sizeGuides"].includes(workspace) ? workspace : "orders";
ordersWorkspace.hidden = activeWorkspace !== "orders";
databaseOrdersWorkspace.hidden = activeWorkspace !== "databaseOrders";
presetsWorkspace.hidden = activeWorkspace !== "presets";
fontsWorkspace.hidden = activeWorkspace !== "fonts";
sizeGuideWorkspace.hidden = activeWorkspace !== "sizeGuides";
orderWorkspaceButton.classList.toggle("is-active", activeWorkspace === "orders");
ordersWorkspaceButton.classList.toggle("is-active", activeWorkspace === "databaseOrders");
ordersWorkspaceButton.setAttribute("aria-pressed", String(activeWorkspace === "databaseOrders"));
```

Add click listener:

```js
ordersWorkspaceButton?.addEventListener("click", () => {
  setActiveWorkspace("databaseOrders");
});
```

- [ ] **Step 5: Add CSS**

Append near existing order/preset workspace styles in `src/styles.css`:

```css
.database-orders-workspace {
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 2.1fr);
}

.database-orders-list,
.database-order-items-list {
  display: grid;
  gap: 10px;
  align-content: start;
  min-height: 0;
  overflow: auto;
}

.database-order-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-left: 4px solid transparent;
  border-radius: 8px;
}

.database-order-row.is-selected,
.database-order-row:hover {
  background: #eaf7f6;
  border-color: #cce4e2;
  border-left-color: #00807c;
}

.database-order-checkbox {
  margin-top: 2px;
}

.database-order-button {
  appearance: none;
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 0;
  color: var(--ink);
  text-align: left;
  background: transparent;
  border: 0;
}

.database-order-title,
.database-order-item-title {
  overflow: hidden;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-order-meta,
.database-order-item-meta,
.database-order-item-text {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-order-item-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.database-order-item-header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
  min-width: 0;
}

.database-order-item-preview {
  min-height: 92px;
  border: 1px dashed #cdd7dc;
  border-radius: 8px;
  background: #f8fafb;
}
```

- [ ] **Step 6: Run smoke test**

Run:

```bash
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: pass for nav/workspace visibility.

- [ ] **Step 7: Commit**

```bash
git add index.html src/app.js src/styles.css tests/e2e/orders-workspace.spec.js
git commit -m "feat: add orders workspace shell"
```

---

### Task 6: Render Orders Data And Card Menus

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/unit/orders-workspace.test.js`
- Test: `tests/e2e/orders-workspace.spec.js`

- [ ] **Step 1: Extend Playwright test for rendered data**

Add to `tests/e2e/orders-workspace.spec.js`:

```js
test("Orders workspace renders grouped orders and item cards", async ({ page }) => {
  await page.addInitScript(() => {
    window.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ = "token-1";
  });
  await page.route("/api/batch-session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: null, orderItems: [] }),
    });
  });
  await page.route("/api/orders?batchId=batch-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [{
          id: "order:1001",
          orderNumber: "1001",
          buyerName: "Jamie",
          itemCount: 1,
          activeBatchItemCount: 0,
          items: [{
            id: "item-1",
            text: "Jamie\nRN",
            listingTitle: "Custom Badge",
            isInActiveBatch: false,
            design: { productionStatus: "in_progress", cachedBuild: null },
          }],
        }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Orders" }).click();

  await expect(page.getByText("#1001")).toBeVisible();
  await page.getByText("#1001").click();
  await expect(page.getByText("Jamie RN")).toBeVisible();
  await expect(page.getByRole("button", { name: /Order item actions/i })).toBeVisible();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: fail until render/load logic exists.

- [ ] **Step 3: Import API and helpers into `src/app.js`**

Add imports:

```js
import {
  addOrderItemToProductionBatch,
  addOrdersToProductionBatch,
  fetchWorkspaceOrders,
  importWorkspaceOrders,
} from "./orders-api.js";
import {
  getCheckedOrderIdsForBulkAction,
  getCopyableSavedBuild,
  getSelectedGroupedOrder,
  normalizeOrdersWorkspaceState,
} from "./orders-workspace.js";
```

Add state:

```js
let databaseOrders = [];
let selectedDatabaseOrderId = null;
let checkedDatabaseOrderIds = new Set();
let databaseOrdersLoading = false;
```

- [ ] **Step 4: Add load/render functions**

Add functions in `src/app.js` near other render helpers:

```js
async function loadDatabaseOrders() {
  if (!productionBatchAccessToken) {
    return;
  }

  databaseOrdersLoading = true;
  renderDatabaseOrdersWorkspace();
  try {
    const payload = await fetchWorkspaceOrders({
      batchId: productionBatchContext?.id || null,
      accessToken: productionBatchAccessToken,
    });
    const state = normalizeOrdersWorkspaceState({
      payload,
      selectedOrderId: selectedDatabaseOrderId,
      checkedOrderIds: checkedDatabaseOrderIds,
    });
    databaseOrders = state.orders;
    selectedDatabaseOrderId = state.selectedOrderId;
    checkedDatabaseOrderIds = state.checkedOrderIds;
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to load orders.", "error");
  } finally {
    databaseOrdersLoading = false;
    renderDatabaseOrdersWorkspace();
  }
}

function formatDatabaseOrderTitle(order) {
  return order?.orderNumber ? `#${order.orderNumber}` : "Imported order";
}

function formatDatabaseOrderItemText(item) {
  return String(item?.text || "").replace(/\s+/g, " ").trim() || "No personalization entered";
}

function renderDatabaseOrdersWorkspace() {
  if (!databaseOrdersList || !databaseOrderItemsList) {
    return;
  }

  databaseOrdersList.replaceChildren();
  if (databaseOrdersLoading) {
    const loading = document.createElement("p");
    loading.className = "order-empty";
    loading.textContent = "Loading orders...";
    databaseOrdersList.append(loading);
  } else if (!databaseOrders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "No non-archived orders are available. Paste Etsy orders to save them here.";
    databaseOrdersList.append(empty);
  }

  for (const order of databaseOrders) {
    const row = document.createElement("article");
    row.className = "database-order-row";
    row.classList.toggle("is-selected", order.id === selectedDatabaseOrderId);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "database-order-checkbox";
    checkbox.checked = checkedDatabaseOrderIds.has(order.id);
    checkbox.setAttribute("aria-label", `Select ${formatDatabaseOrderTitle(order)}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        checkedDatabaseOrderIds.add(order.id);
      } else {
        checkedDatabaseOrderIds.delete(order.id);
      }
      renderDatabaseOrdersWorkspace();
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "database-order-button";
    button.innerHTML = `
      <span class="database-order-title"></span>
      <span class="database-order-meta"></span>
    `;
    button.querySelector(".database-order-title").textContent = formatDatabaseOrderTitle(order);
    button.querySelector(".database-order-meta").textContent = `${order.buyerName || "No buyer"} | ${order.itemCount} item${order.itemCount === 1 ? "" : "s"} | ${order.activeBatchItemCount} in batch`;
    button.addEventListener("click", () => {
      selectedDatabaseOrderId = order.id;
      renderDatabaseOrdersWorkspace();
    });

    row.append(checkbox, button);
    databaseOrdersList.append(row);
  }

  renderSelectedDatabaseOrderItems();
  if (addCheckedOrdersToBatchButton) {
    addCheckedOrdersToBatchButton.disabled = checkedDatabaseOrderIds.size === 0;
  }
}

function renderSelectedDatabaseOrderItems() {
  const order = getSelectedGroupedOrder(databaseOrders, selectedDatabaseOrderId);
  databaseOrderItemsList.replaceChildren();
  selectedDatabaseOrderTitle.textContent = order ? formatDatabaseOrderTitle(order) : "No order selected";
  selectedDatabaseOrderMeta.textContent = order
    ? `${order.buyerName || "No buyer"} | ${order.itemCount} item${order.itemCount === 1 ? "" : "s"}`
    : "Paste orders or select an order to inspect saved designs.";

  if (!order) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "Select an order to inspect its saved designs.";
    databaseOrderItemsList.append(empty);
    return;
  }

  for (const item of order.items) {
    const card = document.createElement("article");
    card.className = "database-order-item-card";
    card.innerHTML = `
      <header class="database-order-item-header">
        <div>
          <p class="database-order-item-title"></p>
          <p class="database-order-item-meta"></p>
        </div>
        <details class="editor-tools-menu database-order-item-menu">
          <summary class="editor-tools-toggle" aria-label="Order item actions"></summary>
          <div class="editor-tools-popover">
            <div class="editor-tools-actions" role="menu" aria-label="Order item actions">
              <button class="batch-tool-button" type="button" data-action="copy-design">
                <span class="batch-tool-label">Copy Design</span>
              </button>
              <button class="batch-tool-button" type="button" data-action="add-to-batch">
                <span class="batch-tool-label">Add to Production Batch</span>
              </button>
            </div>
          </div>
        </details>
      </header>
      <p class="database-order-item-text"></p>
      <div class="database-order-item-preview"></div>
    `;
    card.querySelector(".database-order-item-title").textContent = item.listingTitle || item.listingId || "Order item";
    card.querySelector(".database-order-item-meta").textContent = item.isInActiveBatch ? "Already in production batch" : "Not in production batch";
    card.querySelector(".database-order-item-text").textContent = formatDatabaseOrderItemText(item);
    card.querySelector(".database-order-item-preview").textContent = getCopyableSavedBuild(item)
      ? "Saved export-ready design available."
      : "Design must be completed before copying.";
    const addButton = card.querySelector('[data-action="add-to-batch"]');
    addButton.disabled = Boolean(item.isInActiveBatch);
    addButton.addEventListener("click", () => {
      void addDatabaseOrderItemToBatch(item.id);
    });
    card.querySelector('[data-action="copy-design"]').addEventListener("click", () => {
      void copyDatabaseOrderItemDesign(item);
    });
    registerOutsideDismissableDetailsMenu(card.querySelector(".database-order-item-menu"));
    databaseOrderItemsList.append(card);
  }
}
```

- [ ] **Step 5: Load orders when opening workspace**

In `setActiveWorkspace`, add:

```js
if (activeWorkspace === "databaseOrders") {
  void loadDatabaseOrders();
}
```

After `restoreInitialBatchState`, call:

```js
if (activeWorkspace === "databaseOrders") {
  void loadDatabaseOrders();
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest tests/unit/orders-workspace.test.js
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/app.js src/styles.css tests/e2e/orders-workspace.spec.js
git commit -m "feat: render orders workspace"
```

---

### Task 7: Wire Durable Paste And Add-To-Batch Actions

**Files:**
- Modify: `src/app.js`
- Modify: `tests/e2e/orders-workspace.spec.js`

- [ ] **Step 1: Extend Playwright tests for paste semantics**

Add tests:

```js
test("Orders paste writes orders without adding to production batch", async ({ page }) => {
  await page.addInitScript(() => {
    window.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ = "token-1";
    navigator.clipboard.writeText(JSON.stringify({
      items: [{ orderNumber: "1001", transactionId: "tx-1", personalization: "Jamie", buyerName: "Jamie" }],
    }));
  });
  let ordersPostBody = null;
  await page.route("/api/orders", async (route) => {
    ordersPostBody = JSON.parse(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        importedCount: 1,
        addedToBatchCount: 0,
        skippedCount: 0,
        orders: [{ id: "order:1001", orderNumber: "1001", buyerName: "Jamie", itemCount: 1, activeBatchItemCount: 0, items: [] }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Orders" }).click();
  await page.getByRole("button", { name: "Paste" }).click();

  await expect.poll(() => ordersPostBody).toMatchObject({
    action: "importClipboardItems",
    target: "orders",
  });
});

test("item menu adds one item to the production batch", async ({ page }) => {
  await page.addInitScript(() => {
    window.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ = "token-1";
  });
  let addBody = null;
  await page.route("/api/orders?batchId=batch-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [{
          id: "order:1001",
          orderNumber: "1001",
          buyerName: "Jamie",
          itemCount: 1,
          activeBatchItemCount: 0,
          items: [{ id: "item-1", text: "Jamie", isInActiveBatch: false, design: { cachedBuild: null } }],
        }],
      }),
    });
  });
  await page.route("/api/orders", async (route) => {
    addBody = JSON.parse(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ importedCount: 0, addedToBatchCount: 1, skippedCount: 0, orders: [] }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Orders" }).click();
  await page.getByText("#1001").click();
  await page.getByRole("button", { name: "Order item actions" }).click();
  await page.getByRole("button", { name: "Add to Production Batch" }).click();

  await expect.poll(() => addBody).toMatchObject({
    action: "addOrderItemToProductionBatch",
    batchId: "batch-1",
    orderItemId: "item-1",
  });
});
```

Ensure these tests share the route mocks for `/api/batch-session` and `/api/production-batch?batchId=batch-1` from Task 6, either by helper functions in the test file or inline route setup.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: fail until action handlers are wired.

- [ ] **Step 3: Add Orders paste handler**

In `src/app.js`, add:

```js
async function importOrdersWorkspaceFromClipboard() {
  if (!navigator.clipboard?.readText) {
    updateWorkflowAlert("Clipboard import is not available in this browser context.", "error");
    return;
  }

  ordersPasteButton.disabled = true;
  try {
    const clipboardText = await navigator.clipboard.readText();
    const importedItems = parseImportedItems(clipboardText, { getPresetIdForListingId });
    const payload = await importWorkspaceOrders({
      target: "orders",
      items: importedItems.map((item) => ({
        ...item,
        source: {
          ...item.source,
          importSource: IMPORT_SOURCE_TAG,
        },
      })),
      accessToken: productionBatchAccessToken,
    });
    const state = normalizeOrdersWorkspaceState({
      payload,
      selectedOrderId: selectedDatabaseOrderId,
      checkedOrderIds: checkedDatabaseOrderIds,
    });
    databaseOrders = state.orders;
    selectedDatabaseOrderId = state.selectedOrderId;
    checkedDatabaseOrderIds = state.checkedOrderIds;
    renderDatabaseOrdersWorkspace();
    updateWorkflowAlert(`Imported ${payload.importedCount} order${payload.importedCount === 1 ? "" : "s"} to Orders.`, "success");
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Clipboard import failed.", "error");
  } finally {
    ordersPasteButton.disabled = false;
  }
}
```

- [ ] **Step 4: Update Production Batch paste to use immediate API import**

In `importFromClipboard`, replace local-only creation and autosave with immediate import:

```js
const clipboardText = await navigator.clipboard.readText();
const importedItems = parseImportedItems(clipboardText, { getPresetIdForListingId });
const payload = await importWorkspaceOrders({
  target: "productionBatch",
  batchId: productionBatchContext?.id,
  items: importedItems.map((item) => ({
    ...item,
    source: {
      ...item.source,
      importSource: IMPORT_SOURCE_TAG,
    },
  })),
  accessToken: productionBatchAccessToken,
});
const refreshedSnapshot = productionBatchContext?.id
  ? await fetchProductionBatchSnapshot(productionBatchContext.id, productionBatchAccessToken)
  : null;
if (refreshedSnapshot) {
  applyPersistedBatchState(refreshedSnapshot);
  lastProductionBatchSaveKey = buildProductionBatchSaveKey(buildProductionBatchSnapshot());
}
updateWorkflowAlert(`Imported ${payload.importedCount} Etsy design${payload.importedCount === 1 ? "" : "s"} and added ${payload.addedToBatchCount} to the production batch.`, "success");
renderOrderList();
```

Keep the existing button disabled/label reset behavior.

- [ ] **Step 5: Add item and bulk add handlers**

Add:

```js
async function addDatabaseOrderItemToBatch(orderItemId) {
  if (!productionBatchContext?.id) {
    updateWorkflowAlert("No active production batch is available.", "error");
    return;
  }

  try {
    const payload = await addOrderItemToProductionBatch({
      batchId: productionBatchContext.id,
      orderItemId,
      accessToken: productionBatchAccessToken,
    });
    const state = normalizeOrdersWorkspaceState({
      payload,
      selectedOrderId: selectedDatabaseOrderId,
      checkedOrderIds: checkedDatabaseOrderIds,
    });
    databaseOrders = state.orders;
    selectedDatabaseOrderId = state.selectedOrderId;
    checkedDatabaseOrderIds = state.checkedOrderIds;
    renderDatabaseOrdersWorkspace();
    const refreshedSnapshot = await fetchProductionBatchSnapshot(productionBatchContext.id, productionBatchAccessToken);
    applyPersistedBatchState(refreshedSnapshot);
    renderOrderList();
    updateWorkflowAlert(payload.addedToBatchCount ? "Added order item to Production Batch." : "Order item is already in Production Batch.", "success");
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to add order item to Production Batch.", "error");
  }
}

async function addCheckedDatabaseOrdersToBatch() {
  const orderIds = getCheckedOrderIdsForBulkAction(checkedDatabaseOrderIds);
  if (!orderIds.length) {
    updateWorkflowAlert("Check one or more orders first.", "pending");
    return;
  }
  if (!productionBatchContext?.id) {
    updateWorkflowAlert("No active production batch is available.", "error");
    return;
  }

  try {
    const payload = await addOrdersToProductionBatch({
      batchId: productionBatchContext.id,
      orderIds,
      accessToken: productionBatchAccessToken,
    });
    const state = normalizeOrdersWorkspaceState({
      payload,
      selectedOrderId: selectedDatabaseOrderId,
      checkedOrderIds: checkedDatabaseOrderIds,
    });
    databaseOrders = state.orders;
    selectedDatabaseOrderId = state.selectedOrderId;
    checkedDatabaseOrderIds = state.checkedOrderIds;
    renderDatabaseOrdersWorkspace();
    const refreshedSnapshot = await fetchProductionBatchSnapshot(productionBatchContext.id, productionBatchAccessToken);
    applyPersistedBatchState(refreshedSnapshot);
    renderOrderList();
    updateWorkflowAlert(`Added ${payload.addedToBatchCount} order item${payload.addedToBatchCount === 1 ? "" : "s"} to Production Batch.`, "success");
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to add checked orders to Production Batch.", "error");
  }
}
```

Wire listeners:

```js
ordersPasteButton?.addEventListener("click", importOrdersWorkspaceFromClipboard);
addCheckedOrdersToBatchButton?.addEventListener("click", () => {
  ordersToolsMenu?.removeAttribute("open");
  void addCheckedDatabaseOrdersToBatch();
});
```

- [ ] **Step 6: Add copy design handler**

Add:

```js
async function copyDatabaseOrderItemDesign(item) {
  const savedBuild = getCopyableSavedBuild(item);
  if (!savedBuild) {
    updateWorkflowAlert("Complete this design before copying it from Orders.", "error");
    return;
  }

  try {
    const svgSource = await requestSvgSource({
      layouts: [buildExportPayload(savedBuild.layout, savedBuild.analysis, item.source)],
    });
    await copySvgToClipboard(svgSource);
    updateWorkflowAlert("Copied saved design.", "success");
  } catch (error) {
    updateWorkflowAlert(error instanceof Error ? error.message : "Unable to copy saved design.", "error");
  }
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest tests/unit/etsy-import.test.js tests/unit/orders-api.test.js tests/unit/orders-workspace.test.js
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/app.js tests/e2e/orders-workspace.spec.js
git commit -m "feat: wire durable orders imports"
```

---

### Task 8: Verification And Polish

**Files:**
- Modify as needed based on test/browser findings.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: pass.

- [ ] **Step 2: Run Orders e2e test**

Run:

```bash
npx playwright test tests/e2e/orders-workspace.spec.js
```

Expected: pass.

- [ ] **Step 3: Run full e2e if time allows**

Run:

```bash
npm run test:e2e
```

Expected: pass. If unrelated existing failures occur, record them with exact test names and continue only after confirming they are unrelated.

- [ ] **Step 4: Start dev server for browser verification**

Run:

```bash
npm start
```

Read the printed `Badge reel layout tool: http://localhost:...` line and use that exact URL.

- [ ] **Step 5: Verify in browser**

Use Browser or Playwright to check:

- left nav includes `Production Batch`, `Orders`, `Presets`, `Fonts`, and `Size Guides`
- Orders page does not overlap at desktop width
- Orders row checkboxes do not trigger row selection
- order item menus open and close correctly
- disabled add-to-batch state is readable for items already in batch
- paste success and failure messages use the existing floating toast style

- [ ] **Step 6: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
git diff
```

Expected: only planned feature files changed.

- [ ] **Step 7: Final commit**

If Task 8 required any fixes:

```bash
git add index.html src/app.js src/styles.css tests/e2e/orders-workspace.spec.js tests/unit/orders-workspace.test.js
git commit -m "fix: polish orders workspace"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan includes the new `Orders` nav/page, non-archived order listing, saved design cards, item ellipsis actions, order-row checkboxes, bulk checked add-to-batch, and the different durable paste behavior for Orders versus Production Batch.
- Placeholder scan: No `TBD`, `TODO`, "implement later", or vague testing instructions are present.
- Type consistency: API action names are consistent across route, client, and UI: `importClipboardItems`, `addOrderItemToProductionBatch`, and `addOrdersToProductionBatch`.
