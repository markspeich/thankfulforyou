import { expect, test } from "playwright/test";

const FIRST_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><rect width=\"20\" height=\"20\" fill=\"#0f766e\"/></svg>";
const SECOND_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#be123c\"/></svg>";
const STORAGE_ORIGIN = "https://example.supabase.co";
const STORAGE_ROOT = `${STORAGE_ORIGIN}/storage/v1/object/public/workspace-fixed-designs`;

function fixedDesignPublicUrl(fileName) {
  return `${STORAGE_ROOT}/${fileName}`;
}

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

async function installFixedDesignRoutes(page, options = {}) {
  const { delayUnauthenticatedMs = 0, expireAuthOnGet = false } = options;
  const authorizationByMethod = [];
  const storageObjects = new Map([
    ["cardiology-heart.svg", FIRST_SVG],
  ]);
  let fixedDesigns = [
    {
      id: "fixed-design-1",
      workspace_id: "workspace-1",
      display_name: "Cardiology Heart",
      public_url: fixedDesignPublicUrl("cardiology-heart.svg"),
      file_name: "cardiology-heart.svg",
      version: 1,
      metadata_json: {},
      deleted_at: null,
      created_at: "2026-06-01T12:00:00.000Z",
      updated_at: "2026-06-01T12:00:00.000Z",
    },
  ];

  await page.route("**/api/fixed-designs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const authorization = request.headers().authorization || "";
    authorizationByMethod.push({ method, authorization });

    if (!authorization) {
      if (delayUnauthenticatedMs) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayUnauthenticatedMs);
        });
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Authentication required." }),
      });
      return;
    }

    if (expireAuthOnGet && method === "GET") {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      await route.fulfill({
        status: 401,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Authentication required." }),
      });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ fixedDesigns }),
      });
      return;
    }

    if (method === "POST") {
      const post = request.postDataJSON();
      storageObjects.set(post.file.name, post.file.text);
      const nextRecord = {
        id: "fixed-design-2",
        workspace_id: "workspace-1",
        display_name: post.displayName,
        public_url: fixedDesignPublicUrl(post.file.name),
        file_name: post.file.name,
        version: 1,
        metadata_json: {},
        deleted_at: null,
        created_at: "2026-06-02T12:00:00.000Z",
        updated_at: "2026-06-02T12:00:00.000Z",
      };
      fixedDesigns = [...fixedDesigns, nextRecord];
      await route.fulfill({
        status: 201,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ fixedDesign: nextRecord }),
      });
      return;
    }

    if (method === "PUT") {
      const fixedDesignId = url.searchParams.get("fixedDesignId");
      const post = request.postDataJSON();
      storageObjects.set(post.file.name, post.file.text);
      const nextRecords = fixedDesigns.map((record) => (
        record.id === fixedDesignId
          ? {
              ...record,
              public_url: fixedDesignPublicUrl(post.file.name),
              file_name: post.file.name,
              version: record.version + 1,
              updated_at: "2026-06-03T12:00:00.000Z",
            }
          : record
      ));
      fixedDesigns = nextRecords;
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ fixedDesign: fixedDesigns.find((record) => record.id === fixedDesignId) }),
      });
      return;
    }

    if (method === "DELETE") {
      const fixedDesignId = url.searchParams.get("fixedDesignId");
      const deletedRecord = fixedDesigns.find((record) => record.id === fixedDesignId);
      fixedDesigns = fixedDesigns.filter((record) => record.id !== fixedDesignId);
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          fixedDesign: {
            ...deletedRecord,
            deleted_at: "2026-06-04T12:00:00.000Z",
          },
        }),
      });
    }
  });

  await page.route(`${STORAGE_ROOT}/**`, async (route) => {
    const fileName = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "");
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: storageObjects.get(fileName) || FIRST_SVG,
    });
  });

  return { authorizationByMethod };
}

async function gotoAfterBatchLoads(page) {
  const batchReady = page.waitForResponse((response) => (
    response.url().includes("/api/production-batch?batchId=batch-1") && response.status() === 200
  ));
  await page.goto("/");
  await batchReady;
}

test("manages fixed SVG designs from the Fixed Designs workspace", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  const fixedDesignApi = await installFixedDesignRoutes(page);

  await gotoAfterBatchLoads(page);

  await expect(
    page.locator(".workspace-nav .workspace-nav-item:not(.workspace-nav-item-logout)").evaluateAll((buttons) => (
      buttons.map((button) => button.getAttribute("aria-label"))
    )),
  ).resolves.toEqual([
    "Orders",
    "Production Batch",
    "Presets",
    "Fonts",
    "Size Guides",
    "Fixed Designs",
  ]);

  await page.getByRole("button", { name: "Fixed Designs", exact: true }).click();
  await expect(page).toHaveURL(/\/fixed-designs$/);

  const workspace = page.getByRole("region", { name: "Fixed designs workspace" });
  await expect(workspace.getByRole("heading", { name: "Fixed Designs" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Cardiology Heart" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Cardiology Heart" })).toBeVisible();
  await expect(workspace.getByLabel("Selected fixed design preview")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Save Design" })).toBeHidden();

  await workspace.getByPlaceholder("Search fixed designs").fill("heart");
  await expect(workspace.getByRole("button", { name: "Cardiology Heart" })).toBeVisible();
  await workspace.getByPlaceholder("Search fixed designs").fill("missing");
  await expect(workspace.getByText("No fixed designs match that search.")).toBeVisible();
  await workspace.getByPlaceholder("Search fixed designs").fill("");

  await page.locator("#fixedDesignUploadInput").setInputFiles({
    name: "badge-star.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(SECOND_SVG),
  });
  await expect(workspace.getByRole("button", { name: "Badge Star" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Badge Star" })).toBeVisible();

  await workspace.getByLabel("Fixed design actions", { exact: true }).click();
  const menu = workspace.getByRole("menu", { name: "Selected fixed design actions" });
  await expect(menu.getByRole("button", { name: "Save Design" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Load New Version" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Download SVG" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Delete" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("button", { name: "Download SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("badge-star.svg");

  await workspace.getByLabel("Fixed design actions", { exact: true }).click();
  await menu.getByRole("button", { name: "Load New Version" }).click();
  const dialog = page.getByRole("dialog", { name: "Load New Version" });
  await expect(dialog.getByText("Drop an SVG here or choose a file.")).toBeVisible();
  await dialog.locator("#fixedDesignVersionInput").setInputFiles({
    name: "badge-star-v2.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(FIRST_SVG),
  });
  await expect(dialog.locator("#fixedDesignVersionStatus")).toContainText("badge-star-v2.svg");
  await expect(workspace.locator("#selectedFixedDesignVersion")).toHaveText("v1");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(workspace.locator("#selectedFixedDesignVersion")).toHaveText("v1");

  await workspace.getByLabel("Fixed design actions", { exact: true }).click();
  await menu.getByRole("button", { name: "Load New Version" }).click();
  await dialog.locator("#fixedDesignVersionInput").setInputFiles({
    name: "badge-star-v2.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(FIRST_SVG),
  });
  await dialog.getByRole("button", { name: "Load Version" }).click();
  await expect(workspace.locator("#selectedFixedDesignVersion")).toHaveText("v2");

  await workspace.getByLabel("Fixed design actions", { exact: true }).click();
  await menu.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#confirmationDialogTitle")).toHaveText("Delete Fixed Design?");
  await page.locator("#confirmationDialogConfirmButton").click();
  await expect(workspace.getByRole("button", { name: "Badge Star" })).toHaveCount(0);
  expect(fixedDesignApi.authorizationByMethod).toEqual(
    expect.arrayContaining([
      { method: "GET", authorization: "Bearer token-1" },
      { method: "POST", authorization: "Bearer token-1" },
      { method: "PUT", authorization: "Bearer token-1" },
      { method: "DELETE", authorization: "Bearer token-1" },
    ]),
  );
});

test("loads fixed designs on a direct Fixed Designs route after auth is available", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installFixedDesignRoutes(page, { delayUnauthenticatedMs: 350 });

  await page.goto("/fixed-designs");

  const workspace = page.getByRole("region", { name: "Fixed designs workspace" });
  await expect(workspace.getByRole("heading", { name: "Fixed Designs" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Cardiology Heart" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Cardiology Heart" })).toBeVisible();
});

test("prompts the operator to sign back in when fixed design API auth expires", async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installFixedDesignRoutes(page, { expireAuthOnGet: true });

  await page.goto("/fixed-designs");

  await expect(page.locator("#productionBatchAuthGate")).toBeVisible();
  await expect(page.locator("#productionBatchAuthTitle")).toHaveText("Sign in to production batch");
  await expect(page.locator("#productionBatchAuthError")).toContainText("Production batch session expired");
});
