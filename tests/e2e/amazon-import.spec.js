import { expect, test } from "playwright/test";

function session(page) {
  return page.addInitScript(() => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
    };
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({
          data: {
            session: sessionStorage.getItem("amazon-test-signed-out")
              ? null
              : { access_token: "token", user: { id: "u", email: "operator@example.com" } },
          },
          error: null,
        }),
        refreshSession: async () => {
          window.amazonRefreshCalls = (window.amazonRefreshCalls || 0) + 1;
          return {
            data: {
              session: { access_token: "refreshed-token", user: { id: "u", email: "operator@example.com" } },
            },
            error: null,
          };
        },
        signOut: async () => {
          window.amazonTestSignOutStarted = true;
          if (window.amazonTestDelaySignOut) {
            await new Promise(resolve => { window.resolveAmazonTestSignOut = resolve; });
          }
          sessionStorage.setItem("amazon-test-signed-out", "true");
          return { error: null };
        },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    };
  });
}

function order(buyerName = "Ada") {
  return {
    id: "order:1001",
    orderNumber: "1001",
    buyerName,
    items: [{
      id: "item-1",
      listingTitle: "Badge reel",
      source: { customizationNeeded: false },
      design: { text: "Ada RN", lines: [{ lineIndex: 0, text: "Ada RN", fontId: "candlepin" }] },
    }],
  };
}

async function routes(page, orderHandler = null) {
  let gets = 0;
  await page.route("**/api/batch-session", route => route.fulfill({
    json: {
      operator: { id: "u", email: "operator@example.com" },
      workspace: { id: "w", name: "TFY" },
      batch: { id: "b", workspaceId: "w" },
    },
  }));
  await page.route("**/api/production-batch?batchId=b", route => route.fulfill({
    json: { batch: { id: "b", workspaceId: "w" }, activeOrderItemId: null, orderItems: [] },
  }));
  await page.route("**/api/orders**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "detail") {
      return route.fulfill({ json: { order: order() } });
    }
    gets += 1;
    if (orderHandler) return orderHandler(route, gets);
    return route.fulfill({ json: { orders: [order()] } });
  });
  await page.route("**/api/etsy-connection", route => route.fulfill({
    json: { status: "connected", shopName: "Badge Shop" },
  }));
  await page.route("**/api/amazon-import", route => route.abort("blockedbyclient"));
  await page.route("**/api/etsy-import", route => route.abort("blockedbyclient"));
  return () => gets;
}

async function amazonStream(page) {
  await page.addInitScript(() => {
    const originalFetch = fetch.bind(window);
    window.amazonCalls = 0;
    window.amazonControllers = [];
    window.etsyCalls = 0;
    window.etsyControllers = [];
    window.pushAmazonEvent = event => {
      window.amazonControllers.at(-1)?.enqueue(
        new TextEncoder().encode(`${JSON.stringify(event)}\n`),
      );
    };
    window.closeAmazonStream = () => window.amazonControllers.pop()?.close();
    window.pushEtsyEvent = event => {
      window.etsyControllers.at(-1)?.enqueue(
        new TextEncoder().encode(`${JSON.stringify(event)}\n`),
      );
    };
    window.closeEtsyStream = () => window.etsyControllers.pop()?.close();
    window.fetch = (input, init = {}) => {
      const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
      const isAmazon = path === "/api/amazon-import";
      const isEtsy = path === "/api/etsy-import";
      if (!isAmazon && !isEtsy) return originalFetch(input, init);
      const controllers = isAmazon ? window.amazonControllers : window.etsyControllers;
      if (isAmazon) window.amazonCalls += 1;
      if (isEtsy) window.etsyCalls += 1;
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controllers.push(controller);
          init.signal?.addEventListener("abort", () => {
            sessionStorage.setItem(isAmazon ? "amazon-test-aborted" : "etsy-test-aborted", "true");
            try { controller.error(init.signal.reason); } catch { /* already closed */ }
          }, { once: true });
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }));
    };
  });
}

async function open(page, url = "/orders") {
  await page.goto(url);
  await expect(page.getByRole("region", { name: "Orders workspace" })).toBeVisible();
  await page.locator("#ordersToolsMenu summary").click();
}

const completion = {
  type: "complete",
  processedShipments: 3,
  importedItems: 4,
  existingItems: 2,
  alreadyProcessedShipments: 1,
  customizationNeeded: 2,
  warnings: 0,
  failed: 0,
};

test("Orders imports are ordered inside the tools menu and import once with mutual exclusion", async ({ page }) => {
  await session(page);
  await routes(page);
  await amazonStream(page);
  await open(page);

  const actions = page.locator("#databaseOrdersWorkspace .batch-header-actions");
  await expect(actions.locator(":scope > *")).toHaveCount(2);
  await expect(actions.locator(":scope > *").nth(0)).toHaveAttribute("id", "pasteOrdersButton");
  await expect(actions.locator(":scope > *").nth(1)).toHaveAttribute("id", "ordersToolsMenu");
  const importActions = page.locator("#ordersImportActions");
  await expect(importActions.locator(":scope > button")).toHaveCount(2);
  await expect(importActions.locator(":scope > button").nth(0)).toHaveClass(/etsy-import-button/);
  await expect(importActions.locator(":scope > button").nth(1)).toHaveClass(/amazon-import-button/);

  const amazon = page.locator(".amazon-import-button");
  const etsy = page.locator(".etsy-import-button");
  await expect(amazon).toHaveText("Import Amazon");
  await amazon.click();
  await expect(amazon).toBeDisabled();
  await expect(amazon).toHaveAttribute("aria-busy", "true");
  await expect(amazon.locator(".amazon-import-button-spinner")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("#ordersToolsMenu")).not.toHaveAttribute("open", "");
  await expect(etsy).toBeDisabled();
  await amazon.evaluate(element => element.click());
  await expect.poll(() => page.evaluate(() => window.amazonCalls)).toBe(1);
});

test("a held Etsy import disables Amazon until workspace teardown", async ({ page }) => {
  await session(page);
  await routes(page);
  await amazonStream(page);
  await open(page);

  const etsy = page.locator(".etsy-import-button");
  const amazon = page.locator(".amazon-import-button");
  await etsy.click();
  await expect.poll(() => page.evaluate(() => window.etsyCalls)).toBe(1);
  await expect(etsy).toHaveAttribute("aria-busy", "true");
  await expect(amazon).toBeDisabled();

  await page.locator("#orderWorkspaceButton").evaluate(element => element.click());
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("etsy-test-aborted"))).toBe("true");
});

test("Amazon warning-only completion shows every safe warning beyond ten with all seven metrics", async ({ page }) => {
  await session(page);
  const gets = await routes(page);
  await amazonStream(page);
  await open(page, "/orders/order%3A1001");
  await expect(page.locator(".database-order-row").first()).toBeVisible();
  await page.locator("#ordersToolsMenu summary").click();
  await page.getByRole("button", { name: /Order 1001/ }).click();

  await page.locator("#ordersToolsMenu summary").click();
  await page.getByRole("button", { name: "Import Amazon" }).click();
  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Importing from Amazon");
  await expect(dialog.locator("#pasteSummaryDescription")).toHaveText(
    "Importing pending Amazon orders from ShipStation.",
  );
  await expect(dialog.locator("#operationProgressLabel")).toHaveText("Fetching Amazon orders...");

  await page.evaluate(() => pushAmazonEvent({
    type: "progress",
    stage: "processing_shipments",
    processed: 2,
    total: 3,
  }));
  await expect(dialog.locator("#operationProgressLabel")).toHaveText("Processing 2 of 3 Amazon shipments...");

  await page.evaluate(event => {
    pushAmazonEvent(event);
    closeAmazonStream();
  }, {
    ...completion,
    importedItems: 6,
    warnings: 11,
    warningDetails: Array.from({ length: 11 }, (_, index) => ({
      orderNumber: `111-${String(index + 1).padStart(7, "0")}-${String(index + 1).padStart(7, "0")}`,
      stage: index === 0 ? "notes_update" : "tag_update",
      summary: index === 0
        ? "ShipStation Notes to Buyer is too long to update."
        : "ShipStation synchronization could not be completed.",
    })),
  });
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Amazon Import Complete");
  await expect(dialog.locator("#pasteSummaryDescription")).toContainText(
    "Amazon order 111-0000001-0000001 was imported, but ShipStation Notes to Buyer could not be updated because the note is too long.",
  );
  await expect(dialog.locator("#pasteSummaryDescription")).toContainText(
    "Amazon order 111-0000011-0000011 was imported, but the ShipStation Customization Needed tag could not be removed.",
  );
  await expect(dialog.locator("#pasteSummaryCounts dt")).toHaveText([
    "Shipments processed",
    "Items imported",
    "Existing items",
    "Not awaiting customization",
    "Needs review",
    "Warnings",
    "Failed",
  ]);
  await expect(dialog.locator("#pasteSummaryCounts dd")).toHaveText(["3", "6", "2", "1", "2", "11", "0"]);
  await expect.poll(gets).toBeGreaterThan(1);
  await expect(page.locator(".database-order-row.is-selected")).toContainText("Order 1001");
  await expect(page.locator(".amazon-import-button")).toHaveText("Import Amazon");
});

test("Etsy completion hides stale Amazon-only metrics", async ({ page }) => {
  await session(page);
  await routes(page);
  await amazonStream(page);
  await open(page);

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await page.evaluate(event => {
    pushAmazonEvent(event);
    closeAmazonStream();
  }, { ...completion, warnings: 1 });
  await expect(page.locator("#pasteSummaryCounts dt")).toHaveText([
    "Shipments processed",
    "Items imported",
    "Existing items",
    "Not awaiting customization",
    "Needs review",
    "Warnings",
    "Failed",
  ]);
  await page.getByRole("button", { name: "Done" }).click();

  await page.locator("#ordersToolsMenu summary").click();
  await page.getByRole("button", { name: "Import from Etsy" }).click();
  await page.evaluate(() => {
    pushEtsyEvent({ type: "complete", imported: 0, existing: 0, customizationNeeded: 0, failed: 0 });
    closeEtsyStream();
  });

  await expect(page.locator("#pasteSummaryTitle")).toHaveText("Etsy Import Complete");
  await expect(page.locator("#pasteSummaryCounts > div:visible")).toHaveCount(3);
  await expect(page.locator("#pasteSummaryCounts dt:visible")).toHaveText([
    "Imported",
    "Existing",
    "Needs review",
  ]);
});

test("terminal validation failure never renders success or refreshes Orders", async ({ page }) => {
  await session(page);
  const gets = await routes(page);
  await amazonStream(page);
  await open(page);
  await expect(page.locator(".database-order-row").first()).toBeVisible();
  const initialGets = gets();

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await page.evaluate(event => {
    pushAmazonEvent(event);
    pushAmazonEvent(event);
    closeAmazonStream();
  }, completion);

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Amazon Import Failed");
  await expect(dialog.locator("#pasteSummaryDescription")).toHaveText("Unable to import Amazon orders.");
  await expect(dialog.locator("#pasteSummaryTitle")).not.toHaveText("Amazon Import Complete");
  expect(gets()).toBe(initialGets);
});

test("Amazon safe failure retries without rendering upstream or customer fields", async ({ page }) => {
  await session(page);
  await routes(page);
  await amazonStream(page);
  await open(page);

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await page.evaluate(() => pushAmazonEvent({
    type: "error",
    code: "import_failed",
    message: "API-Key secret-key customer Jane note body https://zme-caps.amazon.com/signed",
  }));

  const dialog = page.locator("#pasteSummaryDialog");
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Amazon Import Failed");
  await expect(dialog.locator("#pasteSummaryDescription")).toHaveText("Unable to import Amazon orders.");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator("#ordersToolsMenu summary").click();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  for (const sensitive of ["secret-key", "customer Jane", "note body", "zme-caps.amazon.com"]) {
    await expect(page.locator("body")).not.toContainText(sensitive);
  }

  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => page.evaluate(() => window.amazonCalls)).toBe(2);
  await page.evaluate(event => {
    pushAmazonEvent(event);
    closeAmazonStream();
  }, completion);
  await expect(dialog.locator("#pasteSummaryTitle")).toHaveText("Amazon Import Complete");
});

test("Amazon refreshes an expired session and retries the import once", async ({ page }) => {
  await session(page);
  await routes(page);
  await page.addInitScript(event => {
    const originalFetch = fetch.bind(window);
    window.amazonAuthHeaders = [];
    window.fetch = (input, init = {}) => {
      const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
      if (path !== "/api/amazon-import") return originalFetch(input, init);
      window.amazonAuthHeaders.push(init.headers?.Authorization || null);
      if (window.amazonAuthHeaders.length === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(new Response(
        `${JSON.stringify(event)}\n`,
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      ));
    };
  }, completion);
  await open(page);

  await page.getByRole("button", { name: "Import Amazon" }).click();

  await expect.poll(() => page.evaluate(() => window.amazonRefreshCalls || 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.amazonAuthHeaders)).toEqual([
    "Bearer token",
    "Bearer refreshed-token",
  ]);
  await expect(page.locator("#pasteSummaryTitle")).toHaveText("Amazon Import Complete");
});

test("Amazon completion queues one forced refresh behind an in-flight Orders load", async ({ page }) => {
  await session(page);
  let releaseSecond;
  const secondReady = new Promise(resolve => { releaseSecond = resolve; });
  const gets = await routes(page, async (route, requestNumber) => {
    if (requestNumber === 2) await secondReady;
    await route.fulfill({ json: { orders: [order(requestNumber < 3 ? "Stale Buyer" : "Fresh Buyer")] } });
  });
  await amazonStream(page);
  await open(page, "/orders/order%3A1001");
  await expect(page.locator(".database-order-row").first()).toBeVisible();
  await page.locator("#databaseOrdersStatusFilter").selectOption("all");
  await expect.poll(gets).toBe(2);

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await page.evaluate(event => {
    pushAmazonEvent(event);
    closeAmazonStream();
  }, completion);
  releaseSecond();

  await expect.poll(gets).toBe(3);
  await expect(page.locator(".database-order-row.is-selected")).toContainText("Fresh Buyer");
  await expect(page.locator(".database-order-row.is-selected")).toContainText("Order 1001");
});

test("sign-out aborts Amazon before a delayed auth request settles", async ({ page }) => {
  await session(page);
  const gets = await routes(page);
  await amazonStream(page);
  await open(page);
  await expect(page.locator(".database-order-row").first()).toBeVisible();
  const initialGets = gets();
  await page.evaluate(() => { window.amazonTestDelaySignOut = true; });

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await expect(page.locator(".amazon-import-button")).toHaveAttribute("aria-busy", "true");
  await page.locator("#productionBatchLogoutButton").click();
  await expect.poll(() => page.evaluate(() => window.amazonTestSignOutStarted)).toBe(true);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("amazon-test-aborted"))).toBe("true");

  await page.evaluate(event => {
    try { pushAmazonEvent(event); } catch { /* the aborted stream must reject later events */ }
  }, completion);
  await expect(page.locator("#pasteSummaryTitle")).not.toHaveText("Amazon Import Complete");
  expect(gets()).toBe(initialGets);

  await page.evaluate(() => window.resolveAmazonTestSignOut());
  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeVisible();
});

test("leaving Orders aborts a held Amazon request and ignores later events", async ({ page }) => {
  await session(page);
  const gets = await routes(page);
  await amazonStream(page);
  await open(page);
  await expect(page.locator(".database-order-row").first()).toBeVisible();
  const initialGets = gets();

  await page.getByRole("button", { name: "Import Amazon" }).click();
  await expect.poll(() => page.evaluate(() => window.amazonCalls)).toBe(1);
  await page.locator("#orderWorkspaceButton").evaluate(element => element.click());
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("amazon-test-aborted"))).toBe("true");
  await page.evaluate(() => {
    try {
      pushAmazonEvent({ type: "progress", stage: "processing_shipments", processed: 1, total: 1 });
    } catch { /* the aborted stream must reject later events */ }
  });
  expect(gets()).toBe(initialGets);
});

test("compact Orders layout keeps Paste and the tools menu visible above filters and rows", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 445 });
  await session(page);
  await routes(page);
  await amazonStream(page);
  await open(page);

  const actions = page.locator("#databaseOrdersWorkspace .batch-header-actions");
  const filters = page.locator("#databaseOrdersWorkspace .database-orders-filters");
  const firstOrder = page.locator("#databaseOrdersWorkspace .database-order-row").first();
  await expect(actions).toBeVisible();
  await expect(filters).toBeVisible();
  await expect(firstOrder).toBeVisible();
  await expect(page.locator("#pasteOrdersButton")).toBeEnabled();
  await expect(page.locator("#ordersToolsMenu")).toBeVisible();
  await expect(page.locator(".etsy-import-button")).toBeEnabled();
  await expect(page.locator(".amazon-import-button")).toBeEnabled();

  const [actionsBox, filtersBox, rowBox] = await Promise.all([
    actions.boundingBox(),
    filters.boundingBox(),
    firstOrder.boundingBox(),
  ]);
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(filtersBox.y);
  expect(filtersBox.y + filtersBox.height).toBeLessThanOrEqual(rowBox.y);
});
