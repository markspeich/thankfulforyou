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
