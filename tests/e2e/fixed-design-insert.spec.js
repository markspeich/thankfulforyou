import { expect, test } from "playwright/test";

const FIRST_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M10 18 2 9a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z\" fill=\"#0f766e\"/></svg>";
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
  let savedSnapshot = {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "order-1",
    orderItems: [
      {
        id: "order-1",
        text: "Ava",
        status: "in-progress",
        settings: {
          text: "Ava",
          presetId: "all-candlepin",
          lines: [
            {
              kind: "text",
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 32,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
        source: null,
        cachedBuild: null,
        previousCompletedBuild: null,
        savedSettingsSignature: null,
        completedSettingsSignature: null,
        analysisBadge: null,
      },
    ],
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

  await page.route("**/api/production-batch**", async (route) => {
    if (route.request().method() === "PUT") {
      savedSnapshot = route.request().postDataJSON()?.snapshot || savedSnapshot;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(savedSnapshot),
    });
  });

  await page.route("**/api/orders**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ orders: [] }),
    });
  });
}

async function installFixedDesignRoutes(page) {
  const storageObjects = new Map([
    ["cardiology-heart.svg", FIRST_SVG],
    ["paw-print.svg", SECOND_SVG],
  ]);
  const fixedDesigns = [
    {
      id: "fixed-design-1",
      workspace_id: "workspace-1",
      display_name: "Cardiology Heart",
      public_url: fixedDesignPublicUrl("cardiology-heart.svg"),
      file_name: "cardiology-heart.svg",
      version: 3,
      metadata_json: {},
      deleted_at: null,
      created_at: "2026-06-01T12:00:00.000Z",
      updated_at: "2026-06-03T12:00:00.000Z",
    },
    {
      id: "fixed-design-2",
      workspace_id: "workspace-1",
      display_name: "Paw Print",
      public_url: fixedDesignPublicUrl("paw-print.svg"),
      file_name: "paw-print.svg",
      version: 1,
      metadata_json: {},
      deleted_at: null,
      created_at: "2026-06-02T12:00:00.000Z",
      updated_at: "2026-06-02T12:00:00.000Z",
    },
  ];

  await page.route("**/api/fixed-designs**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer token-1");
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ fixedDesigns }),
    });
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
}

async function installRacyFixedDesignRoutes(page) {
  const fixedDesigns = [
    {
      id: "fixed-design-1",
      workspace_id: "workspace-1",
      display_name: "Cardiology Heart",
      public_url: fixedDesignPublicUrl("cardiology-heart.svg"),
      file_name: "cardiology-heart.svg",
      version: 3,
      metadata_json: {},
      deleted_at: null,
      created_at: "2026-06-01T12:00:00.000Z",
      updated_at: "2026-06-03T12:00:00.000Z",
    },
  ];
  let requestCount = 0;

  await page.route("**/api/fixed-designs**", async (route) => {
    requestCount += 1;

    if (requestCount === 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
      await route.fulfill({
        status: 500,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Stale failed request." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ fixedDesigns }),
    });
  });

  await page.route(`${STORAGE_ROOT}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: FIRST_SVG,
    });
  });
}

async function openPresetTools(page) {
  const menu = page.locator(".preset-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await page.locator(".preset-tools-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
}

test.beforeEach(async ({ page }) => {
  await installSupabaseSession(page);
  await installProductionBatchRoutes(page);
  await installFixedDesignRoutes(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("thankfulforyou.designBatch");
  });
});

test("inserts a fixed SVG design from the preset tools menu with SVG-only controls", async ({ page }) => {
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await expect(page.locator("#textInput")).toHaveValue("Ava");

  const presetPanel = page.getByLabel("Preset selection controls");
  await expect(presetPanel.locator(":scope > button", { hasText: "Insert Fixed Design" })).toHaveCount(0);

  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();

  const dialog = page.locator("#insertFixedDesignDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Insert Fixed Design" })).toBeVisible();
  await expect(dialog.locator("#insertFixedDesignSearchInput")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toBeVisible();
  await expect(dialog.locator("#insertFixedDesignPreviewImage")).toHaveAttribute("src", /cardiology-heart\.svg/);
  await expect(dialog.locator("#insertFixedDesignSelectedName")).toHaveText("Cardiology Heart");
  await expect(dialog.locator("#insertFixedDesignSelectedMeta")).toContainText("v3");

  await dialog.locator("#insertFixedDesignSearchInput").fill("paw");
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: /Paw Print/ }).click();
  await expect(dialog.locator("#insertFixedDesignSelectedName")).toHaveText("Paw Print");
  await dialog.getByRole("button", { name: "Insert Fixed Design" }).click();
  await expect(dialog).not.toBeVisible();

  const fixedCard = page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" });
  await expect(fixedCard).toBeVisible();
  await expect(fixedCard.getByText("SVG Size")).toBeVisible();
  await expect(fixedCard.getByText("Horizontal Offset")).toBeVisible();
  await expect(fixedCard.getByText("Vertical Offset From Center")).toBeVisible();
  await expect(fixedCard.getByText("Font")).toHaveCount(0);
  await expect(fixedCard.getByText("Letter Bridge")).toHaveCount(0);
  await expect(fixedCard.getByText("Line Bridge")).toHaveCount(0);
  await expect(fixedCard.getByText("Text Height")).toHaveCount(0);
  await expect(fixedCard.getByText("Horizontal Stretch")).toHaveCount(0);
  await expect(fixedCard.getByText("Vertical Stretch")).toHaveCount(0);
  await expect(fixedCard.getByText("Lock Text Height")).toHaveCount(0);

  await expect(page.locator('.line-control-card[data-line-kind="text"][data-line-index="0"]').getByText("Font").first()).toBeVisible();

  await fixedCard.locator(".fixed-design-line-toggle").click();
  await fixedCard.getByRole("button", { name: "Remove Fixed Design" }).click();
  await expect(page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" })).toHaveCount(0);
  await expect(page.locator('.line-control-card[data-line-kind="text"][data-line-index="0"]').getByText("Font").first()).toBeVisible();
});

test("keeps newer fixed design picker results when an older load fails later", async ({ page }) => {
  await page.unroute("**/api/fixed-designs**");
  await page.unroute(`${STORAGE_ROOT}/**`);
  await installRacyFixedDesignRoutes(page);
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();

  const firstFixedDesignRequest = page.waitForRequest("**/api/fixed-designs**");
  const staleFailureResponse = page.waitForResponse((response) => (
    response.url().includes("/api/fixed-designs") && response.status() === 500
  ));
  const newerSuccessResponse = page.waitForResponse((response) => (
    response.url().includes("/api/fixed-designs") && response.status() === 200
  ));
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();
  await expect(page.locator("#insertFixedDesignDialog")).toBeVisible();
  await firstFixedDesignRequest;

  await page.locator("#cancelInsertFixedDesignButton").click();
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();

  const dialog = page.locator("#insertFixedDesignDialog");
  await newerSuccessResponse;
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toBeVisible();
  await staleFailureResponse;
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toBeVisible();
  await expect(dialog.locator("#insertFixedDesignStatus")).not.toContainText("Stale failed request.");
});
