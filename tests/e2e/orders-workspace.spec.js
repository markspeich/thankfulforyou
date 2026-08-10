import { expect, test } from "playwright/test";

function installSupabaseSession(page) {
  return page.addInitScript(() => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: "token-1",
              user: {
                id: "user-1",
                email: "mark@example.com",
              },
            },
          },
          error: null,
        }),
        onAuthStateChange: () => ({
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        }),
      },
    };
  });
}

function installRefreshableSupabaseSession(page) {
  return page.addInitScript(() => {
    window.__APP_CONFIG__ = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon-key" };
    let session = { access_token: "expired-token", refresh_token: "refresh-1", user: { id: "user-1", email: "mark@example.com" } };
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        refreshSession: async () => {
          window.ordersRefreshCalls = (window.ordersRefreshCalls || 0) + 1;
          session = { ...session, access_token: "fresh-token", refresh_token: "refresh-2" };
          return { data: { session }, error: null };
        },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    };
  });
}

function installClipboardText(page, text) {
  return page.addInitScript((clipboardText) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async () => {},
      },
    });
  }, text);
}

function installClipboardReadError(page, { name, message }) {
  return page.addInitScript(({ errorName, errorMessage }) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          throw new DOMException(errorMessage, errorName);
        },
        writeText: async () => {},
      },
    });
  }, { errorName: name, errorMessage: message });
}

async function installProductionBatchRoutes(page, options = {}) {
  const { orderItems = [], onGet = null, onPut = null } = options;
  let productionBatchSnapshot = {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: orderItems[0]?.id || null,
    orderItems,
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });

  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await onGet?.(productionBatchSnapshot);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(productionBatchSnapshot),
    });
  });

  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    productionBatchSnapshot = route.request().postDataJSON()?.snapshot || productionBatchSnapshot;
    await onPut?.(productionBatchSnapshot);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(productionBatchSnapshot),
    });
  });
}

function buildOrdersPayload() {
  return {
    orders: [
      {
        id: "order:1001",
        shipByDate: "2026-07-24",
        orderNumber: "1001",
        buyerName: "Ada Lovelace",
        isInActiveBatch: false,
        items: [
          {
            id: "item-1",
            listingTitle: "Custom badge reel",
            isInActiveBatch: false,
            source: {
              colorName: "Red Glitter",
              quantity: "2",
              listingImageUrl75x75: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='75' height='75'%3E%3Crect width='75' height='75' fill='%23d92d20'/%3E%3C/svg%3E",
            },
            design: {
              text: "Ada RN",
              lines: [
                { lineIndex: 0, text: "Ada", fontId: "skywalk" },
                { lineIndex: 1, text: "RN", fontId: "somekind" },
              ],
              cachedBuild: {
                signature: "sig-1",
                layout: {
                  widthMm: 56,
                  heightMm: 32,
                  backingMm: 3.1,
                  letters: [],
                  lines: [],
                },
                analysis: {
                  connectedComponents: 1,
                  backingPath: "M2 2H54V30H2Z",
                  facePath: "M12 11H44V21H12Z",
                },
              },
            },
          },
          {
            id: "item-2",
            listingTitle: "Badge buddy",
            isInActiveBatch: true,
            design: {
              text: "PICU",
              lines: [{ lineIndex: 0, text: "PICU", fontId: "somekind" }],
            },
          },
        ],
      },
      {
        id: "order:1002",
        orderNumber: "1002",
        buyerName: "Grace Hopper",
        isInActiveBatch: true,
        items: [
          {
            id: "item-3",
            listingTitle: "Name badge reel",
            isInActiveBatch: true,
            design: {
              text: "Grace",
              lines: [{ lineIndex: 0, text: "Grace", fontId: "candlepin" }],
            },
          },
        ],
      },
    ],
  };
}

function buildOrdersPayloadWithImportedOrder() {
  const payload = buildOrdersPayload();
  return {
    ...payload,
    importedOrderItemCount: 1,
    addedOrderItemCount: 0,
    skippedOrderItemCount: 0,
    alreadyInBatchCount: 0,
    orders: [
      ...payload.orders,
      {
        id: "order:1003",
        orderNumber: "1003",
        buyerName: "Katherine Johnson",
        isInActiveBatch: false,
        items: [
          {
            id: "item-1003",
            listingTitle: "Custom badge reel",
            isInActiveBatch: false,
            design: {
              text: "Katherine RN",
              lines: [{ lineIndex: 0, text: "Katherine RN", fontId: "candlepin" }],
            },
          },
        ],
      },
    ],
  };
}

function buildScrollableOrdersPayload() {
  const firstOrder = buildOrdersPayload().orders[0];
  return {
    orders: Array.from({ length: 30 }, (_, index) => {
      const orderNumber = String(2001 + index);
      return {
        ...firstOrder,
        id: `order:${orderNumber}`,
        orderNumber,
        buyerName: `Buyer ${index + 1}`,
        isInActiveBatch: index % 3 === 0,
        items: firstOrder.items.map((item, itemIndex) => ({
          ...item,
          id: `item-${orderNumber}-${itemIndex + 1}`,
        })),
      };
    }),
  };
}

async function installOrdersWorkspaceRoutes(page, options = {}) {
  const {
    getDelayMs = 0,
    onGet = null,
    onPost = null,
    ordersPayload = buildOrdersPayload(),
    posts = [],
    postStatus = 200,
    postBody = null,
    postDelayMs = 0,
  } = options;

  await page.route("**/api/orders**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const post = JSON.parse(request.postData() || "{}");
      posts.push(post);
      onPost?.(post, request);
      const delayMs = typeof postDelayMs === "function" ? postDelayMs(post) : postDelayMs;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fulfill({
        status: typeof postStatus === "function" ? postStatus(post, request) : postStatus,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(typeof postBody === "function" ? postBody(post) : postBody || {
          ...buildOrdersPayload(),
          importedOrderItemCount: 1,
          addedOrderItemCount: 1,
          skippedOrderItemCount: 0,
          alreadyInBatchCount: 0,
        }),
      });
      return;
    }

    const url = new URL(request.url());
    if (url.searchParams.get("view") === "detail") {
      const orderId = url.searchParams.get("orderId");
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ order: (ordersPayload.orders || []).find((order) => order.id === orderId) || null }),
      });
      return;
    }

    if (getDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, getDelayMs));
    }
    onGet?.(request);
    const status = url.searchParams.get("status") || "open";
    const batch = url.searchParams.get("batch") || "all";
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const filteredPayload = {
      ...ordersPayload,
      orders: (ordersPayload.orders || []).filter((order) => {
        const orderStatus = order.status || "open";
        if (status !== "all" && orderStatus !== status) return false;
        if (batch === "inBatch" && !order.isInActiveBatch) return false;
        if (batch === "notInBatch" && order.isInActiveBatch) return false;
        return !search || JSON.stringify(order).toLowerCase().includes(search);
      }),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(filteredPayload),
    });
  });
}

function buildClipboardPayload() {
  return JSON.stringify({
    items: [
      {
        orderNumber: "1003",
        buyerName: "Katherine Johnson",
        listingId: "listing-1",
        transactionId: "txn-1003",
        personalization: "Katherine RN",
      },
    ],
  });
}

function buildEmptyClipboardPayload() {
  return JSON.stringify({
    items: [
      {
        orderNumber: "1004",
        buyerName: "Empty Clipboard",
        listingId: "listing-empty",
        transactionId: "txn-empty",
        personalization: "",
      },
    ],
  });
}

function buildDuplicateBatchOrderItem() {
  return {
    id: "local-duplicate",
    text: "Katherine RN",
    status: "captured",
    source: {
      orderNumber: "1003",
      buyerName: "Katherine Johnson",
      listingId: "listing-1",
      transactionId: "txn-1003",
    },
    settings: {
      text: "Katherine RN",
      presetId: "candlepin",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [{ text: "Katherine RN", fontId: "candlepin" }],
    },
  };
}

function buildAdaProductionBatchOrderItem() {
  return {
    id: "item-1",
    text: "Ada RN",
    status: "not-started",
    source: {
      orderNumber: "1001",
      buyerName: "Ada Lovelace",
      listingId: "listing-ada",
      transactionId: "item-1",
    },
    settings: {
      text: "Ada RN",
      presetId: "preset-b7d2e9f4c318",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [
        { text: "Ada", fontId: "skywalk" },
        { text: "RN", fontId: "somekind" },
      ],
    },
  };
}

async function gotoAfterBatchLoads(page) {
  const batchReady = page.waitForResponse((response) => (
    response.url().includes("/api/production-batch?batchId=batch-1") && response.status() === 200
  ));
  await page.goto("/");
  await batchReady;
}

test("opens the Orders workspace shell by default", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);

  await page.goto("/");

  const ordersNavButton = page.getByRole("button", { name: "Orders", exact: true });
  await expect(page.locator(".workspace-nav .workspace-nav-item").first()).toHaveAttribute("aria-label", "Orders");
  await expect(ordersNavButton).toBeVisible();

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersNavButton).toHaveAttribute("aria-pressed", "true");
  await expect(ordersWorkspace.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(ordersWorkspace.getByLabel("Orders list")).toBeVisible();
  await expect(ordersWorkspace.getByLabel("Selected order items")).toBeVisible();
});

test("updates the URL when switching top-level workspaces", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  await gotoAfterBatchLoads(page);

  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await expect(page).toHaveURL(/\/production-batch$/);

  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await expect(page).toHaveURL(/\/presets$/);

  await page.getByRole("button", { name: "Fonts", exact: true }).click();
  await expect(page).toHaveURL(/\/fonts$/);

  await page.getByRole("button", { name: "Size Guides", exact: true }).click();
  await expect(page).toHaveURL(/\/size-guides$/);

  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
});

test("opens a bookmarked production batch design URL", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page, {
    orderItems: [
      buildAdaProductionBatchOrderItem(),
      buildDuplicateBatchOrderItem(),
    ],
  });

  await page.goto("/production-batch/local-duplicate");

  await expect(page.getByRole("region", { name: "Order items workspace" })).toBeVisible();
  await expect(page.locator("#textInput")).toHaveValue("Katherine RN");
  await expect(page.locator("#orderList .order-row.active")).toContainText("Katherine RN");
});

test("shows imported customer font selections beneath Quantity and hides them when absent", async ({ page }) => {
  await installSupabaseSession(page);
  const amazonOrder = buildAdaProductionBatchOrderItem();
  amazonOrder.source.customerFontSelections = [
    { lineIndex: 1, name: "Somekind" },
    { lineIndex: 0, name: "Skywalk" },
  ];
  await installProductionBatchRoutes(page, {
    orderItems: [amazonOrder, buildDuplicateBatchOrderItem()],
  });

  await page.goto("/production-batch/item-1");

  const customerFonts = page.locator("#customerFontSelections");
  await expect(customerFonts).toBeVisible();
  await expect(customerFonts.evaluate((element) => element.previousElementSibling?.id)).resolves.toBe("importedQuantityField");
  await expect(customerFonts.locator(".customer-font-selection")).toHaveText([
    "Line 1 Font: Skywalk",
    "Line 2 Font: Somekind",
  ]);

  await page.locator("#orderList .order-row").filter({ hasText: "Katherine RN" }).locator(".order-item").click();
  await expect(customerFonts).toBeHidden();
  await expect(customerFonts.locator(".customer-font-selection")).toHaveCount(0);
});

test("updates and opens bookmarked Orders workspace order URLs", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  await page.goto("/orders/order%3A1002");

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersWorkspace.getByRole("heading", { name: "Order 1002" })).toBeVisible();
  await expect(ordersWorkspace.locator(".database-order-row.is-selected")).toContainText("Order 1002");

  await ordersWorkspace
    .locator(".database-order-row")
    .filter({ hasText: "Order 1001" })
    .getByRole("button")
    .click();

  await expect(page).toHaveURL(/\/orders\/order%3A1001$/);
});

test("hydrates a bookmarked Orders detail that is outside the loaded compact page", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const detail = buildOrdersPayload().orders[1];
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload: { orders: [buildOrdersPayload().orders[0]], nextCursor: "page-2", hasMore: true },
  });
  await page.route("**/api/orders?*view=detail*", async (route) => {
    await route.fulfill({ json: { order: detail } });
  });

  await page.goto("/orders/order%3A1002");

  const workspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(workspace.getByRole("heading", { name: "Order 1002" })).toBeVisible();
  await expect(workspace.locator(".database-order-row")).toHaveCount(1);
  await expect(workspace.locator(".database-order-row")).toContainText("Order 1001");
});

test("keeps the latest selected Orders detail when earlier detail requests finish late", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const compactPayload = buildOrdersPayload();
  compactPayload.orders[1] = { ...compactPayload.orders[1], buyerName: "Compact placeholder" };
  await installOrdersWorkspaceRoutes(page, { ordersPayload: compactPayload });
  const releases = new Map();
  const fulfilledOrderIds = [];
  await page.route("**/api/orders?*view=detail*", async (route) => {
    const orderId = new URL(route.request().url()).searchParams.get("orderId");
    await new Promise((resolve) => releases.set(orderId, resolve));
    const order = buildOrdersPayload().orders.find((candidate) => candidate.id === orderId);
    await route.fulfill({ json: { order } });
    fulfilledOrderIds.push(orderId);
  });

  await page.goto("/orders");
  const workspace = page.getByRole("region", { name: "Orders workspace" });
  await expect.poll(() => releases.has("order:1001")).toBe(true);
  await workspace.getByRole("button", { name: "Order 1002" }).click();
  await expect.poll(() => releases.has("order:1002")).toBe(true);
  releases.get("order:1002")();
  await expect(workspace.getByRole("heading", { name: "Order 1002" })).toBeVisible();
  await expect(workspace.locator(".database-order-items-panel .editor-meta")).toContainText("Grace Hopper");
  releases.get("order:1001")();
  await expect.poll(() => fulfilledOrderIds.includes("order:1001")).toBe(true);
  await expect(workspace.locator(".database-order-items-panel .editor-meta")).toContainText("Grace Hopper");
});

test("does not let a stale selected Orders detail overwrite an add-to-batch delta", async ({ page }) => {
  await installSupabaseSession(page);
  const productionBatchOrderItems = [];
  await installProductionBatchRoutes(page, { orderItems: productionBatchOrderItems });
  const posts = [];
  await installOrdersWorkspaceRoutes(page, {
    posts,
    onPost(post) {
      if (post.action === "addOrdersToProductionBatch") {
        productionBatchOrderItems.push(buildAdaProductionBatchOrderItem());
      }
    },
    postBody: {
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    },
  });
  let releaseStaleDetail;
  let staleDetailFulfilled = false;
  const staleDetail = buildOrdersPayload().orders[0];
  await page.route("**/api/orders?*view=detail*", async (route) => {
    await new Promise((resolve) => { releaseStaleDetail = resolve; });
    await route.fulfill({ json: { order: staleDetail } });
    staleDetailFulfilled = true;
  });

  await page.goto("/");

  const workspace = page.getByRole("region", { name: "Orders workspace" });
  await expect.poll(() => typeof releaseStaleDetail).toBe("function");
  await workspace.getByLabel("Order actions", { exact: true }).click();
  await workspace.getByRole("menu", { name: "Selected order actions" }).getByRole("button", { name: "Add to Production Batch" }).click();
  await expect.poll(() => posts.some((post) => post.action === "addOrdersToProductionBatch")).toBe(true);
  await expect(workspace.locator(".database-order-item-status")).toHaveText(["Already in active batch", "Already in active batch"]);

  releaseStaleDetail();
  await expect.poll(() => staleDetailFulfilled).toBe(true);
  await expect(workspace.locator(".database-order-item-status")).toHaveText(["Already in active batch", "Already in active batch"]);
});

test("does not restore a filtered-out selected order from a stale detail after adding it to the batch", async ({ page }) => {
  await installSupabaseSession(page);
  const productionBatchOrderItems = [];
  await installProductionBatchRoutes(page, { orderItems: productionBatchOrderItems });
  const posts = [];
  await installOrdersWorkspaceRoutes(page, {
    posts,
    onPost(post) {
      if (post.action === "addOrdersToProductionBatch") {
        productionBatchOrderItems.push(buildAdaProductionBatchOrderItem());
      }
    },
    postBody: {
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    },
  });
  const detailReleases = [];
  const fulfilledDetailIndexes = [];
  const staleDetail = buildOrdersPayload().orders[0];
  await page.route("**/api/orders?*view=detail*", async (route) => {
    const detailIndex = detailReleases.length;
    await new Promise((resolve) => { detailReleases.push(resolve); });
    await route.fulfill({ json: { order: staleDetail } });
    fulfilledDetailIndexes.push(detailIndex);
  });

  await page.goto("/");

  const workspace = page.getByRole("region", { name: "Orders workspace" });
  await expect.poll(() => detailReleases).toHaveLength(1);
  await page.locator("#databaseOrdersBatchFilter").selectOption("notInBatch");
  await expect(workspace.getByRole("button", { name: "Order 1001" })).toBeVisible();
  await expect.poll(() => detailReleases).toHaveLength(2);
  await workspace.getByLabel("Order actions", { exact: true }).click();
  await workspace.getByRole("menu", { name: "Selected order actions" }).getByRole("button", { name: "Add to Production Batch" }).click();
  await expect.poll(() => posts.some((post) => post.action === "addOrdersToProductionBatch")).toBe(true);
  await expect(workspace.getByText("No order selected.")).toBeVisible();

  detailReleases[1]();
  await expect.poll(() => fulfilledDetailIndexes).toContain(1);
  await expect(workspace.getByText("No order selected.")).toBeVisible();
});

test("identifies Etsy and Amazon in selected imported order headers", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const ordersPayload = buildOrdersPayload();
  ordersPayload.orders.push({
    id: "item:amazon-order-item:1234567890",
    orderNumber: null,
    buyerName: null,
    status: "open",
    isInActiveBatch: false,
    items: [{
      id: "amazon-order-item:1234567890",
      orderNumber: null,
      buyerName: null,
      listingTitle: "Badge Reel - Custom",
      isInActiveBatch: false,
      source: {
        marketplace: "amazon",
        orderNumber: "114-1234567-1234567",
        listingTitle: "Badge Reel - Custom",
      },
      design: {
        text: "Slave Driver",
        lines: [{ lineIndex: 0, text: "Slave Driver", fontId: "candlepin" }],
      },
    }],
  });
  await installOrdersWorkspaceRoutes(page, { ordersPayload });

  await page.goto("/orders/order%3A1001");

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  const selectedHeading = ordersWorkspace.locator(".database-order-items-panel .editor-header h2");
  await expect(selectedHeading).toHaveText("Order 1001");
  await expect(selectedHeading.getByRole("img", { name: "Etsy" })).toBeVisible();

  await ordersWorkspace
    .locator(".database-order-row")
    .filter({ hasText: "Manual Order: Slave Driver" })
    .getByRole("button")
    .click();

  await expect(selectedHeading).toHaveText("Order 114-1234567-1234567");
  await expect(selectedHeading.getByRole("img", { name: "Amazon" })).toBeVisible();
  await expect(selectedHeading).not.toContainText("Manual Order:");
});

test("renders grouped database orders and selected order item cards", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  const batchReady = page.waitForResponse((response) => (
    response.url().includes("/api/production-batch?batchId=batch-1") && response.status() === 200
  ));
  await page.goto("/");
  await batchReady;
  await page.getByRole("button", { name: "Orders", exact: true }).click();

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1001/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1002/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /In batch/ })).toBeVisible();
  const firstOrderRow = ordersWorkspace.locator(".database-order-row").filter({ hasText: "Order 1001" });
  await expect(firstOrderRow.locator(".database-order-row-image-stack")).toHaveCount(1);
  await expect(firstOrderRow.locator(".database-order-row-thumbnail")).toHaveCount(2);
  await expect(firstOrderRow.locator(".database-order-row-thumbnail").first()).toHaveCSS("width", "64px");
  await expect(firstOrderRow.locator(".database-order-row-thumbnail").first()).toHaveCSS("height", "64px");
  await expect(firstOrderRow.getByRole("img", { name: "Custom badge reel" })).toBeVisible();
  await expect(firstOrderRow.locator(".database-order-status")).toHaveText("Open");
  await expect(firstOrderRow.locator(".database-order-row-meta-line")).toHaveCount(4);
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(0)).toHaveText("BuyerAda Lovelace");
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(1)).toHaveText("Ship byJul 24, 2026");
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(2)).toHaveText("Items2");
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(3)).toHaveText("BatchNot in batch");
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(0)).toHaveCSS("display", "grid");
  await expect(firstOrderRow.locator(".database-order-row-meta-line").nth(0)).toHaveCSS("align-items", "center");
  await expect(firstOrderRow.locator(".database-order-row-thumbnail-placeholder")).toHaveCount(1);
  await expect(ordersWorkspace.locator(".database-orders-list-shell > .section-heading")).toHaveCount(0);
  await expect(ordersWorkspace.locator(".database-orders-list-shell")).toHaveCSS("gap", "10px");
  await expect(ordersWorkspace.locator(".database-order-row").first()).toHaveCSS("border-left-width", "4px");
  await expect(ordersWorkspace.locator(".database-order-row").first()).toHaveCSS("border-radius", "12px");
  await expect(ordersWorkspace.locator(".database-order-row-button").first()).toHaveCSS("border-top-width", "0px");
  await ordersWorkspace.getByRole("button", { name: /Order 1002/ }).hover();
  await expect(ordersWorkspace.locator(".database-order-row").nth(1)).toHaveCSS("background-color", "rgb(244, 251, 250)");
  await expect(ordersWorkspace.locator(".database-order-row").nth(1)).toHaveCSS("border-top-color", "rgb(219, 236, 235)");
  await expect(ordersWorkspace.locator(".database-order-row").nth(1)).toHaveCSS("border-left-color", "rgb(0, 128, 124)");
  await expect(ordersWorkspace.locator(".database-order-row-button").nth(1)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await ordersWorkspace.getByLabel("Orders tools").click();
  const addCheckedButton = ordersWorkspace.getByRole("button", { name: "Add Checked to Production Batch" });
  await expect(addCheckedButton).toBeDisabled();
  await ordersWorkspace.getByLabel("Select order 1001").check();
  await ordersWorkspace.getByLabel("Orders tools").click();
  await expect(addCheckedButton).toBeEnabled();

  await expect(ordersWorkspace.getByRole("heading", { name: "Order 1001" })).toBeVisible();
  await expect(ordersWorkspace.locator(".database-order-selected-status")).toHaveText("Open");
  await expect(ordersWorkspace.locator(".database-order-items-shell > .section-heading")).toHaveCount(0);
  await expect(ordersWorkspace.locator(".database-order-items-shell > .database-order-selected-meta")).toHaveCount(0);
  await expect(ordersWorkspace.getByText("Ada RN")).toBeVisible();
  await expect(ordersWorkspace.getByText("Saved design available", { exact: true })).toBeVisible();
  await expect(ordersWorkspace.getByText("Badge buddy")).toBeVisible();
  await expect(ordersWorkspace.getByText("Already in active batch")).toBeVisible();
  await ordersWorkspace.getByLabel("Order actions", { exact: true }).click();
  const orderActions = ordersWorkspace.getByRole("menu", { name: "Selected order actions" });
  await expect(orderActions.getByRole("button").nth(0)).toHaveText("Add to Production Batch");
  await expect(orderActions.getByRole("button").nth(1)).toHaveText("Skip Order");
  await expect(orderActions.getByRole("button", { name: "Add to Production Batch" })).toBeEnabled();
  const selectedOrderMenuWidth = await ordersWorkspace.locator("#selectedOrderActionsMenu .workspace-tools-popover").evaluate((popover) => popover.getBoundingClientRect().width);
  expect(selectedOrderMenuWidth).toBeLessThan(300);
  expect(selectedOrderMenuWidth).toBeGreaterThan(190);
  await page.keyboard.press("Escape");

  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await expect(firstItemCard.getByRole("heading", { name: "Order Item" })).toBeVisible();
  await expect(firstItemCard.locator(".database-order-item-listing")).toHaveText("Custom badge reel");
  await expect(firstItemCard.locator(".database-order-item-listing-column")).not.toContainText("Ada RN");
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("Personalization");
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("Ada RN");
  await expect(firstItemCard.getByRole("img", { name: "Custom badge reel" })).toBeVisible();
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("Color");
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("Red Glitter");
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("Quantity");
  await expect(firstItemCard.locator(".database-order-item-meta")).toContainText("2");
  await expect(firstItemCard.locator(".database-order-item-preview-column .database-order-item-preview")).toBeVisible();
  await expect(firstItemCard.locator(".database-order-item-body > *")).toHaveCount(2);
  await expect(
    firstItemCard.locator(".database-order-item-preview").getByText("Export-ready design available"),
  ).toHaveCount(0);
  await expect(firstItemCard.locator(".database-order-item-preview svg path")).toHaveCount(2);
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await expect(firstItemCard.getByRole("button", { name: "Copy Design" })).toBeVisible();
  await expect(firstItemCard.getByRole("button", { name: "Add to Production Batch" })).toBeEnabled();
  await page.keyboard.press("Escape");

  await ordersWorkspace
    .locator(".database-order-row")
    .filter({ hasText: "Order 1002" })
    .getByRole("button")
    .click();
  await expect(ordersWorkspace.getByRole("heading", { name: "Order 1002" })).toBeVisible();
  const inBatchItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Grace" });
  await expect(inBatchItemCard.locator(".database-order-item-meta")).toContainText("Grace");
  await inBatchItemCard.getByRole("button", { name: "Item actions" }).click();
  await expect(inBatchItemCard.getByRole("button", { name: "Add to Production Batch" })).toBeDisabled();
});

test("refreshes Orders after saving a new manual production batch design", async ({ page }) => {
  await installSupabaseSession(page);
  const ordersPayload = buildOrdersPayload();
  await installProductionBatchRoutes(page, {
    onPut: async (snapshot) => {
      const manualItem = snapshot.orderItems.find((item) => item.text === "Manual Bob");
      if (!manualItem || ordersPayload.orders.some((order) => order.id === `item:${manualItem.id}`)) {
        return;
      }

      ordersPayload.orders.push({
        id: `item:${manualItem.id}`,
        orderNumber: null,
        buyerName: null,
        status: "open",
        isInActiveBatch: true,
        items: [{
          id: manualItem.id,
          orderNumber: null,
          buyerName: null,
          isInActiveBatch: true,
          quantity: 1,
          design: {
            text: manualItem.text,
            lines: [{ lineIndex: 0, text: manualItem.text, fontId: "candlepin" }],
          },
          source: {},
        }],
      });
    },
  });
  await installOrdersWorkspaceRoutes(page, { ordersPayload });
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        isConnected: true,
        connectedComponentCount: 1,
        facePath: "M0 0 L10 0 L10 10 L0 10 Z",
        exportFacePath: "M0 0 L10 0 L10 10 L0 10 Z",
        backingPath: "M-1 -1 L11 -1 L11 11 L-1 11 Z",
        faceBoundsMm: { x: 0, y: 0, width: 10, height: 10 },
      }),
    });
  });

  await page.goto("/orders");
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1001/ })).toBeVisible();
  await expect(ordersWorkspace.getByText("Manual Bob")).toHaveCount(0);

  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await page.getByLabel("Batch tools").click();
  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Manual Bob");
  await expect(page.locator("#captureButton")).toBeEnabled();
  await page.locator("#captureButton").click();
  await expect.poll(() => ordersPayload.orders.some((order) => order.id.startsWith("item:"))).toBe(true);

  await page.getByRole("button", { name: "Orders", exact: true }).click();

  await expect(ordersWorkspace.getByText("Manual Order: Manual Bob")).toBeVisible();
});
test("debounces server-filtered order searches and ignores an older response", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const initialPayload = {
    orders: [{
      id: "order:initial",
      orderNumber: "1000",
      buyerName: "Initial order",
      status: "open",
      isInActiveBatch: false,
      items: [],
    }],
    nextCursor: "initial-cursor",
    hasMore: true,
  };
  const responseFor = (id, buyerName) => ({
    orders: [{
      id,
      orderNumber: id.replace("order:", ""),
      buyerName,
      status: "open",
      isInActiveBatch: false,
      items: [],
    }],
    nextCursor: null,
    hasMore: false,
  });
  const requestedSearches = [];
  const requestedFilters = [];
  let resolveAdaResponse;
  let resolveGraceResponse;
  await page.route("**/api/orders**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "detail") {
      await route.fulfill({ json: { order: null } });
      return;
    }
    const search = url.searchParams.get("search");
    const status = url.searchParams.get("status");
    const batch = url.searchParams.get("batch");
    if (!search && status === "open" && batch === "all") {
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(initialPayload) });
      return;
    }
    requestedSearches.push({ search, cursor: url.searchParams.get("cursor") });
    requestedFilters.push({ status, batch, search, cursor: url.searchParams.get("cursor") });
    await new Promise((resolve) => {
      if (search === "ada") resolveAdaResponse = () => resolve(route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(responseFor("order:ada", "Ada Lovelace")) }));
      if (search === "grace") resolveGraceResponse = () => resolve(route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(responseFor("order:grace", "Grace Hopper")) }));
      if (search !== "ada" && search !== "grace") resolve(route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify({ orders: [], nextCursor: null, hasMore: false }) }));
    });
  });

  await page.goto("/");

  const ordersWorkspace = page.locator("#databaseOrdersWorkspace");
  await expect(ordersWorkspace.locator(".database-order-row")).toContainText("Initial order");

  await page.locator("#databaseOrdersSearchInput").fill("ada");
  await expect.poll(() => requestedSearches.map(({ search }) => search)).toEqual(["ada"]);
  await page.locator("#databaseOrdersSearchInput").fill("grace");
  await expect.poll(() => requestedSearches.map(({ search }) => search)).toEqual(["ada", "grace"]);
  expect(requestedSearches).toEqual([
    { search: "ada", cursor: null },
    { search: "grace", cursor: null },
  ]);

  resolveGraceResponse();
  await expect(ordersWorkspace.locator(".database-order-row")).toContainText("Grace Hopper");
  resolveAdaResponse();
  await expect(ordersWorkspace.locator(".database-order-row")).toContainText("Grace Hopper");
  await expect(ordersWorkspace.locator(".database-order-row")).not.toContainText("Ada Lovelace");

  await page.locator("#databaseOrdersBatchFilter").selectOption("notInBatch");
  await expect.poll(() => requestedFilters.some((query) => query.batch === "notInBatch" && query.cursor === null)).toBe(true);
  await page.locator("#databaseOrdersStatusFilter").selectOption("complete");
  await expect.poll(() => requestedFilters.some((query) => query.status === "complete" && query.cursor === null)).toBe(true);
});

test("appends another Orders page without losing the current rows, selection, checks, or scroll position", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const createOrders = (start, count) => Array.from({ length: count }, (_, index) => {
    const orderNumber = String(start + index);
    return {
      id: `order:${orderNumber}`,
      orderNumber,
      buyerName: `Buyer ${orderNumber}`,
      status: "open",
      isInActiveBatch: false,
      items: [{ id: `item:${orderNumber}`, isInActiveBatch: false }],
    };
  });
  const firstPage = createOrders(1001, 50);
  const secondPage = createOrders(1051, 3);
  await page.route("**/api/orders**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const response = cursor === "page-1"
      ? { orders: secondPage, nextCursor: null, hasMore: false }
      : { orders: firstPage, nextCursor: "page-1", hasMore: true };
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(response),
    });
  });

  await page.goto("/");

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  const ordersList = ordersWorkspace.getByLabel("Orders list");
  await expect(ordersList.locator(".database-order-row")).toHaveCount(50);
  await ordersWorkspace.getByLabel("Select order 1001").check();
  await ordersWorkspace.getByRole("button", { name: "Order 1002" }).click();
  const scrollTopBeforeAppend = await ordersList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollTopBeforeAppend).toBeGreaterThan(0);

  await ordersWorkspace.getByRole("button", { name: "Load more orders" }).click();

  await expect(ordersList.locator(".database-order-row")).toHaveCount(53);
  await expect(ordersWorkspace.getByRole("button", { name: "Order 1001" })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: "Order 1053" })).toBeVisible();
  await expect(ordersWorkspace.getByLabel("Select order 1001")).toBeChecked();
  await expect(ordersWorkspace.getByRole("button", { name: "Order 1002" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => ordersList.evaluate((element) => element.scrollTop)).toBe(scrollTopBeforeAppend);
  await expect(ordersWorkspace.getByRole("button", { name: "Load more orders" })).toHaveCount(0);
});

test("keeps the loaded Orders page visible and offers retry when appending fails", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    id: `order:${1001 + index}`,
    orderNumber: String(1001 + index),
    buyerName: `Buyer ${1001 + index}`,
    status: "open",
    isInActiveBatch: false,
    items: [{ id: `item:${1001 + index}`, isInActiveBatch: false }],
  }));
  let appendAttempts = 0;
  await page.route("**/api/orders**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === "page-1") {
      appendAttempts += 1;
      if (appendAttempts === 1) {
        await route.fulfill({ status: 500, contentType: "application/json; charset=utf-8", body: JSON.stringify({ error: "Page two failed." }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify({ orders: [{ id: "order:1051", orderNumber: "1051", buyerName: "Buyer 1051", status: "open", isInActiveBatch: false, items: [{ id: "item:1051", isInActiveBatch: false }] }], nextCursor: null, hasMore: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify({ orders: firstPage, nextCursor: "page-1", hasMore: true }) });
  });

  await page.goto("/");

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  const ordersList = ordersWorkspace.getByLabel("Orders list");
  await expect(ordersList.locator(".database-order-row")).toHaveCount(50);
  await ordersWorkspace.getByRole("button", { name: "Load more orders" }).click();
  await expect(ordersList.locator(".database-order-row")).toHaveCount(50);
  await expect(ordersWorkspace.getByRole("button", { name: "Retry loading more orders" })).toBeVisible();

  await ordersWorkspace.getByRole("button", { name: "Retry loading more orders" }).click();
  await expect(ordersList.locator(".database-order-row")).toHaveCount(51);
  await expect(ordersWorkspace.getByRole("button", { name: "Retry loading more orders" })).toHaveCount(0);
});

test("skips and reopens an order item from the Orders screen", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const posts = [];
  let ordersPayload = buildOrdersPayload();
  const buildStatusPayload = (status) => ({
    ...ordersPayload,
    orders: [{
      ...ordersPayload.orders[0],
      status,
      items: [{
        ...ordersPayload.orders[0].items[0],
        status,
        isInActiveBatch: false,
      }],
      isInActiveBatch: false,
    }],
    importedOrderItemCount: 0,
    addedOrderItemCount: 0,
  });
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload,
    posts,
    postBody: (post) => {
      if (post.action === "skipOrderItem") {
        Object.assign(ordersPayload, buildStatusPayload("skipped"));
        return ordersPayload;
      }
      if (post.action === "reopenOrderItem") {
        Object.assign(ordersPayload, buildStatusPayload("open"));
        return ordersPayload;
      }
      return ordersPayload;
    },
  });

  await page.goto("/");

  const ordersWorkspace = page.locator("#databaseOrdersWorkspace");
  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await firstItemCard.getByRole("button", { name: "Skip Order Item" }).click();
  await expect(page.locator("#confirmationDialogTitle")).toHaveText("Skip Order Item?");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("It will not be added to a production batch.");
  await page.locator("#confirmationDialogConfirmButton").click();

  await expect.poll(() => posts.some((post) => post.action === "skipOrderItem" && post.orderItemId === "item-1")).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(0);

  await page.locator("#databaseOrdersStatusFilter").selectOption("skipped");
  await expect(ordersWorkspace.locator(".database-order-row")).toContainText("Order 1001");
  await expect(ordersWorkspace.locator(".database-order-row .database-order-status")).toHaveText("Skipped");
  await expect(firstItemCard.locator(".database-order-item-status")).toHaveText("Skipped");
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await expect(firstItemCard.getByRole("button", { name: "Add to Production Batch" })).toBeEnabled();
  await firstItemCard.getByRole("button", { name: "Reopen Order" }).click();

  await expect.poll(() => posts.some((post) => post.action === "reopenOrderItem" && post.orderItemId === "item-1")).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect(firstItemCard.locator(".database-order-item-status")).toHaveText("Not in active batch");
});

test("skips and reopens an entire selected order from the Orders screen", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const posts = [];
  let ordersPayload = {
    orders: [{
      ...buildOrdersPayload().orders[0],
      isInActiveBatch: true,
      items: buildOrdersPayload().orders[0].items.map((item, index) => ({
        ...item,
        isInActiveBatch: index === 1,
        status: "open",
      })),
    }],
  };
  const buildStatusPayload = (status) => ({
    ...ordersPayload,
    orders: [{
      ...ordersPayload.orders[0],
      status,
      isInActiveBatch: false,
      items: ordersPayload.orders[0].items.map((item) => ({
        ...item,
        status,
        isInActiveBatch: false,
      })),
    }],
    importedOrderItemCount: 0,
    addedOrderItemCount: 0,
  });
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload,
    posts,
    postBody: (post) => {
      if (post.action === "skipOrder") {
        Object.assign(ordersPayload, buildStatusPayload("skipped"));
        return ordersPayload;
      }
      if (post.action === "reopenOrder") {
        Object.assign(ordersPayload, buildStatusPayload("open"));
        return ordersPayload;
      }
      return ordersPayload;
    },
  });

  await page.goto("/");

  const ordersWorkspace = page.locator("#databaseOrdersWorkspace");
  await expect(ordersWorkspace.locator(".database-order-item-card")).toHaveCount(2);
  await ordersWorkspace.getByLabel("Order actions", { exact: true }).click();
  await ordersWorkspace.getByRole("menu", { name: "Selected order actions" }).getByRole("button", { name: "Skip Order" }).click();
  await expect(page.locator("#confirmationDialogTitle")).toHaveText("Skip Order?");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("Some order items are in the active production batch.");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("Remove those order items from the batch and skip the entire order?");
  await page.locator("#confirmationDialogConfirmButton").click();

  await expect.poll(() => posts.some((post) => post.action === "skipOrder" && post.orderId === "order:1001")).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(0);

  await page.locator("#databaseOrdersStatusFilter").selectOption("skipped");
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("skipped");
  await expect(ordersWorkspace.locator(".database-order-row")).toContainText("Order 1001");
  await expect(ordersWorkspace.locator(".database-order-row .database-order-status")).toHaveText("Skipped");
  await expect(ordersWorkspace.locator(".database-order-item-status")).toHaveText(["Skipped", "Skipped"]);

  await ordersWorkspace.getByLabel("Order actions", { exact: true }).click();
  await ordersWorkspace.getByRole("menu", { name: "Selected order actions" }).getByRole("button", { name: "Reopen Order" }).click();
  await expect.poll(() => posts.some((post) => post.action === "reopenOrder" && post.orderId === "order:1001")).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect(ordersWorkspace.locator(".database-order-item-status")).toHaveText(["Not in active batch", "Not in active batch"]);
});

test("skips and reopens checked orders from the Orders column menu", async ({ page }) => {
  await installSupabaseSession(page);
  let productionBatchGetCount = 0;
  await installProductionBatchRoutes(page, { onGet: () => { productionBatchGetCount += 1; } });
  const posts = [];
  let ordersGetCount = 0;
  const compactQueries = [];
  let ordersPayload = {
    orders: buildOrdersPayload().orders.map((order) => ({
      ...order,
      status: "open",
      isInActiveBatch: order.id === "order:1002",
      items: order.items.map((item) => ({ ...item, status: "open" })),
    })),
  };
  const buildStatusPayload = (status) => ({
    ...ordersPayload,
    orders: ordersPayload.orders.map((order) => ({
      ...order,
      status,
      isInActiveBatch: false,
      items: order.items.map((item) => ({ ...item, status, isInActiveBatch: false })),
    })),
    importedOrderItemCount: 0,
    addedOrderItemCount: 0,
  });
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload,
    posts,
    onGet: (request) => {
      ordersGetCount += 1;
      const url = new URL(request.url());
      compactQueries.push({
        status: url.searchParams.get("status"),
        cursor: url.searchParams.get("cursor"),
      });
    },
    postBody: (post) => {
      if (post.action === "skipOrders") {
        Object.assign(ordersPayload, buildStatusPayload("skipped"));
        return { orderItemIds: ["item-1", "item-2", "item-3"], status: "skipped" };
      }
      if (post.action === "reopenOrders") {
        Object.assign(ordersPayload, buildStatusPayload("open"));
        return { orderItemIds: ["item-1", "item-2", "item-3"], status: "open" };
      }
      return ordersPayload;
    },
  });

  await page.goto("/");

  const ordersWorkspace = page.locator("#databaseOrdersWorkspace");
  await ordersWorkspace.getByLabel("Select order 1001").check();
  await ordersWorkspace.getByLabel("Select order 1002").check();
  await page.locator("#ordersToolsMenu summary").click();
  await ordersWorkspace.getByRole("button", { name: "Skip Orders" }).click();
  await expect(page.locator("#confirmationDialogTitle")).toHaveText("Skip Orders?");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("Some selected order items are in the active production batch.");
  await page.locator("#confirmationDialogConfirmButton").click();

  await expect.poll(() => posts.some((post) => post.action === "skipOrders" && post.orderIds.includes("order:1001") && post.orderIds.includes("order:1002"))).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(0);
  expect(ordersGetCount).toBe(1);
  expect(productionBatchGetCount).toBe(1);

  await page.locator("#databaseOrdersStatusFilter").selectOption("skipped");
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("skipped");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(2);
  await ordersWorkspace.getByLabel("Select order 1001").check();
  await ordersWorkspace.getByLabel("Select order 1002").check();
  await page.locator("#ordersToolsMenu summary").click();
  await ordersWorkspace.getByRole("button", { name: "Reopen Orders" }).click();

  await expect.poll(() => posts.some((post) => post.action === "reopenOrders" && post.orderIds.includes("order:1001") && post.orderIds.includes("order:1002"))).toBe(true);
  await expect(page.locator("#databaseOrdersStatusFilter")).toHaveValue("open");
  await expect.poll(() => ordersGetCount).toBe(3);
  expect(compactQueries.at(-1)).toEqual({ status: "open", cursor: null });
});

test("loads database orders on initial app startup", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { getDelayMs: 500 });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  const pasteOrdersButton = ordersWorkspace.getByRole("button", { name: "Paste orders" });

  await expect(ordersWorkspace.getByText("Loading orders...")).toBeVisible();
  await expect(pasteOrdersButton).toBeEnabled();
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1001/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
});

test("selects a lower database order without rebuilding the Orders list", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { ordersPayload: buildScrollableOrdersPayload() });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByRole("button", { name: /Order 2030/ })).toBeVisible();

  const ordersList = ordersWorkspace.getByLabel("Orders list");
  const initialScrollTop = await ordersList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    window.__databaseOrdersListMutationCount = 0;
    const observer = new MutationObserver((mutations) => {
      window.__databaseOrdersListMutationCount += mutations.filter((mutation) => mutation.type === "childList").length;
    });
    observer.observe(element, { childList: true });
    window.__databaseOrdersListMutationObserver = observer;
    return element.scrollTop;
  });
  expect(initialScrollTop).toBeGreaterThan(0);

  await ordersWorkspace.getByRole("button", { name: /Order 2029/ }).click();

  await expect.poll(() => ordersList.evaluate((element) => element.scrollTop)).toBe(initialScrollTop);
  await expect.poll(() => page.evaluate(() => window.__databaseOrdersListMutationCount)).toBe(0);
  await expect(ordersWorkspace.getByRole("heading", { name: "Order 2029" })).toBeVisible();
});

test("pastes imported Etsy items into the Orders workspace without adding them to the batch", async ({ page }) => {
  const orderPosts = [];
  await installSupabaseSession(page);
  await installClipboardText(page, buildClipboardPayload());
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await ordersWorkspace.getByRole("button", { name: "Paste orders" }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toMatchObject({
    action: "importClipboardItems",
    target: "orders",
    batchId: "batch-1",
  });
});

test("clears and hides previous summary stats when a new operation starts", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, {
    postDelayMs: 10000,
    postBody: {
      importedOrderItemCount: 0,
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    },
  });

  await gotoAfterBatchLoads(page);
  await page.evaluate(() => {
    document.querySelector("#pasteSummaryImportedCount").textContent = "9";
    document.querySelector("#pasteSummarySkippedCount").textContent = "8";
    document.querySelector("#pasteSummaryAddedCount").textContent = "7";
  });

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await firstItemCard.getByRole("button", { name: "Add to Production Batch" }).click();

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#operationProgress")).toBeVisible();
  await expect(dialog.locator("#pasteSummaryCounts")).toBeHidden();
  await expect(dialog.locator("#pasteSummaryImportedCount")).toHaveText("0");
  await expect(dialog.locator("#pasteSummarySkippedCount")).toHaveText("0");
  await expect(dialog.locator("#pasteSummaryAddedCount")).toHaveText("0");
});

test("shows an Orders paste summary with imported and duplicate counts", async ({ page }) => {
  await installSupabaseSession(page);
  await installClipboardText(page, buildClipboardPayload());
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, {
    postBody: {
      ...buildOrdersPayloadWithImportedOrder(),
      importedOrderItemCount: 1,
      addedOrderItemCount: 0,
      skippedOrderItemCount: 2,
    },
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await ordersWorkspace.getByRole("button", { name: "Paste orders" }).click();

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Paste Summary");
  await expect(dialog.locator("#pasteSummaryTarget")).toHaveText("Orders");
  await expect(dialog.locator("#pasteSummaryImportedCount")).toHaveText("1");
  await expect(dialog.locator("#pasteSummarySkippedCount")).toHaveText("2");
  await expect(dialog.locator("#pasteSummaryAddedCount")).toHaveText("0");
});

test("keeps Orders paste available while workspace orders are loading", async ({ page }) => {
  const orderPosts = [];
  const ordersPayload = buildOrdersPayload();
  await installSupabaseSession(page);
  await installClipboardText(page, buildClipboardPayload());
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, {
    getDelayMs: 5000,
    posts: orderPosts,
    ordersPayload,
    onPost(post) {
      if (post.action === "importClipboardItems") {
        ordersPayload.orders = buildOrdersPayloadWithImportedOrder().orders;
      }
    },
    postBody: buildOrdersPayloadWithImportedOrder(),
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();

  const pasteOrdersButton = ordersWorkspace.getByRole("button", { name: "Paste orders" });
  await expect(ordersWorkspace.getByText("Loading orders...")).toBeVisible();
  await expect(pasteOrdersButton).toBeEnabled();
  await pasteOrdersButton.click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toMatchObject({
    action: "importClipboardItems",
    target: "orders",
  });
  await expect(ordersWorkspace.getByText("Loading orders...")).toBeHidden({ timeout: 8000 });
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1003/ })).toBeVisible();
  await expect(ordersWorkspace.getByText("Katherine Johnson")).toBeVisible();
});

test("pastes imported Etsy items into the active production batch", async ({ page }) => {
  const orderPosts = [];
  let productionBatchGetCount = 0;
  await installSupabaseSession(page);
  await installClipboardText(page, buildClipboardPayload());
  await installProductionBatchRoutes(page, {
    onGet: () => {
      productionBatchGetCount += 1;
    },
  });
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await page.getByLabel("Batch tools").click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toMatchObject({
    action: "importClipboardItems",
    target: "productionBatch",
    batchId: "batch-1",
  });
  await expect.poll(() => productionBatchGetCount).toBe(1);
  await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
});

test("explains invalid clipboard data without showing import counts", async ({ page }) => {
  await installSupabaseSession(page);
  await installClipboardText(page, "this is not order data");
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  await gotoAfterBatchLoads(page);
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await page.getByLabel("Batch tools").click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#operationProgress")).toBeHidden();
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Couldn't Paste Orders");
  await expect(dialog.locator("#pasteSummaryDescription")).toHaveText(
    "We couldn't find recognizable order data in your clipboard. Copy the orders again and retry.",
  );
  await expect(dialog.locator("#pasteSummaryCounts")).toBeHidden();
  const closeButton = dialog.getByRole("button", { name: "Close paste summary" });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(dialog).toBeHidden();
});

test("imports through a manual paste fallback when clipboard permission is blocked", async ({ page }) => {
  const orderPosts = [];
  await installSupabaseSession(page);
  await installClipboardReadError(page, {
    name: "NotAllowedError",
    message: "Failed to execute 'readText' on 'Clipboard': Read permission denied.",
  });
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await page.getByLabel("Batch tools").click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#operationProgress")).toBeHidden();
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Clipboard Access Blocked");
  await expect(dialog.locator("#pasteSummaryDescription")).toHaveText(
    "Your browser didn't show a clipboard permission prompt. Paste the copied order data below to continue.",
  );
  await expect(dialog.locator("#pasteSummaryCounts")).toBeHidden();
  await dialog.getByLabel("Paste order data").fill(buildClipboardPayload());
  await dialog.getByRole("button", { name: "Import Pasted Orders" }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toMatchObject({ action: "importClipboardItems", target: "productionBatch" });
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Paste Summary");
  await expect(dialog.locator("#pasteSummaryImportedCount")).toHaveText("1");
});

test("skips duplicate production batch clipboard items without posting to orders", async ({ page }) => {
  const orderPosts = [];
  await installSupabaseSession(page);
  await installClipboardText(page, buildClipboardPayload());
  await installProductionBatchRoutes(page, { orderItems: [buildDuplicateBatchOrderItem()] });
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await page.getByLabel("Batch tools").click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();

  await expect.poll(() => orderPosts).toHaveLength(0);
  await expect(page.locator("#workflowAlertText")).toHaveText(
    "Skipped 1 Etsy design already in the batch. No new designs were added.",
  );
  const summary = page.locator("#pasteSummaryDialog");
  await expect(summary).toBeVisible();
  await expect(summary.locator("#pasteSummaryImportedCount")).toHaveText("0");
  await expect(summary.locator("#pasteSummarySkippedCount")).toHaveText("1");
  await expect(summary.locator("#pasteSummaryAddedCount")).toHaveText("0");
});

test("imports Orders clipboard items with blank personalization text", async ({ page }) => {
  const orderPosts = [];
  await installSupabaseSession(page);
  await installClipboardText(page, buildEmptyClipboardPayload());
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await ordersWorkspace.getByRole("button", { name: "Paste orders" }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toMatchObject({
    action: "importClipboardItems",
    target: "orders",
    batchId: "batch-1",
    items: [
      {
        text: "",
        source: {
          orderNumber: "1004",
          buyerName: "Empty Clipboard",
          listingId: "listing-empty",
          transactionId: "txn-empty",
        },
      },
    ],
  });
  await expect(page.locator("#pasteSummaryDialog")).toBeVisible();
  await expect(page.locator("#pasteSummaryImportedCount")).toHaveText("1");
  await expect(page.locator("#pasteSummarySkippedCount")).toHaveText("0");
});

test("adds an individual order item to the active production batch from the item menu", async ({ page }) => {
  const orderPosts = [];
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, { posts: orderPosts });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByText("Ada RN")).toBeVisible();

  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await firstItemCard.getByRole("button", { name: "Add to Production Batch" }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toEqual({
    action: "addOrderItemToProductionBatch",
    batchId: "batch-1",
    orderItemId: "item-1",
    statusFilter: "open",
  });
});

test("hydrates the selected production batch item after adding from Orders", async ({ page }) => {
  const productionBatchOrderItems = [];
  const savedBatchSnapshots = [];
  const ordersPayload = buildOrdersPayload();
  ordersPayload.orders[0].items[0].source.marketplace = "amazon";
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page, {
    orderItems: productionBatchOrderItems,
    onPut(snapshot) {
      savedBatchSnapshots.push(structuredClone(snapshot));
    },
  });
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload,
    onPost(post) {
      if (post.action === "addOrderItemToProductionBatch") {
        productionBatchOrderItems.push({
          ...buildAdaProductionBatchOrderItem(),
          source: { ...buildAdaProductionBatchOrderItem().source, marketplace: "amazon" },
        });
      }
    },
    postBody: {
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    },
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByText("Ada RN")).toBeVisible();

  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await firstItemCard.getByRole("button", { name: "Add to Production Batch" }).click();
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();

  const productionWorkspace = page.getByRole("region", { name: "Order items workspace" });
  await expect(productionWorkspace.locator(".order-row.active")).toContainText("Personalization: Ada RN");
  await expect(page.locator("#textInput")).toHaveValue("Ada RN");
  await page.locator("#textInput").fill("Ada RN updated");
  await expect.poll(() => savedBatchSnapshots.length).toBeGreaterThan(0);
  expect(savedBatchSnapshots.at(-1).orderItems[0].source).toMatchObject({
    marketplace: "amazon",
  });
});

test("shows the production batch auth gate when an orders mutation requires authentication", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page, {
    postStatus: 401,
    postBody: { error: "Authentication required." },
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByText("Ada RN")).toBeVisible();

  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await firstItemCard.getByRole("button", { name: "Add to Production Batch" }).click();

  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeVisible();
  await expect(page.locator("#pasteSummaryTitle")).toHaveText("Operation Failed");
  await expect(page.locator("#pasteSummaryDialog").getByRole("button", { name: "Close" })).toBeVisible();
});

test("silently refreshes an expired session and completes an orders mutation", async ({ page }) => {
  await installRefreshableSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const authorizationHeaders = [];
  await installOrdersWorkspaceRoutes(page, {
    onPost(_post, request) {
      authorizationHeaders.push(request.headers().authorization);
    },
    postStatus(_post, request) {
      return request.headers().authorization === "Bearer expired-token" ? 401 : 200;
    },
    postBody(_post) {
      return authorizationHeaders.length === 1
        ? { error: "Access denied." }
        : { ...buildOrdersPayload(), addedOrderItemCount: 1, addedOrderItemIds: ["item-1"] };
    },
  });

  await gotoAfterBatchLoads(page);
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  const card = page.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await card.getByRole("button", { name: "Item actions" }).click();
  await card.getByRole("button", { name: "Add to Production Batch" }).click();

  await expect.poll(() => authorizationHeaders).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  await expect.poll(() => page.evaluate(() => window.ordersRefreshCalls || 0)).toBe(1);
  await expect(page.locator("#pasteSummaryTitle")).toHaveText("Order Item Added");
  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeHidden();
});

test("adds checked orders to the active production batch", async ({ page }) => {
  const orderPosts = [];
  const productionBatchOrderItems = [];
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page, { orderItems: productionBatchOrderItems });
  await installOrdersWorkspaceRoutes(page, {
    posts: orderPosts,
    onPost(post) {
      if (post.action === "addOrdersToProductionBatch") {
        productionBatchOrderItems.push(buildAdaProductionBatchOrderItem());
      }
    },
    postBody: {
      addedOrderItemCount: 1,
      addedOrderItemIds: ["item-1"],
    },
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByLabel("Select order 1001")).toBeVisible();
  await ordersWorkspace.getByLabel("Select all visible").check();
  await expect(ordersWorkspace.getByLabel("Select order 1001")).toBeChecked();
  await expect(ordersWorkspace.getByLabel("Select order 1002")).toBeChecked();

  await page.locator("#databaseOrdersSearchInput").fill("ada");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(1);
  await ordersWorkspace.getByLabel("Select all visible").uncheck();
  await expect(ordersWorkspace.getByLabel("Select order 1001")).not.toBeChecked();
  await page.locator("#databaseOrdersSearchInput").fill("");
  await expect(ordersWorkspace.locator(".database-order-row")).toHaveCount(2);
  await expect(ordersWorkspace.getByLabel("Select order 1002")).not.toBeChecked();
  await expect(ordersWorkspace.getByLabel("Select all visible")).not.toBeChecked();

  await ordersWorkspace.getByLabel("Select all visible").check();
  await ordersWorkspace.getByLabel("Orders tools").click();
  await ordersWorkspace.getByRole("button", { name: "Add Checked to Production Batch" }).click();

  await expect.poll(() => orderPosts).toHaveLength(1);
  expect(orderPosts[0]).toEqual({
    action: "addOrdersToProductionBatch",
    batchId: "batch-1",
    orderIds: ["order:1001"],
    statusFilter: "open",
  });

  await page.locator("#pasteSummaryDoneButton").click();
  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  const productionWorkspace = page.getByRole("region", { name: "Order items workspace" });
  await expect(productionWorkspace.locator(".order-row.active")).toContainText("Personalization: Ada RN");
});

test("adds a skipped order to production from the All status filter", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const posts = [];
  const skippedPayload = buildOrdersPayload();
  skippedPayload.orders = [skippedPayload.orders[0]];
  skippedPayload.orders[0] = {
    ...skippedPayload.orders[0],
    status: "skipped",
    items: skippedPayload.orders[0].items.map((item) => ({
      ...item,
      status: "skipped",
      isInActiveBatch: false,
    })),
  };
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload: skippedPayload,
    posts,
    postBody: {
      addedOrderItemCount: 2,
      addedOrderItemIds: ["item-1", "item-2"],
    },
  });

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await page.locator("#databaseOrdersStatusFilter").selectOption("all");

  const orderCheckbox = ordersWorkspace.getByLabel("Select order 1001");
  await expect(orderCheckbox).toBeEnabled();
  await orderCheckbox.check();
  await ordersWorkspace.getByLabel("Orders tools").click();
  await ordersWorkspace.getByRole("button", { name: "Add Checked to Production Batch" }).click();

  await expect.poll(() => posts.some((post) => (
    post.action === "addOrdersToProductionBatch"
    && post.orderIds.includes("order:1001")
    && post.statusFilter === "all"
  ))).toBe(true);
  await expect(ordersWorkspace.locator(".database-order-row .database-order-status")).toHaveText("Open");
});
test("adds the selected order to the active production batch from the order actions menu", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const posts = [];
  let ordersPayload = buildOrdersPayload();
  await installOrdersWorkspaceRoutes(page, {
    ordersPayload,
    posts,
    postBody: (post) => {
      if (post.action === "addOrdersToProductionBatch") {
        ordersPayload = {
          ...ordersPayload,
          orders: ordersPayload.orders.map((order) => (
            order.id === "order:1001"
              ? {
                ...order,
                isInActiveBatch: true,
                items: order.items.map((item) => ({ ...item, isInActiveBatch: true })),
              }
              : order
          )),
          importedOrderItemCount: 0,
          addedOrderItemCount: 1,
          addedOrderItemIds: ["item-1"],
        };
        return ordersPayload;
      }
      return ordersPayload;
    },
  });

  await page.goto("/");

  const ordersWorkspace = page.locator("#databaseOrdersWorkspace");
  await ordersWorkspace.getByLabel("Order actions", { exact: true }).click();
  await ordersWorkspace.getByRole("menu", { name: "Selected order actions" }).getByRole("button", { name: "Add to Production Batch" }).click();

  await expect.poll(() => posts.some((post) => (
    post.action === "addOrdersToProductionBatch"
    && post.orderIds.includes("order:1001")
  ))).toBe(true);
  await expect(ordersWorkspace.locator(".database-order-item-status")).toHaveText(["Already in active batch", "Already in active batch"]);
});

test("copying an incomplete order item design shows a completion-needed status", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  await gotoAfterBatchLoads(page);
  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(ordersWorkspace.getByText("Badge buddy")).toBeVisible();

  const incompleteItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Badge buddy" });
  await incompleteItemCard.getByRole("button", { name: "Item actions" }).click();
  await incompleteItemCard.getByRole("button", { name: "Copy Design" }).click({ force: true });

  await expect(page.locator("#workflowAlertText")).toHaveText("Complete and save this design before copying.");
});
