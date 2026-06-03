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
