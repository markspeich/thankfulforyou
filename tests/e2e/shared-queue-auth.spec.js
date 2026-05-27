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

test("shows an operator sign-in screen when no shared session exists", async ({ page }) => {
  await installSupabaseSession(page, null);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in to shared queue" })).toBeVisible();
  await expect(page.locator("#sharedQueueSignInForm")).toBeVisible();
});

test("shows a blocked configuration error when Supabase config is missing", async ({ page }) => {
  await page.addInitScript(() => {
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => {
          throw new Error(
            "Supabase browser config is missing. Set window.__APP_CONFIG__.supabaseUrl and window.__APP_CONFIG__.supabaseAnonKey before loading shared sessions.",
          );
        },
      },
    };
  });

  await page.goto("/");

  await expect(page.locator("#sharedQueueSignInForm")).toBeHidden();
  await expect(page.locator("#sharedQueueAuthError")).toContainText("Supabase browser config is missing.");
});

test("returns to the sign-in state when a shared queue save gets a 401", async ({ page }) => {
  await installSupabaseSession(page, {
    access_token: "token-1",
    user: {
      id: "user-1",
      email: "mark@example.com",
    },
  });

  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: { id: "queue-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        queue: { id: "queue-1", workspaceId: "workspace-1" },
        activeOrderId: "remote-order-1",
        orders: [
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
  await page.route("**/api/shared-queue", async (route) => {
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

  await page.goto("/");
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");

  await page.locator("#textInput").fill("Expired Session");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Sign in to shared queue" })).toBeVisible();
  await expect(page.locator("#sharedQueueAuthError")).toContainText("Shared queue session expired");
});
