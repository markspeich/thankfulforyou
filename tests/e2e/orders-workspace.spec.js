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

async function installProductionBatchRoutes(page) {
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
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: null,
        orderItems: [],
      }),
    });
  });
}

async function installOrdersWorkspaceRoutes(page) {
  await page.route("**/api/orders?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        orders: [
          {
            id: "order:1001",
            orderNumber: "1001",
            buyerName: "Ada Lovelace",
            isInActiveBatch: false,
            items: [
              {
                id: "item-1",
                listingTitle: "Custom badge reel",
                isInActiveBatch: false,
                design: {
                  text: "Ada RN",
                  lines: [
                    { lineIndex: 0, text: "Ada", fontId: "skywalk" },
                    { lineIndex: 1, text: "RN", fontId: "somekind" },
                  ],
                  cachedBuild: {
                    signature: "sig-1",
                    layout: { lines: [] },
                    analysis: { connectedComponents: 1 },
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
      }),
    });
  });
}

test("opens the Orders workspace shell from the left nav", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);

  await page.goto("/");

  const ordersNavButton = page.getByRole("button", { name: "Orders", exact: true });
  await expect(ordersNavButton).toBeVisible();

  await ordersNavButton.click();

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersNavButton).toHaveAttribute("aria-pressed", "true");
  await expect(ordersWorkspace.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(ordersWorkspace.getByLabel("Orders list")).toBeVisible();
  await expect(ordersWorkspace.getByLabel("Selected order items")).toBeVisible();
});

test("renders grouped database orders and selected order item cards", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installOrdersWorkspaceRoutes(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Orders", exact: true }).click();

  const ordersWorkspace = page.getByRole("region", { name: "Orders workspace" });
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1001/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /Order 1002/ })).toBeVisible();
  await expect(ordersWorkspace.getByRole("button", { name: /In batch/ })).toBeVisible();

  await ordersWorkspace.getByLabel("Orders tools").click();
  const addCheckedButton = ordersWorkspace.getByRole("button", { name: "Add Checked to Production Batch" });
  await expect(addCheckedButton).toBeDisabled();
  await ordersWorkspace.getByLabel("Select order 1001").check();
  await expect(addCheckedButton).toBeEnabled();

  await expect(ordersWorkspace.getByRole("heading", { name: "Order 1001" })).toBeVisible();
  await expect(ordersWorkspace.getByText("Ada RN")).toBeVisible();
  await expect(ordersWorkspace.getByText("Ada / RN")).toBeVisible();
  await expect(ordersWorkspace.getByText("Saved design available", { exact: true })).toBeVisible();
  await expect(ordersWorkspace.getByText("Badge buddy")).toBeVisible();
  await expect(ordersWorkspace.getByText("Already in active batch")).toBeVisible();

  const firstItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Ada RN" });
  await expect(
    firstItemCard.locator(".database-order-item-preview").getByText("Export-ready design available"),
  ).toBeVisible();
  await firstItemCard.getByRole("button", { name: "Item actions" }).click();
  await expect(firstItemCard.getByRole("button", { name: "Copy Design" })).toBeVisible();
  await expect(firstItemCard.getByRole("button", { name: "Add to Production Batch" })).toBeEnabled();
  await page.keyboard.press("Escape");

  await ordersWorkspace
    .locator(".database-order-row")
    .filter({ hasText: "Order 1002" })
    .getByRole("button")
    .click();
  await expect(ordersWorkspace.getByRole("heading", { name: "Grace" })).toBeVisible();
  const inBatchItemCard = ordersWorkspace.locator(".database-order-item-card").filter({ hasText: "Grace" });
  await inBatchItemCard.getByRole("button", { name: "Item actions" }).click();
  await expect(inBatchItemCard.getByRole("button", { name: "Add to Production Batch" })).toBeDisabled();
});
