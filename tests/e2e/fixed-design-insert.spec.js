import { expect, test } from "playwright/test";
import { buildLegacySettingsSignature } from "../../src/order-signatures.js";
import { installSeededFontRoute } from "./font-test-routes.js";

const FIRST_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M10 18 2 9a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z\" fill=\"#0f766e\"/></svg>";
const SECOND_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0Z\" fill=\"none\" stroke=\"#be123c\"/></svg>";
const DELETED_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 18 18\"><path d=\"M9 1 17 17H1Z\" fill=\"#7c3aed\"/></svg>";
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

function buildDefaultProductionBatchSnapshot() {
  return {
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
}

async function installProductionBatchRoutes(page, initialSnapshot = buildDefaultProductionBatchSnapshot()) {
  let savedSnapshot = initialSnapshot;

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
    ["retired-cross.svg", DELETED_SVG],
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
      metadata_json: { viewBox: "0 0 24 12" },
      deleted_at: null,
      created_at: "2026-06-02T12:00:00.000Z",
      updated_at: "2026-06-02T12:00:00.000Z",
    },
    {
      id: "fixed-design-deleted",
      workspace_id: "workspace-1",
      display_name: "Retired Cross",
      public_url: fixedDesignPublicUrl("retired-cross.svg"),
      file_name: "retired-cross.svg",
      version: 2,
      metadata_json: {},
      deleted_at: "2026-06-04T12:00:00.000Z",
      created_at: "2026-06-01T12:00:00.000Z",
      updated_at: "2026-06-04T12:00:00.000Z",
    },
  ];

  await page.route("**/api/fixed-designs**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer token-1");
    const includeDeleted = new URL(route.request().url()).searchParams.get("includeDeleted") === "true";
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fixedDesigns: includeDeleted
          ? fixedDesigns
          : fixedDesigns.filter((record) => !record.deleted_at),
      }),
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

async function installPresetWithFixedDesignRoute(page) {
  await page.route("**/api/preset-snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        snapshot: {
          version: 1,
          defaultPresetId: "all-candlepin",
          presets: [
            {
              schemaVersion: 1,
              id: "all-candlepin",
              name: "All Candlepin",
              globalDefaults: {
                boundingSizePresetId: "size-2-2x1-5",
                backingMm: 3.1,
                weldExportedDesign: true,
              },
              lineDefaults: {
                fontId: "candlepin",
                bridgeMm: 0.5,
                lineBridgeMm: 0.5,
                offsetXMm: 0,
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
                lockTextHeight: false,
              },
              lineRules: [{ match: { kind: "all" }, settings: {} }],
              listingAssignments: [],
              fixedItems: [
                {
                  kind: "fixedSvg",
                  fixedDesignId: "fixed-design-2",
                  fixedDesignName: "Paw Print",
                  fixedDesignVersion: 1,
                  svgSizeMm: 32,
                  offsetXMm: 0,
                  offsetYMm: 0,
                  backingBorder: false,
                },
              ],
            },
            {
              schemaVersion: 1,
              id: "fixed-svg-preset",
              name: "Fixed SVG Preset",
              globalDefaults: {
                boundingSizePresetId: "size-2-2x1-5",
                backingMm: 3.1,
                weldExportedDesign: true,
              },
              lineDefaults: {
                fontId: "candlepin",
                bridgeMm: 0.5,
                lineBridgeMm: 0.5,
                offsetXMm: 0,
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
                lockTextHeight: false,
              },
              lineRules: [{ match: { kind: "all" }, settings: {} }],
              listingAssignments: [],
              fixedItems: [
                {
                  kind: "fixedSvg",
                  fixedDesignId: "fixed-design-1",
                  fixedDesignName: "Cardiology Heart",
                  fixedDesignVersion: 3,
                  svgSizeMm: 28,
                  offsetXMm: 0,
                  offsetYMm: 0,
                  backingBorder: false,
                },
              ],
            },
          ],
        },
      }),
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
  await installSeededFontRoute(page);
  await installProductionBatchRoutes(page);
  await installFixedDesignRoutes(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("thankfulforyou.designBatch");
  });
});

test("saves a saved batch design as fixed artwork with naming, progress, and failure recovery", async ({ page }) => {
  await page.route("**/api/layout-analyze", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      facePath: "M0 0H20V10H0Z", exportFacePath: "M0 0H20V10H0Z",
      backingPath: "M-3 -3H23V13H-3Z", widthMm: 20, heightMm: 10,
      faceBoundsMm: { left: 0, top: 0, width: 20, height: 10 },
      connectedComponentCount: 1, isConnected: true,
    }),
  }));
  let exportPayload;
  await page.route("**/api/export-svg", async route => {
    exportPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: FIRST_SVG });
  });
  let attempts = 0;
  let upload;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/fixed-designs", async route => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    upload = route.request().postDataJSON();
    attempts += 1;
    if (attempts === 1) {
      await held;
      await route.fulfill({ status: 409, json: { error: 'A fixed design named "Jane Smith RN" already exists. Choose another name.' } });
    } else {
      await route.fulfill({ status: 201, json: { fixedDesign: {
        id: "new-fixed", display_name: upload.displayName, file_name: "fixed-design.svg",
        public_url: fixedDesignPublicUrl("fixed-design.svg"), version: 1,
      } } });
    }
  });
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await openPresetTools(page);
  await expect(page.getByRole("button", { name: "Save as Fixed Design", exact: true })).toBeDisabled();
  await page.locator(".preset-tools-toggle").click();
  await page.locator("#textInput").fill("Jane Smith\nRN");
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design", exact: true }).click();
  await page.locator("#insertFixedDesignDialog").getByRole("button", { name: "Paw Print v1 - paw-print.svg" }).click();
  await page.locator("#insertFixedDesignDialog").getByRole("button", { name: "Insert Fixed Design", exact: true }).click();
  await page.locator("#captureButton").click();
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await openPresetTools(page);
  await page.getByRole("button", { name: "Save as Fixed Design", exact: true }).click();
  const dialog = page.locator("#saveFixedDesignDialog");
  const name = dialog.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Jane Smith RN");
  await expect(name).toBeFocused();
  await expect(dialog.locator("img")).toBeVisible();
  expect(exportPayload.outputMode).toBe("fixed-design");
  expect(exportPayload.fixedSvgs).toEqual([expect.objectContaining({ id: "fixed-design-2", svgText: SECOND_SVG })]);
  await dialog.getByRole("button", { name: "Save Fixed Design", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saving fixed design");
  await expect(dialog.getByRole("button", { name: "Save Fixed Design", exact: true })).toBeDisabled();
  release();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(name).toHaveValue("Jane Smith RN");
  await name.fill("Jane Smith RN 2");
  await dialog.getByRole("button", { name: "Save Fixed Design", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(upload.displayName).toBe("Jane Smith RN 2");
  expect(upload.file.text).toBe(FIRST_SVG);
  expect(attempts).toBe(2);
  await expect(page.locator("#textInput")).toHaveValue("Jane Smith\nRN");
  await expect(page.locator(".preset-tools-toggle")).toBeFocused();
  await page.locator("#textInput").fill("Unsaved change");
  await openPresetTools(page);
  await expect(page.locator("#saveAsFixedDesignButton")).toBeDisabled();
});

test("fixed design naming preserves work after preparation failure and supports validation and cancellation", async ({ page }) => {
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: {
    facePath: "M0 0H20V10H0Z", exportFacePath: "M0 0H20V10H0Z", backingPath: "M-3 -3H23V13H-3Z",
    faceBoundsMm: { left: 0, top: 0, width: 20, height: 10 }, connectedComponentCount: 1, isConnected: true,
  } }));
  let exports = 0;
  let uploads = 0;
  await page.route("**/api/export-svg", async route => {
    exports += 1;
    await route.fulfill(exports === 1 ? { status: 500, body: "Private server traceback" }
      : { status: 200, contentType: "image/svg+xml", body: FIRST_SVG });
  });
  await page.route("**/api/fixed-designs", async route => {
    if (route.request().method() === "POST") {
      uploads += 1;
      await route.fulfill({ status: 201, json: { fixedDesign: {
        id: "new-fixed", display_name: "Ava", file_name: "fixed-design.svg",
        public_url: fixedDesignPublicUrl("fixed-design.svg"), version: 1,
      } } });
      return;
    }
    await route.fallback();
  });
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await page.locator("#captureButton").click();
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await openPresetTools(page);
  await page.locator("#saveAsFixedDesignButton").click();
  const dialog = page.locator("#saveFixedDesignDialog");
  const name = dialog.getByLabel("Name", { exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Unable to prepare");
  await expect(dialog).not.toContainText("traceback");
  await expect(name).toHaveValue("Ava");
  await name.fill(" ");
  await dialog.getByRole("button", { name: "Save Fixed Design", exact: true }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toHaveCSS("color", "rgb(138, 47, 47)");
  await name.fill("Keep my name");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".preset-tools-toggle")).toBeFocused();
  await expect(page.locator("#workflowAlertText")).toContainText("Enter a fixed design name");
  await openPresetTools(page);
  await page.locator("#saveAsFixedDesignButton").click();
  await expect(dialog.locator("img")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(uploads).toBe(0);
  expect(exports).toBe(2);
  await expect(page.locator("#textInput")).toHaveValue("Ava");
  await openPresetTools(page);
  await page.locator("#saveAsFixedDesignButton").click();
  await expect(dialog.locator("img")).toBeVisible();
  await dialog.getByRole("button", { name: "Save Fixed Design", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(uploads).toBe(1);
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design", exact: true }).click();
  await expect(page.locator("#insertFixedDesignDialog").getByRole("button", { name: "Paw Print v1 - paw-print.svg" })).toBeVisible();
});

test("renders inserted fixed SVG artwork even when the order text is blank", async ({ page }) => {
  const analyzedLayouts = [];
  await page.route("**/api/layout-analyze", async (route) => {
    analyzedLayouts.push(route.request().postDataJSON()?.layout);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        text: "",
        widthMm: 40,
        heightMm: 20,
        backingMm: 3.1,
        facePath: "",
        faceBoundsMm: { left: 0, top: 0, width: 0, height: 0 },
        exportFacePath: "",
        backingPath: "",
        connectedComponentCount: 0,
        isConnected: true,
      }),
    });
  });
  await page.unroute("**/api/production-batch**");
  await installProductionBatchRoutes(page, {
    ...buildDefaultProductionBatchSnapshot(),
    orderItems: [
      {
        ...buildDefaultProductionBatchSnapshot().orderItems[0],
        text: "",
        settings: {
          text: "",
          presetId: "all-candlepin",
          lines: [],
        },
      },
    ],
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await expect(page.locator("#textInput")).toHaveValue("");

  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();

  const dialog = page.locator("#insertFixedDesignDialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Paw Print v1 - paw-print.svg" }).click();
  await dialog.getByRole("button", { name: "Insert Fixed Design" }).click();
  await expect(dialog).not.toBeVisible();

  await expect(page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" })).toBeVisible();

  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-2"]');
  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", /paw-print\.svg/);
  await expect(fixedPreview).toHaveAttribute("width", "64");
  await expect(fixedPreview).toHaveAttribute("height", "32");
  await expect(page.locator("#captureButton")).toBeEnabled();

  await page.locator("#captureButton").click();
  await expect.poll(() => analyzedLayouts.length).toBe(1);
  expect(analyzedLayouts[0].text).toBe("");
  expect(analyzedLayouts[0].fixedSvgs).toEqual([
    expect.objectContaining({
      id: "fixed-design-2",
      name: "Paw Print",
      widthMm: 64,
      heightMm: 32,
    }),
  ]);
});

test("renders a preset fixed SVG on a blank manual design", async ({ page }) => {
  await installPresetWithFixedDesignRoute(page);
  await page.unroute("**/api/production-batch**");
  await installProductionBatchRoutes(page, {
    ...buildDefaultProductionBatchSnapshot(),
    orderItems: [
      {
        ...buildDefaultProductionBatchSnapshot().orderItems[0],
        text: "",
        settings: {
          text: "",
          presetId: "all-candlepin",
          lines: [],
        },
      },
    ],
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await expect(page.locator("#textInput")).toHaveValue("");

  await page.locator("#presetInput").selectOption("fixed-svg-preset");

  await expect(page.locator(".line-control-card", { hasText: "Fixed Design: Cardiology Heart" })).toBeVisible();
  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-1"]');
  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", fixedDesignPublicUrl("cardiology-heart.svg"));
});

test("clears a stale save error when applying a fixed SVG preset to a blank manual design", async ({ page }) => {
  await installPresetWithFixedDesignRoute(page);
  const snapshot = {
    ...buildDefaultProductionBatchSnapshot(),
    orderItems: [
      {
        ...buildDefaultProductionBatchSnapshot().orderItems[0],
        revision: 1,
        updatedAt: "2026-08-12T15:00:00.000Z",
        text: "",
        settings: {
          text: "",
          presetId: "all-candlepin",
          lines: [
            {
              kind: "fixedSvg",
              fixedDesignId: "fixed-design-2",
              fixedDesignName: "Paw Print",
              fixedDesignVersion: 1,
              svgSizeMm: 32,
              offsetXMm: 0,
              offsetYMm: 0,
              backingBorder: false,
            },
          ],
        },
      },
    ],
  };
  await page.unroute("**/api/production-batch**");
  await installProductionBatchRoutes(page, snapshot);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        text: "",
        widthMm: 40,
        heightMm: 20,
        backingMm: 3.1,
        facePath: "",
        faceBoundsMm: { left: 0, top: 0, width: 0, height: 0 },
        exportFacePath: "",
        backingPath: "",
        connectedComponentCount: 0,
        isConnected: true,
      }),
    });
  });
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();

  await page.unroute("**/api/production-batch**");
  await page.route("**/api/production-batch**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 500,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "forced persistence failure" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(snapshot),
    });
  });

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(page.locator("#captureButton")).toBeEnabled();
  await page.locator("#captureButton").click();
  await expect(row.locator(".order-analysis-indicator.error")).toBeVisible({ timeout: 20000 });

  await page.locator("#presetInput").selectOption("fixed-svg-preset");

  await expect(row.locator(".order-analysis-indicator.error")).toHaveCount(0);
  await expect(page.locator(".line-control-card", { hasText: "Fixed Design: Cardiology Heart" })).toBeVisible();
  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-1"]');
  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", fixedDesignPublicUrl("cardiology-heart.svg"));
});

test("inserts a fixed SVG design from the preset tools menu with SVG-only controls", async ({ page }) => {
  const analyzedLayouts = [];
  await page.route("**/api/layout-analyze", async (route) => {
    analyzedLayouts.push(route.request().postDataJSON()?.layout);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        text: "Ava",
        widthMm: 40,
        heightMm: 20,
        backingMm: 3.1,
        facePath: "M0 0 L10 0 L10 10 Z",
        faceBoundsMm: { left: 0, top: 0, width: 10, height: 10 },
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
        isConnected: true,
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await expect(page.locator("#textInput")).toHaveValue("Ava");
  await page.locator("#captureButton").click();
  await expect.poll(() => analyzedLayouts.length).toBe(1);
  const textOnlyAnalysisLayout = analyzedLayouts[0];

  const presetPanel = page.getByLabel("Preset selection controls");
  await expect(presetPanel.locator(":scope > button", { hasText: "Insert Fixed Design" })).toHaveCount(0);

  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();

  const dialog = page.locator("#insertFixedDesignDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Insert Fixed Design" })).toBeVisible();
  await expect(dialog.locator("#insertFixedDesignSearchInput")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Retired Cross/ })).toHaveCount(0);
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
  await expect(fixedCard.getByText("Vertical Size")).toBeVisible();
  await expect(fixedCard.getByText("Horizontal Offset")).toBeVisible();
  await expect(fixedCard.getByText("Vertical Offset From Center")).toBeVisible();
  await expect(fixedCard.getByText("Font")).toHaveCount(0);
  await expect(fixedCard.getByText("Letter Bridge")).toHaveCount(0);
  await expect(fixedCard.getByText("Line Bridge")).toHaveCount(0);
  await expect(fixedCard.getByText("Text Height")).toHaveCount(0);
  await expect(fixedCard.getByText("Horizontal Stretch")).toHaveCount(0);
  await expect(fixedCard.getByText("Vertical Stretch")).toHaveCount(0);
  await expect(fixedCard.getByText("Lock Text Height")).toHaveCount(0);

  const backingBorderInput = fixedCard.getByLabel("Backing Border");
  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-2"]');
  await expect(backingBorderInput).not.toBeChecked();
  await expect(fixedPreview).toHaveAttribute("href", /paw-print\.svg/);
  await backingBorderInput.check();
  const fixedBackingPreview = page.locator('#preview image[data-fixed-svg-backing-id="fixed-design-2"]');
  await expect(fixedBackingPreview).toBeVisible();
  await expect.poll(async () => fixedBackingPreview.getAttribute("href")).toMatch(/^data:image\/png;base64,/);
  await expect(fixedBackingPreview).not.toHaveAttribute("filter", /fixed-svg-backing-filter/);
  await expect.poll(async () => fixedPreview.getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
  await expect.poll(async () => fixedPreview.getAttribute("href")).toContain("fill%3D%22%23f8fbfc%22");
  await expect(page.locator('#preview path[data-fixed-svg-backing-id="fixed-design-2"]')).toHaveCount(0);
  await backingBorderInput.uncheck();
  await expect(page.locator('#preview [data-fixed-svg-backing-id="fixed-design-2"]')).toHaveCount(0);
  await expect(fixedPreview).toHaveAttribute("href", /paw-print\.svg/);

  await expect(page.locator('.line-control-card[data-line-kind="text"][data-line-index="0"]').getByText("Font").first()).toBeVisible();

  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", /paw-print\.svg/);
  await expect.poll(async () => page.locator("#preview").evaluate((preview) => {
    const children = [...preview.children];
    const faceLayerIndex = children.findIndex((child) => child.classList.contains("face-layer"));
    const fixedSvgIndex = children.findIndex((child) => child.getAttribute("data-fixed-svg-id") === "fixed-design-2");
    return fixedSvgIndex > faceLayerIndex;
  })).toBe(true);
  const initialPreviewBox = await fixedPreview.evaluate((element) => ({
    x: Number(element.getAttribute("x")),
    y: Number(element.getAttribute("y")),
    width: Number(element.getAttribute("width")),
  }));

  await fixedCard.locator('[data-setting="svgSizeMm"]').evaluate((input) => {
    input.value = "40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fixedCard.locator('[data-setting="offsetXMm"]').evaluate((input) => {
    input.value = "7";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fixedCard.locator('[data-setting="offsetYMm"]').evaluate((input) => {
    input.value = "-6";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect.poll(async () => fixedPreview.evaluate((element) => Number(element.getAttribute("width")))).toBe(80);
  await expect.poll(async () => fixedPreview.evaluate((element) => Number(element.getAttribute("height")))).toBe(40);
  const adjustedPreviewBox = await fixedPreview.evaluate((element) => ({
    x: Number(element.getAttribute("x")),
    y: Number(element.getAttribute("y")),
  }));
  expect(adjustedPreviewBox.x).toBeGreaterThan(initialPreviewBox.x);
  expect(adjustedPreviewBox.y).toBeLessThan(initialPreviewBox.y);

  await page.locator("#captureButton").click();
  await expect.poll(() => analyzedLayouts.length).toBe(2);
  const fixedSvgAnalysisLayout = analyzedLayouts[1];
  expect(fixedSvgAnalysisLayout.letters.map((letter) => letter.character).join("")).toBe("Ava");
  expect(fixedSvgAnalysisLayout.textBoundsMm.width).toBeCloseTo(textOnlyAnalysisLayout.textBoundsMm.width, 6);
  expect(fixedSvgAnalysisLayout.textBoundsMm.height).toBeCloseTo(textOnlyAnalysisLayout.textBoundsMm.height, 6);
  expect(fixedSvgAnalysisLayout.fit.fitScale).toBeCloseTo(textOnlyAnalysisLayout.fit.fitScale, 6);
  expect(fixedSvgAnalysisLayout.fit.overflowsGuide).toBe(textOnlyAnalysisLayout.fit.overflowsGuide);
  expect(fixedSvgAnalysisLayout.fixedSvgs).toEqual([
    expect.objectContaining({
      id: "fixed-design-2",
      name: "Paw Print",
      publicUrl: fixedDesignPublicUrl("paw-print.svg"),
      widthMm: 80,
      heightMm: 40,
      offsetXMm: 7,
      offsetYMm: -6,
    }),
  ]);

  await fixedCard.locator(".fixed-design-line-toggle").click();
  await fixedCard.getByRole("button", { name: "Remove Fixed Design" }).click();
  await expect(page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" })).toHaveCount(0);
  await expect(page.locator('.line-control-card[data-line-kind="text"][data-line-index="0"]').getByText("Font").first()).toBeVisible();
});

test("backing preview preserves saved SVG group transforms, complete artwork, and counters", async ({ page }) => {
  // The saved-design origin shift puts raw path coordinates outside the SVG viewport.
  const savedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><g transform="translate(-50 -70)" fill="none" stroke="black" stroke-width="0.001"><path d="M50 70H90V90H50Z M55 75V85H65V75Z"/><g transform="translate(80 80) scale(0.5)"><rect x="0" y="0" width="10" height="10"/></g></g></svg>';
  await page.route(`${STORAGE_ROOT}/paw-print.svg`, route => route.fulfill({
    status: 200, contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: savedSvg,
  }));
  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design", exact: true }).click();
  await page.locator("#insertFixedDesignDialog").getByRole("button", { name: /Paw Print/ }).click();
  await page.locator("#insertFixedDesignDialog").getByRole("button", { name: "Insert Fixed Design", exact: true }).click();
  const card = page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" });
  const image = page.locator('#preview [data-fixed-svg-id="fixed-design-2"]');
  await card.getByLabel("Backing Border").check();
  await expect.poll(() => image.getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
  const pixels = await image.evaluate(async element => {
    const href = element.getAttribute("href");
    const svg = new DOMParser().parseFromString(decodeURIComponent(href.split(",")[1]), "image/svg+xml");
    const nestedTransform = [...svg.querySelectorAll("g[transform]")].map(node => node.getAttribute("transform"));
    const source = new Image();
    source.src = href;
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, 400, 200);
    const sample = (x, y) => [...context.getImageData(x * 10, y * 10, 1, 1).data];
    return { nestedTransform, topLeft: sample(2, 2), bottomRight: sample(38, 18), counter: sample(10, 10) };
  });
  expect(pixels.nestedTransform).toContain("translate(-50 -70)");
  expect(pixels.nestedTransform).toContain("translate(80 80) scale(0.5)");
  expect(pixels.topLeft).toEqual([248, 251, 252, 255]);
  expect(pixels.bottomRight).toEqual([248, 251, 252, 255]);
  expect(pixels.counter[3]).toBe(0);
  const backing = page.locator('#preview image[data-fixed-svg-backing-id="fixed-design-2"]');
  await expect.poll(() => backing.getAttribute("href")).toMatch(/^data:image\/png;base64,/);
  const backingPixel = await backing.evaluate(async element => {
    const source = new Image();
    source.src = element.getAttribute("href");
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0);
    // The counter is preserved in the raised face but must be filled in the backing.
    return [...context.getImageData(Math.round(canvas.width / 4), Math.round(canvas.height / 2), 1, 1).data];
  });
  expect(backingPixel).toEqual([255, 0, 0, 255]);
  await card.getByLabel("Backing Border").uncheck();
  await expect(image).toHaveAttribute("href", /paw-print\.svg/);
});

test("renders fixed SVG backing as analyzed vector geometry after Save", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        text: "Ava",
        widthMm: 40,
        heightMm: 20,
        backingMm: 3.1,
        facePath: "M0 0 L10 0 L10 10 Z",
        faceBoundsMm: { left: 0, top: 0, width: 10, height: 10 },
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        fixedSvgBackingPaths: [
          { id: "fixed-design-2", path: "M8 4 Q14 0 20 4 Q24 10 20 16 Q14 20 8 16 Q4 10 8 4 Z" },
        ],
        connectedComponentCount: 1,
        isConnected: true,
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();

  const dialog = page.locator("#insertFixedDesignDialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#insertFixedDesignSearchInput").fill("paw");
  await dialog.getByRole("button", { name: /Paw Print/ }).click();
  await dialog.getByRole("button", { name: "Insert Fixed Design" }).click();

  const fixedCard = page.locator(".line-control-card", { hasText: "Fixed Design: Paw Print" });
  await expect(fixedCard).toBeVisible();
  await fixedCard.getByLabel("Backing Border").check();
  await expect(page.locator('#preview image[data-fixed-svg-backing-id="fixed-design-2"]')).toBeVisible();

  await page.locator("#captureButton").click();
  const vectorBacking = page.locator('#preview path[data-fixed-svg-backing-id="fixed-design-2"]');
  await expect(vectorBacking).toBeVisible();
  await expect(vectorBacking).toHaveAttribute("d", /Q14 0 20 4/);
  await expect(vectorBacking).toHaveAttribute("fill", "rgb(255, 0, 0)");
  await expect.poll(async () => page.locator('#preview [data-fixed-svg-id="fixed-design-2"]').getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
  await expect(page.locator('#preview image[data-fixed-svg-backing-id="fixed-design-2"]')).toHaveCount(0);
});
test("resolves deleted fixed SVG references for saved designs without offering them for insert", async ({ page }) => {
  await page.unroute("**/api/batch-session");
  await page.unroute("**/api/production-batch**");

  const settings = {
    text: "Ava",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
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
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-deleted",
        fixedDesignName: "Retired Cross",
        fixedDesignVersion: 2,
        svgSizeMm: 30,
        offsetXMm: 4,
        offsetYMm: 8,
      },
    ],
  };
  const signature = buildLegacySettingsSignature(settings);
  await installProductionBatchRoutes(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "order-deleted-reference",
    orderItems: [
      {
        id: "order-deleted-reference",
        text: "Ava",
        status: "captured",
        settings,
        source: null,
        cachedBuild: {
          signature,
          layout: {
            text: "Ava",
            widthMm: 40,
            heightMm: 24,
            backingMm: 3.1,
            weldExportedDesign: true,
            boundingSizePresetId: "size-2-2x1-5",
            textBoundsMm: { left: 6.1, top: 6.1, width: 27.8, height: 11.8 },
            fit: { fitScale: 1, lineScaleFactors: [1], overflowsGuide: false },
            letters: [
              {
                character: "A",
                x: 7,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
              {
                character: "v",
                x: 17,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
              {
                character: "a",
                x: 27,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
            ],
          },
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            facePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            faceBoundsMm: { left: 0, top: 0, width: 10, height: 10 },
            connectedComponentCount: 1,
            isConnected: true,
          },
        },
        previousCompletedBuild: null,
        savedSettingsSignature: signature,
        completedSettingsSignature: signature,
        analysisBadge: { state: "ok", shortLabel: "1", fullLabel: "Analysis complete: 1 connected face piece" },
      },
    ],
  });

  let exportedPayload = null;
  await page.route("**/api/export-svg", async (route) => {
    exportedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-deleted"]');
  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", /retired-cross\.svg/);

  await openPresetTools(page);
  await page.getByRole("button", { name: "Insert Fixed Design" }).click();
  const dialog = page.locator("#insertFixedDesignDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cardiology Heart/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Retired Cross/ })).toHaveCount(0);
  await dialog.locator("#cancelInsertFixedDesignButton").click();

  await page.evaluate(() => {
    const button = document.querySelector("#downloadButton");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Export button not found");
    }
    button.click();
  });
  await expect.poll(() => exportedPayload).not.toBeNull();
  expect(exportedPayload.fixedSvgs).toEqual([
    expect.objectContaining({
      id: "fixed-design-deleted",
      name: "Retired Cross",
      publicUrl: fixedDesignPublicUrl("retired-cross.svg"),
      svgText: DELETED_SVG,
      widthMm: 30,
      heightMm: 30,
      offsetXMm: 4,
      offsetYMm: 8,
    }),
  ]);
});

test("enriches legacy cached fixed SVG layouts for preview and export", async ({ page }) => {
  await page.unroute("**/api/batch-session");
  await page.unroute("**/api/production-batch**");

  const settings = {
    text: "Ava",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
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
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-2",
        fixedDesignName: "Paw Print",
        fixedDesignVersion: 1,
        svgSizeMm: 36,
        offsetXMm: -30,
        offsetYMm: -20,
      },
    ],
  };
  const signature = buildLegacySettingsSignature(settings);
  await installProductionBatchRoutes(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "order-legacy",
    orderItems: [
      {
        id: "order-legacy",
        text: "Ava",
        status: "captured",
        settings,
        source: null,
        cachedBuild: {
          signature,
          layout: {
            text: "Ava",
            widthMm: 40,
            heightMm: 24,
            backingMm: 3.1,
            weldExportedDesign: true,
            boundingSizePresetId: "size-2-2x1-5",
            textBoundsMm: { left: 6.1, top: 6.1, width: 27.8, height: 11.8 },
            fit: { fitScale: 1, lineScaleFactors: [1], overflowsGuide: false },
            letters: [
              {
                character: "A",
                x: 7,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
              {
                character: "v",
                x: 17,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
              {
                character: "a",
                x: 27,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
            ],
          },
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            facePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            faceBoundsMm: { left: 0, top: 0, width: 10, height: 10 },
            connectedComponentCount: 1,
            isConnected: true,
          },
        },
        previousCompletedBuild: null,
        savedSettingsSignature: signature,
        completedSettingsSignature: signature,
        analysisBadge: { state: "ok", shortLabel: "1", fullLabel: "Analysis complete: 1 connected face piece" },
      },
    ],
  });

  let exportedPayload = null;
  await page.route("**/api/export-svg", async (route) => {
    exportedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  const fixedPreview = page.locator('#preview [data-fixed-svg-id="fixed-design-2"]');
  await expect(fixedPreview).toBeVisible();
  await expect(fixedPreview).toHaveAttribute("href", /paw-print\.svg/);
  await expect(fixedPreview).toHaveAttribute("width", "72");
  await expect(fixedPreview).toHaveAttribute("height", "36");

  await page.evaluate(() => {
    const button = document.querySelector("#downloadButton");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Export button not found");
    }
    button.click();
  });
  await expect.poll(() => exportedPayload).not.toBeNull();
  expect(exportedPayload.fixedSvgs).toEqual([
    expect.objectContaining({
      id: "fixed-design-2",
      name: "Paw Print",
      publicUrl: fixedDesignPublicUrl("paw-print.svg"),
      svgText: SECOND_SVG,
      xMm: 0,
      yMm: 0,
      widthMm: 72,
      heightMm: 36,
      offsetXMm: -30,
      offsetYMm: -20,
    }),
  ]);
  expect(exportedPayload.widthMm).toBeGreaterThan(60);
  expect(exportedPayload.heightMm).toBe(50);
});

test("includes fixed SVG markup when copying a saved fixed design", async ({ page }) => {
  await page.unroute("**/api/batch-session");
  await page.unroute("**/api/production-batch**");

  const settings = {
    text: "Ava",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
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
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-1",
        fixedDesignName: "Cardiology Heart",
        fixedDesignVersion: 3,
        svgSizeMm: 24,
        offsetXMm: 8,
        offsetYMm: 6,
      },
    ],
  };
  const signature = buildLegacySettingsSignature(settings);
  await installProductionBatchRoutes(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "order-copy-fixed",
    orderItems: [
      {
        id: "order-copy-fixed",
        text: "Ava",
        status: "captured",
        settings,
        source: null,
        cachedBuild: {
          signature,
          layout: {
            text: "Ava",
            widthMm: 40,
            heightMm: 24,
            backingMm: 3.1,
            weldExportedDesign: true,
            boundingSizePresetId: "size-2-2x1-5",
            textBoundsMm: { left: 6.1, top: 6.1, width: 27.8, height: 11.8 },
            fit: { fitScale: 1, lineScaleFactors: [1], overflowsGuide: false },
            letters: [
              {
                character: "A",
                x: 7,
                y: 18,
                fontId: "candlepin",
                fontPath: "public/fonts/Candlepin-Laser.otf",
                fontSizeMm: 32,
                horizontalScale: 1,
                verticalScale: 1,
              },
            ],
          },
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            facePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            faceBoundsMm: { left: 0, top: 0, width: 10, height: 10 },
            connectedComponentCount: 1,
            isConnected: true,
          },
        },
        previousCompletedBuild: null,
        savedSettingsSignature: signature,
        completedSettingsSignature: signature,
        analysisBadge: { state: "ok", shortLabel: "1", fullLabel: "Analysis complete: 1 connected face piece" },
      },
    ],
  });

  let exportedPayload = null;
  await page.route("**/api/export-svg", async (route) => {
    exportedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#initialBatchLoading")).toBeHidden();
  await page.evaluate(() => {
    const button = document.querySelector("#copyButton");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Copy button not found");
    }
    button.click();
  });

  await expect.poll(() => exportedPayload).not.toBeNull();
  expect(exportedPayload.fixedSvgs).toEqual([
    expect.objectContaining({
      id: "fixed-design-1",
      name: "Cardiology Heart",
      publicUrl: fixedDesignPublicUrl("cardiology-heart.svg"),
      svgText: FIRST_SVG,
      widthMm: 24,
      heightMm: 24,
      offsetXMm: 8,
      offsetYMm: 6,
    }),
  ]);
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
