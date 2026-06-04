import { expect, test } from "playwright/test";

function installSupabaseSession(page, session) {
  return page.addInitScript(({ providedSession }) => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({
          data: { session: providedSession },
          error: null,
        }),
        signInWithPassword: async ({ email }) => ({
          data: {
            session: {
              access_token: "token-1",
              user: {
                id: "user-1",
                email,
              },
            },
          },
          error: null,
        }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        }),
      },
    };
  }, { providedSession: session });
}

function installSupabaseSessionWithLogoutTracking(page, session) {
  return page.addInitScript(({ providedSession }) => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    const readSignOutCalls = () => Number(window.sessionStorage.getItem("__TFU_SIGN_OUT_CALLS__") || "0");
    const writeSignOutCalls = (count) => {
      window.sessionStorage.setItem("__TFU_SIGN_OUT_CALLS__", String(count));
      window.__TFU_SIGN_OUT_CALLS__ = count;
    };
    writeSignOutCalls(readSignOutCalls());
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => {
          const hasSignedOut = readSignOutCalls() > 0;
          return {
            data: { session: hasSignedOut ? null : providedSession },
            error: null,
          };
        },
        signInWithPassword: async ({ email }) => ({
          data: {
            session: {
              access_token: "token-1",
              user: {
                id: "user-1",
                email,
              },
            },
          },
          error: null,
        }),
        signOut: async () => {
          writeSignOutCalls(readSignOutCalls() + 1);
          return { error: null };
        },
        onAuthStateChange: () => ({
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        }),
      },
    };
  }, { providedSession: session });
}

test("shows an operator sign-in screen when no batch session exists", async ({ page }) => {
  await installSupabaseSession(page, null);

  await page.goto("/production-batch");

  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeVisible();
  await expect(page.locator("#productionBatchSignInForm")).toBeVisible();
});

test("shows a blocked configuration error when Supabase config is missing", async ({ page }) => {
  await page.addInitScript(() => {
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => {
          throw new Error(
            "Supabase browser config is missing. Set window.__APP_CONFIG__.supabaseUrl and window.__APP_CONFIG__.supabaseAnonKey before loading batch sessions.",
          );
        },
      },
    };
  });

  await page.goto("/production-batch");

  await expect(page.locator("#productionBatchSignInForm")).toBeHidden();
  await expect(page.locator("#productionBatchAuthError")).toContainText("Supabase browser config is missing.");
});

test("returns to the sign-in state when a production batch save gets a 401", async ({ page }) => {
  await installSupabaseSession(page, {
    access_token: "token-1",
    user: {
      id: "user-1",
      email: "mark@example.com",
    },
  });

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
        activeOrderItemId: "remote-order-1",
        orderItems: [
          {
            id: "remote-order-1",
            revision: 1,
            text: "Remote Shared",
            status: "in-progress",
            settings: {
              text: "Remote Shared",
              presetId: "preset-oval",
              backingMm: 2.2,
              weldExportedDesign: true,
              lines: [
                {
                  fontId: "candlepin",
                  bridgeMm: 0.5,
                  lineBridgeMm: 0.5,
                  offsetXMm: 0,
                  fontSizeMm: 34,
                  horizontalScale: 1,
                  verticalScale: 1,
                  lockTextHeight: false,
                },
              ],
            },
          },
        ],
      }),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: "Authentication required.",
      }),
    });
  });
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
        faceBoundsMm: {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");

  await page.locator("#textInput").fill("Expired Session");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeVisible();
  await expect(page.locator("#productionBatchAuthError")).toContainText("Production batch session expired");
});

test("logs out from the left nav and returns to the sign-in gate", async ({ page }) => {
  await installSupabaseSessionWithLogoutTracking(page, {
    access_token: "token-1",
    user: {
      id: "user-1",
      email: "mark@example.com",
    },
  });

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
        activeOrderItemId: "remote-order-1",
        orderItems: [
          {
            id: "remote-order-1",
            revision: 1,
            text: "Remote Shared",
            status: "in-progress",
            settings: {
              text: "Remote Shared",
              presetId: "preset-oval",
              backingMm: 2.2,
              weldExportedDesign: true,
              lines: [
                {
                  fontId: "candlepin",
                  bridgeMm: 0.5,
                  lineBridgeMm: 0.5,
                  offsetXMm: 0,
                  fontSizeMm: 34,
                  horizontalScale: 1,
                  verticalScale: 1,
                  lockTextHeight: false,
                },
              ],
            },
          },
        ],
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#productionBatchLogoutButton")).toBeVisible();

  await page.locator("#productionBatchLogoutButton").click();

  await expect(page.getByRole("heading", { name: "Sign in to production batch" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__TFU_SIGN_OUT_CALLS__)).toBe(1);
});

test("switches to the presets workspace from the left nav", async ({ page }) => {
  await installSupabaseSession(page, {
    access_token: "token-1",
    user: {
      id: "user-1",
      email: "mark@example.com",
    },
  });

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
        activeOrderItemId: "remote-order-1",
        orderItems: [],
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#ordersWorkspace")).toBeVisible();

  await page.locator("#presetWorkspaceButton").click();

  await expect(page.locator("#presetWorkspaceButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#presetsWorkspace")).toBeVisible();

  await page.locator("#sizeGuideWorkspaceButton").click();

  await expect(page.locator("#sizeGuideWorkspaceButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sizeGuideWorkspace")).toBeVisible();
});

test("shows a loading skeleton while the initial production batch loads", async ({ page }) => {
  await installSupabaseSession(page, {
    access_token: "token-1",
    user: {
      id: "user-1",
      email: "mark@example.com",
    },
  });

  let releaseSharedSession;
  const batchSessionReady = new Promise((resolve) => {
    releaseSharedSession = resolve;
  });

  await page.route("**/api/batch-session", async (route) => {
    await batchSessionReady;
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
        activeOrderItemId: "remote-order-1",
        orderItems: [],
      }),
    });
  });

  await page.goto("/production-batch");

  await expect(page.locator("#initialBatchLoading")).toBeVisible();
  await expect(page.locator("#initialBatchLoading")).toContainText("Loading production batch");
  await expect(page.locator(".initial-batch-loading .order-skeleton-row")).toHaveCount(4);

  releaseSharedSession();

  await expect(page.locator("#initialBatchLoading")).toBeHidden();
});
