import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..");
const PRESETS_DIR = path.join(REPO_ROOT, "public", "presets");
const PRESET_MANIFEST_PATH = path.join(PRESETS_DIR, "manifest.json");

function buildPresetPath(presetId) {
  return `public/presets/${presetId}.json`;
}

async function createPresetFixtureStore() {
  const manifest = JSON.parse(await readFile(PRESET_MANIFEST_PATH, "utf8"));
  const definitions = new Map();

  for (const entry of manifest.presets || []) {
    const presetPath = path.join(REPO_ROOT, entry.path);
    const preset = JSON.parse(await readFile(presetPath, "utf8"));
    definitions.set(entry.id, preset);
  }

  return {
    snapshot: {
      version: 1,
      defaultPresetId: manifest.defaultPresetId,
      presets: Array.from(definitions.values()).map((preset) => JSON.parse(JSON.stringify(preset))),
    },
    manifest,
    definitions,
  };
}

async function installPresetRoutes(page, options = {}) {
  const store = await createPresetFixtureStore();
  if (typeof options.modifyStore === "function") {
    options.modifyStore(store);
  }

  await page.route("**/public/presets/manifest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(store.manifest),
    });
  });

  await page.route("**/public/presets/*.json", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\//, "");
    if (pathname.endsWith("manifest.json")) {
      await route.fallback();
      return;
    }
    const presetId = pathname.split("/").pop()?.replace(/\.json$/, "") || "";
    const preset = store.definitions.get(presetId);

    if (!preset) {
      await route.fulfill({
        status: 404,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Preset not found." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(preset),
    });
  });

  await page.route("**/api/preset-snapshot**", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          workspaceKey: "primary",
          snapshot: store.snapshot,
        }),
      });
      return;
    }

    if (method === "PUT") {
      const payload = route.request().postDataJSON() || {};
      const snapshot = payload?.snapshot;

      if (
        !snapshot
        || typeof snapshot !== "object"
        || !Number.isInteger(snapshot.version)
        || typeof snapshot.defaultPresetId !== "string"
        || !Array.isArray(snapshot.presets)
      ) {
        await route.fulfill({
          status: 400,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ error: "snapshot.version, snapshot.defaultPresetId, and snapshot.presets are required." }),
        });
        return;
      }

      store.snapshot = JSON.parse(JSON.stringify(snapshot));

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          workspaceKey: "primary",
          snapshot: store.snapshot,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 405,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: "Method not allowed." }),
    });
  });

  return store;
}

async function openPresetTools(page) {
  const menu = page.locator(".preset-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await page.locator(".preset-tools-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
}

async function clickPresetAction(page, name) {
  await openPresetTools(page);
  await page.getByRole("button", { name }).click();
}

async function saveNewPresetFromDesignEditor(page, name) {
  await clickPresetAction(page, "Save as New Preset");
  await expect(page.locator("#savePresetAsDialog")).toBeVisible();
  await page.locator("#savePresetAsNameInput").fill(name);
  await page.locator("#savePresetAsDialog").getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect(page.locator("#savePresetAsDialog")).not.toBeVisible();
  return page.locator("#presetInput").inputValue();
}

async function installDelayedAnalysisRoute(page) {
  const pendingRequests = [];

  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => {
      pendingRequests.push({
        fulfill: async (overrides = {}) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify(buildMockAnalysisResponse(overrides)),
          });
          resolve();
        },
      });
    });
  });

  return pendingRequests;
}

async function openBatchTools(page) {
  const productionBatchWorkspace = page.locator("#ordersWorkspace");
  if (await productionBatchWorkspace.isHidden()) {
    await page.goto("/production-batch");
  }
  await expect(productionBatchWorkspace).toBeVisible();
  const menu = productionBatchWorkspace.locator(".batch-header .batch-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await productionBatchWorkspace.locator(".batch-header .batch-tools-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
}

async function clickBatchAction(page, name) {
  await openBatchTools(page);
  await page.getByRole("button", { name }).click();
}

async function pasteProductionBatchClipboard(page) {
  const productionBatchWorkspace = page.locator("#ordersWorkspace");
  if (await productionBatchWorkspace.isHidden()) {
    const clipboardPayload = await page.evaluate(async () => {
      try {
        return navigator.clipboard?.readText ? await navigator.clipboard.readText() : null;
      } catch {
        return null;
      }
    });
    await page.goto("/production-batch");
    if (clipboardPayload !== null) {
      await setClipboardPayload(page, clipboardPayload);
    }
  }
  await expect(productionBatchWorkspace).toBeVisible();
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#pasteSummaryDialog")).toBeVisible();
  await page.locator("#pasteSummaryDoneButton").click();
  await expect(page.locator("#pasteSummaryDialog")).not.toBeVisible();
}

test("startup auto-close does not dismiss a newer paste summary", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/production-batch");
  await setClipboardPayload(page, JSON.stringify([{
    orderNumber: "STARTUP-TIMER-1",
    listingId: "1884223710",
    buyerName: "Startup Timer Tester",
    personalization: "Taylor\nRN",
    quantity: 1,
  }]));

  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#pasteSummaryDialog")).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.locator("#pasteSummaryDialog")).toBeVisible();
});
async function selectPresetEditorRow(page, name) {
  await page.locator(".preset-library-row", { hasText: name }).click();
}

async function setClipboardPayload(page, payload) {
  await page.evaluate((clipboardPayload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardPayload,
      },
    });
  }, payload);
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}

async function expectDefaultSizeGuideLoaded(page) {
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
  await expect(page.locator("#sizePresetMaxWidthInput")).toHaveValue("2.2");
  await expect(page.locator("#sizePresetMaxHeightInput")).toHaveValue("1.5");
}

async function openSizeGuidesWorkspace(page) {
  await page.goto("/size-guides");
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();
}

async function clickEnabledButton(page, selector) {
  await expect.poll(async () => page.locator(selector).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return false;
    }
    button.click();
    return true;
  })).toBe(true);
}

async function completeDesign(page, queueLabel) {
  const row = page.locator("#orderList .order-row").filter({ hasText: queueLabel });

  await expect(page.locator("#captureButton")).toBeEnabled();
  await page.locator("#captureButton").click();
  await expect(row).toContainText("Complete");
  await expect.poll(async () => {
    return row.locator(".order-analysis-indicator.ok, .order-analysis-indicator.warning").count();
  }, { timeout: 20000 }).toBe(1);
}

function buildMockAnalysisResponse(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function installSupabaseSession(page) {
  return page.addInitScript(({ providedSession }) => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    window.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ = providedSession.access_token;
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({
          data: { session: providedSession },
          error: null,
        }),
        signInWithPassword: async () => ({
          data: {
            session: providedSession,
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
  }, {
    providedSession: {
      access_token: "token-1",
      user: {
        id: "user-1",
        email: "mark@example.com",
      },
    },
  });
}

async function installDefaultProductionBatchRoutes(page) {
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
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    const requestSnapshot = route.request().postDataJSON()?.snapshot;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(requestSnapshot),
    });
  });
  await page.route("**/api/orders**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ orders: [] }),
      });
      return;
    }

    const requestBody = route.request().postDataJSON();
    const itemCount = Array.isArray(requestBody?.items) ? requestBody.items.length : 0;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        importedOrderItemCount: itemCount,
        addedOrderItemCount: requestBody?.target === "productionBatch" ? itemCount : 0,
        orders: [],
      }),
    });
  });
}

const defaultFontRouteHandler = (route) => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ fonts: [
    { id: "candlepin", display_name: "Candlepin Laser", family_name: "CandlepinLaser", public_url: "public/fonts/Candlepin-Laser.otf", file_format: "otf", version: 1 },
    { id: "skywalk", display_name: "Skywalk Laser", family_name: "SkywalkLaser", public_url: "public/fonts/SkywalkLaserRegular.otf", file_format: "otf", version: 1 },
    { id: "somekind", display_name: "Somekind", family_name: "Somekind", public_url: "public/fonts/Somekind.ttf", file_format: "ttf", version: 1 },
  ] }),
});

test.beforeEach(async ({ page, request }) => {
  await installSupabaseSession(page);
  await installDefaultProductionBatchRoutes(page);
  await page.route("**/api/fonts**", defaultFontRouteHandler);
  await request.delete("/api/batch-snapshot?workspaceKey=primary").catch(() => null);
  await page.addInitScript(() => {
    window.localStorage.removeItem("thankfulforyou.designBatch");
  });
});

test("switches between order items, presets, and size guides from the left nav", async ({ page }) => {
  await page.goto("/");

  const appShell = page.locator(".app-shell");
  const ordersWorkspace = page.locator("#ordersWorkspace");
  const databaseOrdersWorkspace = page.locator("#databaseOrdersWorkspace");
  const presetsWorkspace = page.locator("#presetsWorkspace");
  const fontsWorkspace = page.locator("#fontsWorkspace");
  const sizeGuideWorkspace = page.locator("#sizeGuideWorkspace");
  const editorPanel = page.getByLabel("Selected design editor");

  await expect(page.getByRole("button", { name: "Orders", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Production Batch", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fonts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Size Guides", exact: true })).toBeVisible();
  await expect.poll(async () => {
    return page.getByRole("button", { name: "Size Guides", exact: true }).evaluate((button) => Math.round(button.getBoundingClientRect().height));
  }).toBeLessThanOrEqual(54);
  await expect(databaseOrdersWorkspace).toBeVisible();
  await expect(ordersWorkspace).toBeHidden();

  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await expect(ordersWorkspace).toBeVisible();
  await expect(databaseOrdersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(fontsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await expect(presetsWorkspace).toBeVisible();
  await expect(fontsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  const presetRowTitleTypography = await presetsWorkspace.locator(".preset-library-row .size-preset-name").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  });

  await page.getByRole("button", { name: "Fonts", exact: true }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(fontsWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Fonts workspace" })).toBeVisible();
  await expect(fontsWorkspace.getByRole("heading", { name: "Fonts" })).toBeVisible();
  await expect(fontsWorkspace.getByRole("button", { name: /Candlepin Laser/ })).toBeVisible();
  await expect(fontsWorkspace.getByRole("button", { name: "Upload New Version" })).toBeEnabled();
  await expect(fontsWorkspace.getByRole("button", { name: "Archive font" })).toBeEnabled();
  await expect(fontsWorkspace.getByText("Built-in", { exact: true })).toHaveCount(0);
  const candlepinPreview = fontsWorkspace.locator('.font-library-row[data-font-id="candlepin"] .font-library-preview');
  await expect(candlepinPreview).toHaveText("Candlepin Laser");
  await expect.poll(async () => (
    candlepinPreview.evaluate((element) => window.getComputedStyle(element).fontFamily)
  )).toContain("WorkspaceFont_63616e646c6570696e");
  const fontRowTitleTypography = await fontsWorkspace.locator(".font-library-row .font-library-name").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  });
  expect(fontRowTitleTypography).toEqual(presetRowTitleTypography);

  await page.getByRole("button", { name: "Size Guides", exact: true }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(fontsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();
  const sizeGuideRowTitleTypography = await sizeGuideWorkspace.locator(".size-preset-row .size-preset-name").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  });
  expect(sizeGuideRowTitleTypography).toEqual(presetRowTitleTypography);

  await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  await expect(page.getByRole("region", { name: "Order items workspace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeHidden();
  await expect(fontsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(appShell).toHaveAttribute("data-nav-collapsed", "true");
});

test("opens bookmarked editor workspaces and updates URLs from second-column selections", async ({ page }) => {
  await installPresetRoutes(page);

  await page.goto("/presets/preset-c3e8a1d7f520");
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await expect(page.locator("#presetDraftName")).toHaveValue("Skywalk, Somekind");
  await expect(page.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", "preset-c3e8a1d7f520");

  await page.locator(".preset-library-row", { hasText: "Candlepin, Skywalk" }).click();
  await expect(page).toHaveURL(/\/presets\/preset-b7d2e9f4c318$/);

  await page.goto("/fonts/skywalk");
  await expect(page.getByRole("region", { name: "Fonts workspace" })).toBeVisible();
  await expect(page.locator("#selectedFontName")).toContainText("Skywalk");

  await page.locator("#fontsWorkspace .font-library-row", { hasText: "Somekind" }).click();
  await expect(page).toHaveURL(/\/fonts\/somekind$/);

  await page.goto("/size-guides/size-2-2x1-5");
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
});

test("loads workspace fonts into the Fonts workspace and line controls", async ({ page }) => {
  await page.route("**/api/fonts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "font-clinic-sans",
            display_name: "Clinic Sans",
            family_name: "ClinicSans",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
          },
        ],
      }),
    });
  });

  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.getByRole("textbox", { name: "Design Text" }).fill("Nurse Joy");
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toContainText("Clinic Sans");
  await page.getByRole("button", { name: "Fonts" }).click();
  await expect(page.locator("#fontsWorkspace").getByRole("button", { name: /Clinic Sans/ })).toBeVisible();
  await expect(page.locator('.font-library-row[data-font-id="font-clinic-sans"] .font-library-preview')).toHaveCSS("font-family", /WorkspaceFont_666f6e742d636c696e69632d73616e73/);
  await expect(page.locator("#fontsWorkspace").getByText("Uploaded", { exact: true })).toHaveCount(0);
});

test("shows uploaded font guidance as neutral information", async ({ page }) => {
  await page.route("**/api/fonts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "font-clinic-sans",
            display_name: "Clinic Sans",
            family_name: "ClinicSans",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
          },
        ],
      }),
    });
  });

  await page.goto("/fonts/font-clinic-sans");
  const status = page.locator("#fontEditorStatus");

  await status.evaluate((element) => {
    element.dataset.state = "error";
  });
  await page.locator("#fontsWorkspace .font-library-row", { hasText: "Clinic Sans" }).click();

  await expect(status).toHaveText("This font can be replaced with a new version or archived from future selections.");
  await expect(status).not.toHaveAttribute("data-state", "error");
});

test("registers a replaced Candlepin asset instead of rendering a fallback font", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeFontFace = window.FontFace;
    window.FontFace = class TrackedFontFace extends NativeFontFace {
      constructor(family, source, descriptors) {
        super(family, source, descriptors);
        this.trackedSource = source;
      }
    };
    const add = document.fonts.add.bind(document.fonts);
    window.__registeredWorkspaceFontFaces = [];
    document.fonts.add = (face) => {
      window.__registeredWorkspaceFontFaces.push({ family: face.family, source: face.trackedSource });
      return add(face);
    };
  });
  let analyzedLayout = null;
  let exportedLayout = null;
  const replacementAnalysis = buildMockAnalysisResponse({
    facePath: "M2 2 L12 2 L12 12 L2 12 Z",
    exportFacePath: "M2 2 L12 2 L12 12 L2 12 Z",
  });
  await page.route("**/api/layout-analyze", async (route) => {
    analyzedLayout = route.request().postDataJSON()?.layout || null;
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(replacementAnalysis),
    });
  });
  await page.route("**/api/export-svg", async (route) => {
    exportedLayout = route.request().postDataJSON() || null;
    await route.fulfill({
      contentType: "image/svg+xml; charset=utf-8",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    });
  });
  await page.route("**/api/fonts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "candlepin",
            display_name: "Candlepin Shop Version",
            family_name: "WorkspaceFont_63616e646c6570696e",
            public_url: "public/fonts/Candlepin-Laser.otf?v=2",
            file_format: "otf",
            version: 2,
          },
        ],
      }),
    });
  });

  await page.goto("/fonts/candlepin");

  await expect(page.locator("#selectedFontName")).toHaveText("Candlepin Shop Version");
  const candlepinPreview = page.locator("#selectedFontPreview");
  await expect.poll(async () => candlepinPreview.evaluate((element) => window.getComputedStyle(element).fontFamily))
    .toContain("WorkspaceFont_63616e646c6570696e");
  await expect.poll(async () => candlepinPreview.evaluate(() => (
    document.fonts.check('16px "WorkspaceFont_63616e646c6570696e"')
  ))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__registeredWorkspaceFontFaces))
    .toContainEqual({
      family: "WorkspaceFont_63616e646c6570696e",
      source: 'url("/public/fonts/Candlepin-Laser.otf?v=2")',
    });
  await expect(page.locator("#selectedFontMeta")).toContainText("Available");
  await expect(page.locator("#selectedFontMeta")).toContainText("v2");
  await expect(page.locator("#fontDisplayNameInput")).toBeEnabled();
  await expect(page.locator("#fontPreviewTextInput")).toHaveValue("ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz");
  await expect(page.locator("#selectedFontPreview")).toHaveText("ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz");
  await page.locator("#fontPreviewTextInput").fill("Badge\nReel");
  await expect(page.locator("#selectedFontPreview")).toHaveText("Badge\nReel");
  await expect(page.getByRole("button", { name: "Upload New Version" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Archive font" })).toBeEnabled();
  await expect(page.locator("#fontEditorStatus")).toHaveText("This font can be replaced with a new version or archived from future selections.");
  const fontPresetCard = page.locator("#fontUsedByPresetsList");
  await expect(page.locator("#fontsWorkspace").getByRole("heading", { level: 3, name: "Used by Presets" })).toBeVisible();
  await expect(fontPresetCard).toContainText("All Candlepin");
  await expect(fontPresetCard).toContainText("Candlepin, Skywalk");
  await expect(fontPresetCard).toContainText("Skywalk, Somekind");
  const fontPresetLink = page.locator("#fontsWorkspace").getByRole("link", { name: "All Candlepin" });
  await expect(fontPresetLink).toHaveAttribute("href", "/presets/preset-a1f4c8e2b601");
  await expect(page.locator("#fontUsedByPresetsEmptyState")).toBeHidden();
  const fontPresetRowHeight = await fontPresetLink.evaluate((link) => Math.round(link.getBoundingClientRect().height));
  expect(fontPresetRowHeight).toBeLessThanOrEqual(34);
  await fontPresetLink.click();
  await expect(page).toHaveURL(/\/presets\/preset-a1f4c8e2b601$/);
  await expect(page.locator("#presetDraftName")).toHaveValue("All Candlepin");

  await page.goto("/production-batch");
  await clickBatchAction(page, "Add Design");
  await page.getByRole("textbox", { name: "Design Text" }).fill("Nurse Joy");
  await page.locator("#captureButton").click();
  await expect.poll(() => analyzedLayout?.letters?.map((letter) => letter.fontPath))
    .toEqual(expect.arrayContaining(["public/fonts/Candlepin-Laser.otf?v=2"]));

  await page.locator(".editor-tools-toggle").click();
  await page.getByRole("button", { name: "Export This Design" }).click();
  await expect.poll(() => exportedLayout?.letters?.map((letter) => letter.fontPath))
    .toEqual(expect.arrayContaining(["public/fonts/Candlepin-Laser.otf?v=2"]));
  await expect.poll(() => exportedLayout?.analysis?.exportFacePath)
    .toBe(replacementAnalysis.exportFacePath);
});

test("retains the current archived font but excludes other archived fonts from production choices", async ({ page }) => {
  const archivedAssetUrl = "public/fonts/Candlepin-Laser.otf?v=2";
  const archivedFamily = "WorkspaceFont_63616e646c6570696e";
  const archivedSettings = {
    text: "Archived Nurse",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.2,
    weldExportedDesign: false,
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
  };
  let analyzedLayout = null;
  let exportedLayout = null;

  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");
    window.__previewCanvasFonts = [];
    if (!descriptor?.get || !descriptor?.set) {
      return;
    }
    Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        window.__previewCanvasFonts.push(String(value));
        descriptor.set.call(this, value);
      },
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "archived-font-design",
        orderItems: [
          {
            id: "archived-font-design",
            revision: 4,
            text: archivedSettings.text,
            status: "in-progress",
            settings: archivedSettings,
            cachedBuild: null,
            previousCompletedBuild: null,
            savedSettingsSignature: null,
            completedSettingsSignature: null,
            analysisBadge: null,
            pendingAnalysisSignature: null,
            source: {
              listingTitle: "Existing archived-font design",
              buyerName: "Archive Tester",
            },
          },
        ],
      }),
    });
  });
  await page.route("**/api/layout-analyze", async (route) => {
    analyzedLayout = route.request().postDataJSON()?.layout || null;
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });
  await page.route("**/api/export-svg", async (route) => {
    exportedLayout = route.request().postDataJSON() || null;
    await route.fulfill({
      contentType: "image/svg+xml; charset=utf-8",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    });
  });
  await page.route("**/api/fonts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "candlepin",
            display_name: "Candlepin",
            family_name: archivedFamily,
            public_url: archivedAssetUrl,
            file_format: "otf",
            version: 2,
            archived_at: "2026-06-14T00:00:00.000Z",
          },
          {
            id: "font-archived",
            display_name: "Archived Upload",
            family_name: "ArchivedUpload",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            archived_at: "2026-06-14T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.getByRole("textbox", { name: "Design Text" })).toHaveValue("Archived Nurse");

  const fontSelect = page.locator('[data-line-index="0"] [data-setting="fontId"]');
  await expect(fontSelect).toHaveValue("candlepin");
  await expect(fontSelect).toContainText("Candlepin (archived)");
  await expect(fontSelect).not.toContainText("Archived Upload");
  await expect(fontSelect.locator('option[value="candlepin"]')).toHaveJSProperty("disabled", false);
  await expect.poll(async () => page.evaluate((family) => (
    window.__previewCanvasFonts.some((font) => font.includes(`"${family}"`))
  ), archivedFamily)).toBe(true);

  await expect(page.locator("#captureButton")).toBeEnabled();
  await page.locator("#captureButton").click();
  await expect.poll(() => (
    analyzedLayout?.letters?.length > 0
      && analyzedLayout.letters.every((letter) => letter.fontPath === archivedAssetUrl)
  )).toBe(true);

  await page.locator(".editor-tools-toggle").click();
  await page.getByRole("button", { name: "Export This Design" }).click();
  await expect.poll(() => (
    exportedLayout?.letters?.length > 0
      && exportedLayout.letters.every((letter) => letter.fontPath === archivedAssetUrl)
  )).toBe(true);

  await page.getByRole("button", { name: "Presets" }).click();
  const presetFontSelect = page.locator('select[data-preset-rule-key="first"][data-setting="fontId"]');
  await expect(presetFontSelect).toHaveValue("candlepin");
  await expect(presetFontSelect).toContainText("Candlepin (archived)");
  await expect(presetFontSelect).not.toContainText("Archived Upload");
  await expect(presetFontSelect.locator('option[value="candlepin"]')).toHaveJSProperty("disabled", false);
});

test("archives and restores Candlepin through the Fonts workspace", async ({ page }) => {
  let candlepinArchivedAt = null;
  const lifecyclePayloads = [];
  await page.route("**/api/fonts**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON();
      lifecyclePayloads.push(payload);
      candlepinArchivedAt = payload.lifecycle === "archive"
        ? "2026-08-05T20:00:00.000Z"
        : null;
      await route.fulfill({
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          font: {
            id: "candlepin",
            archived_at: candlepinArchivedAt,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "candlepin",
            display_name: "Candlepin Laser",
            family_name: "CandlepinLaser",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            archived_at: candlepinArchivedAt,
          },
          {
            id: "skywalk",
            display_name: "Skywalk Laser",
            family_name: "SkywalkLaser",
            public_url: "public/fonts/SkywalkLaserRegular.otf",
            file_format: "otf",
            version: 1,
          },
          {
            id: "somekind",
            display_name: "Somekind",
            family_name: "Somekind",
            public_url: "public/fonts/Somekind.ttf",
            file_format: "ttf",
            version: 1,
          },
        ],
      }),
    });
  });

  await page.goto("/fonts/candlepin");
  await page.getByRole("button", { name: "Archive font" }).click();
  const dialog = page.locator("#confirmationDialog");
  await expect(dialog.locator("#confirmationDialogTitle")).toHaveText("Archive Font?");
  await expect(dialog.locator("#confirmationDialogDescription")).toContainText("Existing saved designs and presets will continue to use it.");
  await dialog.locator("#confirmationDialogConfirmButton").click();

  await expect(page.getByRole("button", { name: "Restore font" })).toBeEnabled();
  await expect(page.locator("#fontEditorStatus")).toHaveText("Font archived from future selections.");
  expect(lifecyclePayloads).toEqual([{ lifecycle: "archive" }]);

  await page.getByRole("button", { name: "Restore font" }).click();
  await expect(page.getByRole("button", { name: "Archive font" })).toBeEnabled();
  await expect(page.locator("#fontEditorStatus")).toHaveText("Font restored.");
  expect(lifecyclePayloads).toEqual([{ lifecycle: "archive" }, { lifecycle: "restore" }]);
});

test("shows a visible warning when a selected font asset cannot load", async ({ page }) => {
  let analysisRequestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    analysisRequestCount += 1;
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });
  await page.route("**/api/fonts**", (route) => route.fulfill({
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({
      fonts: [
        {
          id: "candlepin",
          display_name: "Broken Candlepin",
          family_name: "BrokenCandlepin",
          public_url: "public/fonts/does-not-exist.otf",
          file_format: "otf",
          version: 7,
        },
        {
          id: "skywalk",
          display_name: "Skywalk Laser",
          family_name: "SkywalkLaser",
          public_url: "public/fonts/SkywalkLaserRegular.otf",
          file_format: "otf",
          version: 1,
        },
        {
          id: "somekind",
          display_name: "Somekind",
          family_name: "Somekind",
          public_url: "public/fonts/Somekind.ttf",
          file_format: "ttf",
          version: 1,
        },
      ],
    }),
  }));

  await page.goto("/fonts/candlepin");

  await expect(page.locator("#fontEditorStatus")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#fontEditorStatus")).toContainText("Broken Candlepin");
  await expect(page.locator("#fontEditorStatus")).toContainText("failed to load");

  await page.getByRole("button", { name: "Production Batch" }).click();
  await clickBatchAction(page, "Add Design");
  await page.getByRole("textbox", { name: "Design Text" }).fill("Nurse Joy");
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]'))
    .toContainText("Broken Candlepin (load failed)");
  await expect(page.locator("#connectionStatusLabel")).toHaveText("Font unavailable");
  await expect(page.locator("#connectionStatusDetail")).toContainText("Open Fonts to repair the asset or select an available font");
  await expect(page.locator("#connectionStatusDetail")).toContainText("before previewing, saving, analyzing, or exporting");
  await expect(page.locator("#preview .face-layer")).toHaveCount(0);
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#completeNextButton")).toBeDisabled();
  await page.locator(".editor-tools-toggle").click();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeDisabled();
  await page.waitForTimeout(250);
  expect(analysisRequestCount).toBe(0);
});

test("saves the font bridging setting from the Fonts workspace checkbox", async ({ page }) => {
  let bridgingEnabled = true;
  let patchPayload = null;

  await page.route("**/api/fonts**", async (route) => {
    const request = route.request();

    if (request.method() === "PATCH") {
      patchPayload = request.postDataJSON();
      bridgingEnabled = patchPayload.bridgingEnabled;
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          font: {
            id: "font-connected-script",
            display_name: "Connected Script",
            family_name: "ConnectedScript",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            bridging_enabled: bridgingEnabled,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "font-connected-script",
            display_name: "Connected Script",
            family_name: "ConnectedScript",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            bridging_enabled: bridgingEnabled,
          },
        ],
      }),
    });
  });

  await page.goto("/fonts/font-connected-script");

  const checkbox = page.locator("#fontBridgingEnabledInput");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();

  await expect.poll(() => patchPayload).toEqual({ bridgingEnabled: false });
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator("#fontEditorStatus")).toHaveText("Font bridge setting saved.");
});

test("saves font display name changes from the Fonts workspace Save button", async ({ page }) => {
  let displayName = "Connected Script";
  let patchPayload = null;

  const displayNameFontRouteHandler = async (route) => {
    const request = route.request();

    if (request.method() === "PATCH") {
      patchPayload = request.postDataJSON();
      displayName = patchPayload.displayName;
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          font: {
            id: "font-connected-script",
            display_name: displayName,
            family_name: "ConnectedScript",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            bridging_enabled: true,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "font-connected-script",
            display_name: displayName,
            family_name: "ConnectedScript",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
            bridging_enabled: true,
          },
        ],
      }),
    });
  };
  await page.unroute("**/api/fonts**", defaultFontRouteHandler);
  await page.route("**/api/fonts**", displayNameFontRouteHandler);

  await page.goto("/fonts/font-connected-script");

  const saveButton = page.getByRole("button", { name: "Save font display name" });
  await expect(page.locator("#fontEditorStatus")).toHaveText("This font can be replaced with a new version or archived from future selections.");
  await expect(saveButton).toBeDisabled();

  await page.locator("#fontDisplayNameInput").fill("Connected Script Display");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => patchPayload).toEqual({
    displayName: "Connected Script Display",
    bridgingEnabled: true,
  });
  await expect(page.locator("#selectedFontName")).toHaveText("Connected Script Display");
  await expect(saveButton).toBeDisabled();
  await expect(page.locator("#fontEditorStatus")).toHaveText("Font display name saved.");
});

test("keeps an edited font display name while the initial font registry render completes", async ({ page }) => {
  let releaseFontLoad;
  let markFontLoadStarted;
  const fontLoadStarted = new Promise((resolve) => {
    markFontLoadStarted = resolve;
  });
  const fontLoadReleased = new Promise((resolve) => {
    releaseFontLoad = resolve;
  });

  await page.unroute("**/api/fonts**", defaultFontRouteHandler);
  await page.route("**/api/fonts**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({
      fonts: [{
        id: "font-connected-script",
        display_name: "Connected Script",
        family_name: "ConnectedScript",
        public_url: "public/fonts/Candlepin-Laser.otf",
        file_format: "otf",
        version: 1,
        bridging_enabled: true,
      }],
    }),
  }));
  await page.route("**/public/fonts/Candlepin-Laser.otf", async (route) => {
    markFontLoadStarted();
    await fontLoadReleased;
    await route.continue();
  });

  const navigation = page.goto("/fonts/font-connected-script");
  await fontLoadStarted;
  await page.locator("#fontDisplayNameInput").fill("Connected Script Display");
  releaseFontLoad();
  await navigation;

  await expect(page.locator("#selectedFontName")).toHaveText("Connected Script");
  await expect(page.locator("#fontDisplayNameInput")).toHaveValue("Connected Script Display");
  await expect(page.getByRole("button", { name: "Save font display name" })).toBeEnabled();
});
test("keeps the font workspace stable after a successful upload", async ({ page }) => {
  const pageErrors = [];
  await page.route("**/api/fonts**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          font: {
            id: "font-uploaded-sophia",
            display_name: "Sophia Font Regular",
            family_name: "WorkspaceFont_Sophia_Font_Regular",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          {
            id: "font-uploaded-sophia",
            display_name: "Sophia Font Regular",
            family_name: "WorkspaceFont_Sophia_Font_Regular",
            public_url: "public/fonts/Candlepin-Laser.otf",
            file_format: "otf",
            version: 1,
          },
        ],
      }),
    });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/fonts");
  await page.locator("#newFontUploadButton").click();
  await page.locator("#fontFileInput").setInputFiles(path.join(REPO_ROOT, "public", "fonts", "Candlepin-Laser.otf"));

  await expect(page.locator("#fontEditorStatus")).toHaveText("Font uploaded.");
  expect(pageErrors).not.toContain("readSettingsFromControls is not defined");
});

test("shows size guides in the Size Guides workspace", async ({ page }) => {
  await page.goto("/size-guides");

  const sizeGuide = page.locator("#sizeGuideWorkspace");
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();
  await expect(sizeGuide.getByRole("heading", { level: 1, name: "Size Guides" })).toBeVisible();
  await expect(sizeGuide.getByRole("heading", { level: 2, name: "Size Guide Editor" })).toBeVisible();
  await expect(sizeGuide.getByText("2.2 x 1.5 in", { exact: true })).toBeVisible();
  await expect(sizeGuide.getByText("Max 2.2 x 1.5 in")).toBeVisible();
  await expect(sizeGuide.getByText("Min 1.6 x 1.1 in")).toBeVisible();
  await expect(sizeGuide.getByRole("heading", { level: 3, name: "Used by Presets" })).toBeVisible();
  await expect(sizeGuide.getByText("Preset Usage", { exact: true })).toHaveCount(0);
  await expect(sizeGuide.getByText("Assigned Presets", { exact: true })).toHaveCount(0);
  await expect(sizeGuide.locator("#sizeGuideAssignedPresetsList")).toContainText("All Candlepin");
  await expect(sizeGuide.locator("#sizeGuideAssignedPresetsList")).toContainText("Candlepin, Skywalk");
  await expect(sizeGuide.locator("#sizeGuideAssignedPresetsList")).toContainText("Skywalk, Somekind");
  const assignedPresetLink = sizeGuide.getByRole("link", { name: "Skywalk, Somekind" });
  await expect(assignedPresetLink).toHaveAttribute("href", "/presets/preset-c3e8a1d7f520");
  await expect(sizeGuide.locator("#sizeGuideAssignedPresetsEmptyState")).toBeHidden();
  const assignedPresetRowHeight = await assignedPresetLink.evaluate((link) => Math.round(link.getBoundingClientRect().height));
  expect(assignedPresetRowHeight).toBeLessThanOrEqual(34);

  await expect(sizeGuide.locator(".size-preset-row.is-selected").first()).toContainText("2.2 x 1.5 in");
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
  await expect(sizeGuide.locator(".size-preset-select-button")).toHaveCount(0);
  await expect(sizeGuide.locator(".size-guide-panel .batch-header").getByRole("button", { name: "New Guide" })).toBeVisible();
  await expect(sizeGuide.locator(".size-guide-editor-panel .editor-header").getByRole("button", { name: "Save Guide" })).toBeVisible();
  await expect(sizeGuide.locator(".size-guide-editor-panel .editor-header").getByRole("button", { name: "Delete Guide" })).toBeVisible();
  await expect(sizeGuide.locator(".production-workspace")).toBeVisible();
  await expect(sizeGuide.locator(".orders-panel")).toBeVisible();
  await expect(sizeGuide.locator(".editor-panel")).toBeVisible();
  await expect.poll(async () => {
    return page.locator("#sizeGuideWorkspace").evaluate((workspace) => {
      const editorBody = workspace.querySelector(".size-guide-editor-panel .editor-body");
      const editor = workspace.querySelector(".size-preset-editor");
      const guideNameInput = workspace.querySelector("#sizePresetNameInput");
      const maxWidthInput = workspace.querySelector("#sizePresetMaxWidthInput");
      const previewPanel = workspace.querySelector(".size-preset-preview-panel");
      if (!editorBody || !editor || !guideNameInput || !maxWidthInput || !previewPanel) {
        return null;
      }

      const bodyRect = editorBody.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const guideNameRect = guideNameInput.getBoundingClientRect();
      const maxWidthRect = maxWidthInput.getBoundingClientRect();
      return {
        editorOffsetTop: Math.round(editorRect.top - bodyRect.top),
        guideNameHeight: Math.round(guideNameRect.height),
        maxWidthHeight: Math.round(maxWidthRect.height),
        previewHeight: Math.round(previewPanel.getBoundingClientRect().height),
      };
    });
  }).toEqual({
    editorOffsetTop: expect.any(Number),
    guideNameHeight: expect.any(Number),
    maxWidthHeight: expect.any(Number),
    previewHeight: expect.any(Number),
  });
  const editorMetrics = await page.locator("#sizeGuideWorkspace").evaluate((workspace) => {
    const editorBody = workspace.querySelector(".size-guide-editor-panel .editor-body");
    const editor = workspace.querySelector(".size-preset-editor");
    const guideNameInput = workspace.querySelector("#sizePresetNameInput");
    const maxWidthInput = workspace.querySelector("#sizePresetMaxWidthInput");
    const previewPanel = workspace.querySelector(".size-preset-preview-panel");
    const bodyRect = editorBody.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return {
      editorOffsetTop: editorRect.top - bodyRect.top,
      guideNameHeight: guideNameInput.getBoundingClientRect().height,
      maxWidthHeight: maxWidthInput.getBoundingClientRect().height,
      previewHeight: previewPanel.getBoundingClientRect().height,
    };
  });

  expect(editorMetrics.editorOffsetTop).toBeLessThanOrEqual(24);
  expect(editorMetrics.guideNameHeight).toBeLessThanOrEqual(38);
  expect(editorMetrics.maxWidthHeight).toBeLessThanOrEqual(38);
  expect(editorMetrics.previewHeight).toBeGreaterThanOrEqual(260);
  const actionMetrics = await page.locator("#sizeGuideWorkspace").evaluate((workspace) => {
    const editor = workspace.querySelector(".size-preset-editor");
    const saveButton = workspace.querySelector("#saveSizePresetButton");
    const deleteButton = workspace.querySelector("#deleteSizePresetButton");
    const editorRect = editor.getBoundingClientRect();
    const saveRect = saveButton.getBoundingClientRect();
    const deleteRect = deleteButton.getBoundingClientRect();
    return {
      editorRight: editorRect.right,
      saveRight: saveRect.right,
      deleteRight: deleteRect.right,
    };
  });

  expect(actionMetrics.saveRight).toBeLessThanOrEqual(actionMetrics.editorRight + 1);
  expect(actionMetrics.deleteRight).toBeLessThanOrEqual(actionMetrics.editorRight + 1);
  await expect.poll(async () => {
    return page.locator("#sizeGuideWorkspace").evaluate((workspace) => {
      const list = workspace.querySelector("#sizePresetList");
      const editor = workspace.querySelector(".size-preset-editor");
      const leftPanel = workspace.querySelector(".orders-panel");
      const editorPanel = workspace.querySelector(".editor-panel");
      if (!list || !editor || !leftPanel || !editorPanel) {
        return null;
      }

      const leftPanelRect = leftPanel.getBoundingClientRect();
      const editorPanelRect = editorPanel.getBoundingClientRect();
      return {
        leftPanelLeft: Math.round(leftPanelRect.left),
        leftPanelRight: Math.round(leftPanelRect.right),
        editorPanelLeft: Math.round(editorPanelRect.left),
        editorPanelTop: Math.round(editorPanelRect.top),
        leftPanelTop: Math.round(leftPanelRect.top),
        listParentClass: list.parentElement?.className || "",
        editorPanelClass: editor.closest(".editor-panel")?.className || "",
        leftPanelClass: list.closest(".orders-panel")?.className || "",
      };
    });
  }).toEqual(expect.objectContaining({
    leftPanelLeft: expect.any(Number),
    leftPanelRight: expect.any(Number),
    editorPanelLeft: expect.any(Number),
    editorPanelTop: expect.any(Number),
    leftPanelTop: expect.any(Number),
    leftPanelClass: expect.stringContaining("orders-panel"),
    editorPanelClass: expect.stringContaining("editor-panel"),
  }));
  const layout = await page.locator("#sizeGuideWorkspace").evaluate((workspace) => {
    const leftPanelRect = workspace.querySelector(".orders-panel").getBoundingClientRect();
    const editorPanelRect = workspace.querySelector(".editor-panel").getBoundingClientRect();
    return {
      leftPanelRight: leftPanelRect.right,
      editorPanelLeft: editorPanelRect.left,
      leftPanelTop: leftPanelRect.top,
      editorPanelTop: editorPanelRect.top,
    };
  });

  expect(layout.leftPanelRight).toBeLessThanOrEqual(layout.editorPanelLeft);
  expect(Math.abs(layout.leftPanelTop - layout.editorPanelTop)).toBeLessThanOrEqual(1);

  await sizeGuide.locator(".size-preset-row", { hasText: "2.2 x 1.5 in" }).click();
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
  await assignedPresetLink.click();
  await expect(page).toHaveURL(/\/presets\/preset-c3e8a1d7f520$/);
  await expect(page.locator("#presetsWorkspace").getByRole("heading", { level: 2, name: "Preset Editor" })).toBeVisible();
  await expect(page.locator("#presetDraftName")).toHaveValue("Skywalk, Somekind");
});

test("uses a master-detail layout for preset selection and editing", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/presets");

  const presetsWorkspace = page.locator("#presetsWorkspace");
  await expect(presetsWorkspace.locator(".production-workspace")).toBeVisible();
  await expect(presetsWorkspace.locator(".preset-library-panel")).toBeVisible();
  await expect(presetsWorkspace.locator(".preset-editor-panel")).toBeVisible();
  await expect(presetsWorkspace.locator(".preset-library-panel").getByRole("heading", { name: "Presets" })).toBeVisible();
  await expect(presetsWorkspace.locator(".preset-editor-panel").getByRole("heading", { name: "Preset Editor" })).toBeVisible();
  await expect(presetsWorkspace.locator(".preset-library-panel #presetEditorSelect")).toHaveCount(0);
  await expect(presetsWorkspace.locator(".preset-library-panel .preset-library-row")).toHaveCount(4);
  await expect(presetsWorkspace.locator(".preset-library-row", { hasText: "New preset draft" })).toHaveCount(0);
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toContainText("All Candlepin");
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", "preset-a1f4c8e2b601");
  await expect(page.locator("#presetDraftName")).toHaveValue("All Candlepin");
  await expect(presetsWorkspace.locator(".preset-editor-panel #presetDraftName")).toBeVisible();

  const layout = await presetsWorkspace.evaluate((workspace) => {
    const leftPanel = workspace.querySelector(".preset-library-panel");
    const editorPanel = workspace.querySelector(".preset-editor-panel");
    if (!leftPanel || !editorPanel) {
      return null;
    }

    const leftRect = leftPanel.getBoundingClientRect();
    const editorRect = editorPanel.getBoundingClientRect();
    return {
      leftPanelRight: leftRect.right,
      editorPanelLeft: editorRect.left,
      leftPanelTop: leftRect.top,
      editorPanelTop: editorRect.top,
    };
  });

  expect(layout).toEqual(expect.objectContaining({
    leftPanelRight: expect.any(Number),
    editorPanelLeft: expect.any(Number),
    leftPanelTop: expect.any(Number),
    editorPanelTop: expect.any(Number),
  }));
  expect(layout.leftPanelRight).toBeLessThanOrEqual(layout.editorPanelLeft);
  expect(Math.abs(layout.leftPanelTop - layout.editorPanelTop)).toBeLessThanOrEqual(1);

  await presetsWorkspace.locator("#newPresetDraftButton").click();
  await expect(presetsWorkspace.locator(".preset-library-panel .preset-library-row")).toHaveCount(5);
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toContainText("New preset draft");

  await presetsWorkspace.locator(".preset-library-row", { hasText: "Skywalk, Somekind" }).click();
  await expect(page.locator("#presetDraftName")).toHaveValue("Skywalk, Somekind");
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", "preset-c3e8a1d7f520");
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toContainText("Skywalk, Somekind");
});

test("edits fixed designs saved on a preset in the preset editor", async ({ page }) => {
  const store = await installPresetRoutes(page);
  const lungsPreset = {
    ...store.snapshot.presets[0],
    id: "preset-lungs",
    name: "Lungs",
    fixedItems: [
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-lungs",
        fixedDesignName: "Lungs",
        fixedDesignVersion: 1,
        svgSizeMm: 44.5,
        offsetXMm: 0,
        offsetYMm: 0,
      },
      {
        kind: "fixedSvg",
        fixedDesignId: "fixed-design-lungs-backing",
        fixedDesignName: "Lungs Backing",
        fixedDesignVersion: 1,
        svgSizeMm: 51,
        offsetXMm: 0,
        offsetYMm: 1.1,
      },
    ],
  };
  store.snapshot.presets.push(lungsPreset);
  store.definitions.set(lungsPreset.id, lungsPreset);

  await page.goto("/presets/preset-lungs");

  const fixedItems = page.locator("#presetFixedItemList .preset-fixed-item-card");
  const lungsItem = page.locator('[data-fixed-design-id="fixed-design-lungs"]');
  const lungsBackingItem = page.locator('[data-fixed-design-id="fixed-design-lungs-backing"]');
  await expect(page.locator("#presetDraftName")).toHaveValue("Lungs");
  await expect(fixedItems).toHaveCount(2);
  await expect.poll(async () => fixedItems.evaluateAll((cards) => cards.every((card) => {
    const parentCard = card.parentElement?.closest(".line-control-card, .global-control-card");
    return parentCard == null;
  }))).toBe(true);
  await expect(lungsItem).toContainText("Fixed Design: Lungs");
  await expect(lungsItem.locator('[data-setting="svgSizeMm"]')).toHaveValue("44.5");
  await expect(lungsBackingItem).toContainText("Fixed Design: Lungs Backing");
  await expect(lungsBackingItem.locator('[data-setting="svgSizeMm"]')).toHaveValue("51");
  await expect(lungsBackingItem.locator('[data-setting="offsetYMm"]')).toHaveValue("1.1");

  await setRangeValue(page, '[data-fixed-design-id="fixed-design-lungs-backing"] [data-setting="offsetYMm"]', "2.4");
  await expect(page.getByRole("button", { name: "Save Preset" })).toBeEnabled();
  await page.getByRole("button", { name: "Save Preset" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved Lungs");

  const savedLungsPreset = store.snapshot.presets.find((preset) => preset.id === "preset-lungs");
  expect(savedLungsPreset.fixedItems).toEqual([
    expect.objectContaining({
      fixedDesignId: "fixed-design-lungs",
      svgSizeMm: 44.5,
      offsetYMm: 0,
    }),
    expect.objectContaining({
      fixedDesignId: "fixed-design-lungs-backing",
      svgSizeMm: 51,
      offsetYMm: 2.4,
    }),
  ]);
});

test("filters preset rows with the preset search field", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/presets");

  const presetsWorkspace = page.locator("#presetsWorkspace");
  const searchInput = presetsWorkspace.getByRole("searchbox", { name: "Search presets" });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveCSS("border-radius", "12px");
  await expect(presetsWorkspace.locator(".preset-library-row")).toHaveCount(4);

  await searchInput.fill("somekind");
  await expect(presetsWorkspace.locator(".preset-library-row")).toHaveCount(1);
  await expect(presetsWorkspace.locator(".preset-library-row")).toContainText("Skywalk, Somekind");

  await searchInput.fill("4439916732");
  await expect(presetsWorkspace.locator(".preset-library-row")).toHaveCount(1);
  await expect(presetsWorkspace.locator(".preset-library-row")).toContainText("Candlepin, Skywalk");

  await searchInput.fill("no matching preset");
  await expect(presetsWorkspace.locator(".preset-library-row")).toHaveCount(0);
  await expect(presetsWorkspace.locator(".preset-library-empty")).toContainText("No presets match the current search.");
});

test("shows fixed designs from the selected preset in fixed design cards", async ({ page }) => {
  await installPresetRoutes(page, {
    modifyStore(store) {
      const fixedDesigns = [
        {
          id: "fixed-stethoscope-rn",
          name: "Stethoscope RN",
          listingId: "1884223710",
          designText: "Morgan\nRN",
          note: "Keep the credential line locked.",
        },
        {
          id: "fixed-heart-badge",
          title: "Heart Badge",
          listingId: "1884223710",
          textLines: ["Avery", "LPN"],
        },
      ];
      const preset = store.definitions.get("preset-c3e8a1d7f520");
      preset.fixedDesigns = fixedDesigns;
      store.snapshot.presets = store.snapshot.presets.map((snapshotPreset) => (
        snapshotPreset.id === "preset-c3e8a1d7f520"
          ? { ...snapshotPreset, fixedDesigns }
          : snapshotPreset
      ));
    },
  });
  await page.goto("/presets/preset-c3e8a1d7f520");

  const fixedDesignSection = page.locator("#presetFixedDesignsSection");
  await expect(fixedDesignSection).toBeVisible();
  await expect(fixedDesignSection.getByRole("heading", { name: "Fixed Designs" })).toBeVisible();
  await expect(fixedDesignSection.locator(".preset-fixed-design-card")).toHaveCount(2);
  await expect(fixedDesignSection.locator(".preset-fixed-design-card").first()).toContainText("Stethoscope RN");
  await expect(fixedDesignSection.locator(".preset-fixed-design-card").first()).toContainText("Morgan / RN");
  await expect(fixedDesignSection.locator(".preset-fixed-design-card").first()).toContainText("Listing ID 1884223710");
  await expect(fixedDesignSection.locator(".preset-fixed-design-card").first()).toContainText("Keep the credential line locked.");

  await page.locator(".preset-library-row", { hasText: "All Candlepin" }).click();
  await expect(fixedDesignSection.locator(".preset-fixed-design-card")).toHaveCount(0);
  await expect(page.locator("#presetFixedDesignsEmptyState")).toContainText("No fixed designs are attached to this preset.");
});

test("applies fixed design text in production when selected preset is not linked to the listing", async ({ page }) => {
  await installPresetRoutes(page, {
    modifyStore(store) {
      const fixedDesigns = [
        {
          id: "fixed-radiology",
          name: "Radiology",
          designText: "Radiology\nTech",
        },
      ];
      const preset = store.definitions.get("preset-c3e8a1d7f520");
      preset.name = "Radiology";
      preset.fixedDesigns = fixedDesigns;
      store.snapshot.presets = store.snapshot.presets.map((snapshotPreset) => (
        snapshotPreset.id === "preset-c3e8a1d7f520"
          ? { ...snapshotPreset, name: "Radiology", fixedDesigns }
          : snapshotPreset
      ));
    },
  });
  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Custom name");
  await page.locator("#presetInput").selectOption("preset-c3e8a1d7f520");

  await expect(page.locator("#textInput")).toHaveValue("Radiology\nTech");
  await expect(page.locator("#lineControlCards .line-control-card")).toHaveCount(2);
});

test("enables preset saving only after editor changes", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/presets");

  const saveButton = page.getByRole("button", { name: "Save Preset" });
  const cancelButton = page.locator("#presetsWorkspace .preset-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(saveButton).toBeDisabled();
  await expect(cancelButton).toBeDisabled();

  await page.locator("#presetDraftName").fill("All Candlepin Updated");
  await expect(saveButton).toBeEnabled();
  await expect(cancelButton).toBeEnabled();

  await saveButton.click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved All Candlepin Updated");
  await expect(saveButton).toBeDisabled();
  await expect(cancelButton).toBeDisabled();
});

test("cancels creating a new preset draft", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/presets");
  await page.getByRole("button", { name: "New Preset" }).click();

  const presetsWorkspace = page.locator("#presetsWorkspace");
  const cancelButton = presetsWorkspace.locator(".preset-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toContainText("New preset draft");
  await expect(cancelButton).toBeEnabled();
  await expect(page.locator("#presetDraftName")).toHaveAttribute("placeholder", "Enter preset name");
  await expect(page.locator("#presetDraftName")).toBeFocused();

  await page.locator("#presetDraftName").fill("Temporary Preset");
  await cancelButton.click();

  await expect(presetsWorkspace.getByText("Temporary Preset", { exact: true })).toHaveCount(0);
  await expect(presetsWorkspace.locator(".preset-library-row.is-selected")).toContainText("All Candlepin");
  await expect(page.locator("#presetDraftName")).toHaveValue("All Candlepin");
  await expect(page.locator("#presetEditorStatus")).toContainText("Canceled preset draft.");
  await expect(cancelButton).toBeDisabled();
});

test("cancels edits to the selected preset", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/presets");

  const cancelButton = page.locator("#presetsWorkspace .preset-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeDisabled();

  await page.locator("#presetDraftName").fill("Temporary Preset");
  await expect(page.locator("#presetDraftName")).toHaveValue("Temporary Preset");
  await expect(cancelButton).toBeEnabled();

  await cancelButton.click();

  await expect(page.locator("#presetDraftName")).toHaveValue("All Candlepin");
  await expect(page.locator("#presetEditorStatus")).toContainText("Canceled changes to All Candlepin.");
  await expect(cancelButton).toBeDisabled();
});

test("shows a live preview while editing a size guide", async ({ page }) => {
  await page.goto("/size-guides");
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();
  await page.getByRole("button", { name: "New Guide" }).click();
  await expect(page.getByLabel("Size Guides").locator(".size-preset-row.is-selected")).toContainText("New guide draft");

  const preview = page.locator("#sizePresetPreview");
  await expect(preview).toBeVisible();

  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.locator("#sizePresetMinWidthInput").fill("2");
  await page.locator("#sizePresetMinHeightInput").fill("1.25");
  await page.locator("#sizePresetCircleDiameterInput").fill("");

  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeHidden();
  await expect(preview.locator(".preview-guide-box").first()).toBeVisible();

  await page.locator("#sizePresetCircleDiameterInput").fill("1.5");
  await expect(preview.locator("circle.preview-guide-box")).toHaveCount(1);
});

test("creates a visible size guide draft with a derived read-only name and optional minimums", async ({ page }) => {
  await installPresetRoutes(page);
  await openSizeGuidesWorkspace(page);
  await page.getByRole("button", { name: "New Guide" }).click();

  const sizeGuides = page.getByLabel("Size Guides");
  const draftRow = sizeGuides.locator(".size-preset-row.is-selected");
  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(draftRow).toContainText("New guide draft");
  await expect(cancelButton).toBeEnabled();
  await expect(page.locator("#sizePresetNameInput")).toBeEditable({ editable: false });

  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.locator("#sizePresetMaxWidthInput").fill("3");

  await expect(page.locator("#sizePresetNameInput")).toHaveValue("3 x 2");
  await expect(draftRow).toContainText("3 x 2");
  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeHidden();

  const saveButton = page.getByRole("button", { name: "Save Guide" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved 3 x 2");
  await expect(sizeGuides.getByText("3 x 2", { exact: true })).toBeVisible();
});

test("cancels creating a new size guide draft", async ({ page }) => {
  await installPresetRoutes(page);
  await openSizeGuidesWorkspace(page);
  await page.getByRole("button", { name: "New Guide" }).click();

  const sizeGuides = page.getByLabel("Size Guides");
  await expect(sizeGuides.locator(".size-preset-row.is-selected")).toContainText("New guide draft");

  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(sizeGuides.getByText("3 x 2", { exact: true })).toHaveCount(0);
  await expect(sizeGuides.locator(".size-preset-row.is-selected")).toContainText("2.2 x 1.5 in");
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Canceled size guide draft.");
});

test("cancels edits to the selected size guide", async ({ page }) => {
  await installPresetRoutes(page);
  await openSizeGuidesWorkspace(page);
  await expectDefaultSizeGuideLoaded(page);

  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeDisabled();

  await setRangeValue(page, "#sizePresetMaxWidthInput", 2.3);
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.3 x 1.5");
  await expect(cancelButton).toBeEnabled();

  await cancelButton.click();

  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5");
  await expect(page.locator("#sizePresetMaxWidthInput")).toHaveValue("2.2");
  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Canceled changes to 2.2 x 1.5 in.");
  await expect(cancelButton).toBeDisabled();
});

test("enables size guide saving only after editor changes", async ({ page }) => {
  await installPresetRoutes(page);
  await openSizeGuidesWorkspace(page);
  await expectDefaultSizeGuideLoaded(page);

  const saveButton = page.getByRole("button", { name: "Save Guide" });
  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(saveButton).toBeDisabled();
  await expect(cancelButton).toBeDisabled();

  await setRangeValue(page, "#sizePresetMaxWidthInput", 2.3);
  await expect(saveButton).toBeEnabled();
  await expect(cancelButton).toBeEnabled();

  await saveButton.click();
  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved 2.3 x 1.5");
  await expect(saveButton).toBeDisabled();
  await expect(cancelButton).toBeDisabled();
});

test("preserves the size guide when saving and reloading a layout preset", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");
  await clickBatchAction(page, "Add Design");

  await page.locator("#boundingSizePresetInput").selectOption("size-2-2x1-5");
  await clickPresetAction(page, "Save as New Preset");
  await expect(page.locator("#savePresetAsDialog")).toBeVisible();
  await page.locator("#savePresetAsNameInput").fill("Default Size Preset");
  await page.locator("#savePresetAsDialog").getByRole("button", { name: "Save Preset", exact: true }).click();

  const createdPresetId = await page.locator("#presetInput").inputValue();
  await page.locator("#presetInput").selectOption("preset-a1f4c8e2b601");
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#boundingSizePresetInput")).toHaveValue("size-2-2x1-5");
});

test("saves a new preset from the design editor without switching to the preset editor", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Editor Save ${nonce}`;

  await installPresetRoutes(page);
  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");
  await setRangeValue(page, "#backingInput", 4.4);

  await clickPresetAction(page, "Save as New Preset");

  await expect(page.locator("#ordersWorkspace")).toBeVisible();
  await expect(page.locator("#savePresetAsDialog")).toBeVisible();
  await expect(page.locator("#savePresetAsNameInput")).toHaveValue("");
  await expect(page.locator("#savePresetAsNameInput")).toHaveAttribute("placeholder", "Enter the preset name");
  await expect(page.locator("#savePresetAsNameInput")).toBeFocused();
  await expect.poll(async () => {
    return page.locator("#savePresetAsDialog").evaluate((dialog) => ({
      horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
      verticalOverflow: dialog.scrollHeight > dialog.clientHeight,
    }));
  }).toEqual({
    horizontalOverflow: false,
    verticalOverflow: false,
  });
  await page.locator("#savePresetAsNameInput").fill(createdPresetName);
  await page.locator("#savePresetAsDialog").getByRole("button", { name: "Save Preset", exact: true }).click();

  await expect(page.locator("#savePresetAsDialog")).not.toBeVisible();
  await expect(page.locator("#workflowAlertText")).toContainText(`Saved ${createdPresetName}`);

  const createdPresetId = await page.locator("#presetInput").inputValue();
  await expect(page.locator(`#presetInput option[value="${createdPresetId}"]`)).toHaveText(createdPresetName);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

  await page.locator("#presetInput").selectOption("preset-a1f4c8e2b601");
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");
  await expect(page.locator("#ordersWorkspace")).toBeVisible();
  await expect(page.locator("#presetsWorkspace")).toBeHidden();
});

test("creates a custom size guide and uses it in the order editor preview", async ({ page }) => {
  await installPresetRoutes(page);

  await page.goto("/size-guides");
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("3 x 2");
  await clickEnabledButton(page, "#saveSizePresetButton");

  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved 3 x 2");
  await expect(page.getByLabel("Size Guides").getByText("3 x 2", { exact: true })).toBeVisible();

  await page.goto("/production-batch");
  await clickBatchAction(page, "Add Design");
  await page.locator("#boundingSizePresetInput").selectOption({ label: "3 x 2" });

  await expect(page.locator("#boundingSizePresetInput")).toHaveValue(/size-/);
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('3"');
  await expect(page.locator("#preview .preview-guide-label").nth(1)).toHaveText('2"');
  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(0);

  await page.goto("/size-guides");
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetMaxHeightInput").fill("1.75");
  await page.locator("#sizePresetMaxWidthInput").fill("2.5");
  await page.locator("#sizePresetMinWidthInput").fill("1.5");
  await page.locator("#sizePresetMinHeightInput").fill("1");
  await page.locator("#sizePresetCircleDiameterInput").fill("1.75");
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.5 x 1.75");
  await clickEnabledButton(page, "#saveSizePresetButton");

  await page.goto("/production-batch");
  await clickBatchAction(page, "Add Design");
  await page.locator("#boundingSizePresetInput").selectOption({ label: "2.5 x 1.75" });

  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(1);
  await expect.poll(async () => {
    const radius = Number(await page.locator("#preview circle.preview-guide-box").getAttribute("r"));
    return radius * 2;
  }).toBeCloseTo(1.75 * 25.4, 4);
});

test("remembers the collapsed left nav state after refresh", async ({ page }) => {
  await page.goto("/");

  const appShell = page.locator(".app-shell");
  await expect(appShell).toHaveAttribute("data-nav-collapsed", "false");

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(appShell).toHaveAttribute("data-nav-collapsed", "true");

  await page.reload();

  await expect(appShell).toHaveAttribute("data-nav-collapsed", "true");
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
});

test("applies the stored collapsed left nav state before the app module loads", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("thankfulforyou.workspaceNavCollapsed", "true");
  });
  await page.route("**/src/app.js", async () => {
    await new Promise(() => {});
  });

  await page.goto("/", { waitUntil: "commit" });
  await page.locator(".workspace-nav").waitFor();

  await expect(page.locator(".app-shell")).toHaveAttribute("data-nav-collapsed", "true");
});

test("can create a new preset from order settings and update an existing preset", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Morgan RN ${nonce}`;
  const renamedPresetName = `Morgan RN Updated ${nonce}`;
  const overwrittenPresetBackingMm = 3.3;
  const overwrittenSecondLineSizeMm = 27;
  const listingId = `task4-listing-${nonce}`;
  const importPayload = JSON.stringify([
    {
      orderNumber: `TASK4-${nonce}`,
      listingId,
      buyerName: "Casey Tester",
      personalization: "Casey\nRN",
      listingTitle: "Task 4 Listing",
      quantity: 1,
    },
  ]);

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");
  await setRangeValue(page, "#backingInput", 4.4);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 23);

  const createdPresetId = await saveNewPresetFromDesignEditor(page, createdPresetName);
  await expect(page.locator("#workflowAlertText")).toContainText(`Saved ${createdPresetName}`);
  await expect(page.locator(`#presetInput option[value="${createdPresetId}"]`)).toHaveText(createdPresetName);
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");

  await page.getByRole("button", { name: "Presets" }).click();
  const presetWorkspace = page.getByRole("region", { name: "Preset editor workspace" });
  await expect(presetWorkspace).toBeVisible();
  await expect(presetWorkspace).not.toContainText("tools will land here next");
  await selectPresetEditorRow(page, createdPresetName);
  await expect(page.locator("#presetBackingInput")).toBeVisible();
  await expect(page.locator("#presetGlobalHorizontalScaleInput")).toBeVisible();
  await expect(page.locator("#presetGlobalVerticalScaleInput")).toBeVisible();
  await expect(page.locator('[data-preset-rule-key="lineDefaults"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-rule-key="first"] [data-setting="fontSizeMm"]')).toBeVisible();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await completeDesign(page, "Design 1");
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Taylor\nRN");
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await page.locator("#orderList .order-row").filter({ hasText: "Design 2" }).click();
  await setRangeValue(page, "#backingInput", overwrittenPresetBackingMm);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', overwrittenSecondLineSizeMm);
  await clickPresetAction(page, "Overwrite");
  await page.locator("#presetInput").selectOption("preset-a1f4c8e2b601");
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#backingInput")).toHaveValue(String(overwrittenPresetBackingMm));
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue(String(overwrittenSecondLineSizeMm));

  await page.getByRole("button", { name: "Presets" }).click();
  await selectPresetEditorRow(page, createdPresetName);
  await expect(page.locator("#presetDraftName")).toHaveValue(createdPresetName);
  await setRangeValue(page, "#presetBackingInput", 5.1);
  await setRangeValue(page, '[data-preset-rule-key="first"] [data-setting="fontSizeMm"]', 21);
  await page.locator("#presetDraftName").fill(renamedPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();

  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", createdPresetId);
  await expect(page.locator(".preset-library-row.is-selected")).toContainText(renamedPresetName);

  await page.getByRole("button", { name: "Production Batch" }).click();
  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" })).toContainText("Complete");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 2" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

  await setClipboardPayload(page, importPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");
  await expect(page.locator("#presetInput")).not.toHaveValue(createdPresetId);

  await page.locator("#presetInput").selectOption(createdPresetId);
  await setRangeValue(page, "#backingInput", 1.0);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 40);
  await expect(page.locator("#backingInput")).toHaveValue("1");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("40");

  await clickPresetAction(page, "Assign Preset to Listing");
  const assignmentDialog = page.locator("#presetAssignmentDialog");
  await expect(assignmentDialog).toBeVisible();
  await expect(assignmentDialog.locator(".batch-summary-card")).toHaveClass(/batch-summary-card-success/);
  await expect(assignmentDialog.locator(".batch-summary-success-icon")).toBeVisible();
  await expect(assignmentDialog).toContainText(renamedPresetName);
  await expect(assignmentDialog).toContainText(listingId);
  await page.getByRole("button", { name: "Close assignment confirmation" }).click();
  await expect(assignmentDialog).not.toBeVisible();
  await expect(page.locator("#importStatus")).toContainText("Assigned");
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="0"] [data-setting="fontSizeMm"]')).toHaveValue("21");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue(String(overwrittenSecondLineSizeMm));
  await expect(page.locator("#backingInput")).toHaveValue("5.1");
});

test("assigning a preset to a completed imported order clears stale batch-export readiness", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Avery RN ${nonce}`;
  const listingId = `assigned-listing-${nonce}`;
  const importPayload = JSON.stringify([
    {
      orderNumber: `ASSIGN-${nonce}`,
      listingId,
      buyerName: "Avery Tester",
      personalization: "Avery\nRN",
      listingTitle: "Assigned Listing",
      quantity: 1,
    },
  ]);

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Avery\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");
  await setRangeValue(page, "#backingInput", 4.4);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 23);

  const createdPresetId = await saveNewPresetFromDesignEditor(page, createdPresetName);
  await completeDesign(page, "Design 1");

  await setClipboardPayload(page, importPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");

  await page.locator("#presetInput").selectOption(createdPresetId);
  await setRangeValue(page, "#backingInput", 1.1);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 40);
  await expect(page.locator("#downloadButton")).toBeDisabled();

  await page.locator("#captureButton").click();
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await clickPresetAction(page, "Assign Preset to Listing");
  await expect(page.locator("#presetAssignmentDialog")).toBeVisible();
  await page.getByRole("button", { name: "Close assignment confirmation" }).click();
  await expect(page.locator("#presetAssignmentDialog")).not.toBeVisible();
  await expect(page.locator("#importStatus")).toContainText("Assigned");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#downloadButton")).toBeDisabled();

  await openBatchTools(page);
  await expect(page.getByRole("button", { name: "Export All Designs" })).toBeDisabled();
});

test("renaming a preset while analysis is running still restores export readiness when analysis finishes", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Jordan RN ${nonce}`;
  const renamedPresetName = `Jordan RN Updated ${nonce}`;

  await installPresetRoutes(page);
  const pendingAnalyses = await installDelayedAnalysisRoute(page);

  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Jordan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");
  await setRangeValue(page, "#backingInput", 4.4);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 23);

  const createdPresetId = await saveNewPresetFromDesignEditor(page, createdPresetName);
  await page.locator("#presetInput").selectOption(createdPresetId);
  await page.locator("#captureButton").click();

  await expect.poll(() => pendingAnalyses.length, { timeout: 10000 }).toBe(1);
  await expect(page.locator("#connectionStatusLabel")).toContainText("Analyzing completed layout...");

  await page.getByRole("button", { name: "Presets" }).click();
  await selectPresetEditorRow(page, createdPresetName);
  await page.locator("#presetDraftName").fill(renamedPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", createdPresetId);

  const pendingAnalysis = pendingAnalyses.shift();
  await pendingAnalysis.fulfill();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect.poll(async () => page.locator("#downloadButton").isEnabled(), { timeout: 20000 }).toBe(true);
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" })).toContainText("Complete");
});

test("shows assigned listings for a preset and lets operators unassign them", async ({ page }) => {
  const importPayload = JSON.stringify([
    {
      orderNumber: "UNASSIGN-1884223710",
      listingId: "1884223710",
      buyerName: "Preset Assignment Tester",
      personalization: "Morgan\nRN",
      listingTitle: "Skywalk + Somekind listing with shorter second line",
      quantity: 1,
    },
  ]);
  const freshImportPayload = JSON.stringify([
    {
      orderNumber: "UNASSIGN-1884223710-NEW",
      listingId: "1884223710",
      buyerName: "Preset Assignment Tester",
      personalization: "Morgan\nRN",
      listingTitle: "Skywalk + Somekind listing with shorter second line",
      quantity: 1,
    },
  ]);

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });
  await page.goto("/");

  await setClipboardPayload(page, importPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");
  await expect(page.locator("#presetInput")).toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Linked");

  await setRangeValue(page, "#backingInput", 3.2);
  await page.locator("#captureButton").click();
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await page.getByRole("button", { name: "Presets" }).click();
  await selectPresetEditorRow(page, "Skywalk, Somekind");
  await expect(page.locator("#presetEditorStatus")).toContainText("Editing Skywalk, Somekind.");
  await expect(page.locator("#presetAssignmentsEmptyState")).toBeHidden();

  const assignmentRow = page.locator(".preset-assignment-row").filter({ hasText: "1884223710" });
  await expect(assignmentRow).toContainText("Skywalk + Somekind listing with shorter second line");
  await expect(assignmentRow).toContainText("Listing ID 1884223710");

  await assignmentRow.getByRole("button", { name: "Unassign listing 1884223710" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Unassigned listing 1884223710 from Skywalk, Somekind.");
  await expect(page.locator(".preset-assignment-row")).toHaveCount(0);
  await expect(page.locator("#presetAssignmentsEmptyState")).toContainText("No Etsy listings are currently assigned to this preset.");

  await page.getByRole("button", { name: "Production Batch" }).click();
  await expect(page.locator("#presetInput")).not.toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator("#downloadButton")).toBeDisabled();

  await setClipboardPayload(page, freshImportPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");
  await expect(page.locator("#presetInput")).not.toHaveValue("preset-c3e8a1d7f520");
});

test("confirms before moving a listing id link to a different preset", async ({ page }) => {
  const listingId = "1884223710";
  const importPayload = JSON.stringify([
    {
      orderNumber: "MOVE-1884223710",
      listingId,
      buyerName: "Listing Move Tester",
      personalization: "Morgan\nRN",
      listingTitle: "Skywalk + Somekind listing with shorter second line",
      quantity: 1,
    },
  ]);

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });
  await page.goto("/");

  await setClipboardPayload(page, importPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");
  await page.locator("#presetInput").selectOption("preset-b7d2e9f4c318");

  await clickPresetAction(page, "Assign Preset to Listing");
  await expect(page.locator("#confirmationDialog")).toBeVisible();
  await expect(page.locator("#confirmationDialogTitle")).toHaveText("Move listing link?");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("Skywalk, Somekind");
  await expect(page.locator("#confirmationDialogDescription")).toContainText("Candlepin, Skywalk");
  await expect(page.locator("#confirmationDialogDescription")).toContainText(listingId);
  await page.getByRole("button", { name: "Change Link" }).click();

  await expect(page.locator("#presetAssignmentDialog")).toBeVisible();
  await page.getByRole("button", { name: "Close assignment confirmation" }).click();

  await page.getByRole("button", { name: "Presets" }).click();
  await selectPresetEditorRow(page, "Candlepin, Skywalk");
  await expect(page.locator("#presetAssignmentsList")).toContainText(listingId);
  await expect(page.locator("#presetAssignmentsList")).toContainText("4439916732");

  await selectPresetEditorRow(page, "Skywalk, Somekind");
  await expect(page.locator("#presetAssignmentsList")).not.toContainText(listingId);
});

test("refresh restores imported listings to their assigned preset", async ({ page }) => {
  await installPresetRoutes(page);
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "order-linked-stale-preset",
        orderItems: [
          {
            id: "order-linked-stale-preset",
            text: "Morgan\nRN",
            status: "in-progress",
            settings: {
              text: "Morgan\nRN",
              presetId: "preset-a1f4c8e2b601",
              backingMm: 3.1,
              weldExportedDesign: true,
              lines: [
                { fontId: "candlepin", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false },
                { fontId: "candlepin", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false },
              ],
            },
            source: {
              listingId: "1884223710",
              listingTitle: "Skywalk + Somekind listing with shorter second line",
              manualPresetOverride: true,
            },
          },
        ],
      }),
    });
  });

  await page.goto("/");

  await expect(page.locator("#presetInput")).toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Linked");
});

test("marks listing-assigned presets inline beside the preset name label", async ({ page }) => {
  const importPayload = JSON.stringify([
    {
      orderNumber: "LINKED-1884223710",
      listingId: "1884223710",
      buyerName: "Preset Link Tester",
      personalization: "Jordan\nRN",
      listingTitle: "Skywalk + Somekind listing with shorter second line",
      quantity: 1,
    },
  ]);

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });
  await page.goto("/");

  await setClipboardPayload(page, importPayload);
  await pasteProductionBatchClipboard(page);
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design and added 1 to the production batch.");
  await expect(page.locator("#presetInput")).toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Linked");
  await expect(page.locator("#presetListingIndicator")).toHaveAttribute("title", /assigned to the selected preset/);

  await page.locator("#presetInput").selectOption("preset-a1f4c8e2b601");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Preset overriden");
  await expect(page.locator("#presetListingIndicator")).toHaveClass(/preset-listing-indicator-warning/);
  await expect(page.locator("#presetListingIndicator")).toHaveAttribute("title", /overrides the linked preset Skywalk, Somekind/);
});

test("deletes a saved preset only after confirmation and migrates active uses away from it", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Delete Me ${nonce}`;

  await installPresetRoutes(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.goto("/");

  await clickBatchAction(page, "Add Design");
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");

  const createdPresetId = await saveNewPresetFromDesignEditor(page, createdPresetName);
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

  await page.getByRole("button", { name: "Presets" }).click();
  await selectPresetEditorRow(page, createdPresetName);

  await page.getByRole("button", { name: "Delete Preset" }).click();
  const dialog = page.locator("#confirmationDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#confirmationDialogTitle")).toHaveText("Delete Preset?");
  await expect(dialog.locator("#confirmationDialogDescription")).toContainText(createdPresetName);
  await dialog.locator("#confirmationDialogCancelButton").click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".preset-library-row.is-selected")).toHaveAttribute("data-preset-id", createdPresetId);

  await page.getByRole("button", { name: "Delete Preset" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator("#confirmationDialogConfirmButton").click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#presetEditorStatus")).toContainText("Deleted");
  await expect(page.locator(`.preset-library-row[data-preset-id="${createdPresetId}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "Production Batch" }).click();
  await expect(page.locator("#presetInput")).not.toHaveValue(createdPresetId);
  await expect(page.locator(`#presetInput option[value="${createdPresetId}"]`)).toHaveCount(0);
});
