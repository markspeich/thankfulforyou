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

async function installPresetRoutes(page) {
  const store = await createPresetFixtureStore();

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
  if (await page.locator("#ordersWorkspace").isHidden()) {
    await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  }
  const menu = page.locator(".batch-header .batch-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await page.locator(".batch-header .batch-tools-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
}

async function clickBatchAction(page, name) {
  await openBatchTools(page);
  await page.getByRole("button", { name }).click();
}

async function pasteProductionBatchClipboard(page) {
  if (await page.locator("#ordersWorkspace").isHidden()) {
    await page.getByRole("button", { name: "Production Batch", exact: true }).click();
  }
  await page.locator("#importClipboardButton").click();
}

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

test.beforeEach(async ({ page, request }) => {
  await installSupabaseSession(page);
  await installDefaultProductionBatchRoutes(page);
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
  await expect(page.getByRole("button", { name: "Production Batch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fonts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Size Guides" })).toBeVisible();
  await expect.poll(async () => {
    return page.getByRole("button", { name: "Size Guides" }).evaluate((button) => Math.round(button.getBoundingClientRect().height));
  }).toBeLessThanOrEqual(54);
  await expect(databaseOrdersWorkspace).toBeVisible();
  await expect(ordersWorkspace).toBeHidden();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await expect(ordersWorkspace).toBeVisible();
  await expect(databaseOrdersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(fontsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Presets" }).click();
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

  await page.getByRole("button", { name: "Fonts" }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(fontsWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Fonts workspace" })).toBeVisible();
  await expect(fontsWorkspace.getByRole("heading", { name: "Fonts" })).toBeVisible();
  await expect(fontsWorkspace.getByRole("button", { name: /Candlepin Laser/ })).toBeVisible();
  await expect(fontsWorkspace.getByRole("button", { name: "Delete font" })).toBeDisabled();
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

  await page.getByRole("button", { name: "Size Guides" }).click();
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

  await page.getByRole("button", { name: "Production Batch" }).click();
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
            is_builtin: false,
            deleted_at: null,
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
});

test("shows size guides in the Size Guides workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();

  const sizeGuide = page.locator("#sizeGuideWorkspace");
  await expect(sizeGuide.getByRole("heading", { level: 1, name: "Size Guides" })).toBeVisible();
  await expect(sizeGuide.getByRole("heading", { level: 2, name: "Size Guide Editor" })).toBeVisible();
  await expect(sizeGuide.getByText("2.2 x 1.5 in", { exact: true })).toBeVisible();
  await expect(sizeGuide.getByText("Max 2.2 x 1.5 in")).toBeVisible();
  await expect(sizeGuide.getByText("Min 1.6 x 1.1 in")).toBeVisible();
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
});

test("uses a master-detail layout for preset selection and editing", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();

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

test("enables preset saving only after editor changes", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();

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
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();
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
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();

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
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();

  const preview = page.locator("#sizePresetPreview");
  await expect(preview).toBeVisible();
  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeVisible();

  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.locator("#sizePresetMinWidthInput").fill("2");
  await page.locator("#sizePresetMinHeightInput").fill("1.25");

  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeHidden();
  await expect(preview.locator(".preview-guide-box").first()).toHaveAttribute("width", String(3 * 25.4));
  await expect(preview.locator(".preview-guide-box").first()).toHaveAttribute("height", String(2 * 25.4));
  await expect(preview.locator("rect.preview-guide-box")).not.toHaveAttribute("rx", /.+/);
  await expect(preview.locator(".preview-guide-min-box")).not.toHaveAttribute("rx", /.+/);
  await expect(preview.locator(".preview-guide-label").first()).toHaveText('3"');
  await expect(preview.locator(".preview-guide-label").nth(1)).toHaveText('2"');
  await expect(preview.locator("circle.preview-guide-box")).toHaveCount(0);

  await page.locator("#sizePresetCircleDiameterInput").fill("1.5");
  await expect(preview.locator("circle.preview-guide-box")).toHaveCount(1);
  await expect.poll(async () => {
    const radius = Number(await preview.locator("circle.preview-guide-box").getAttribute("r"));
    return radius * 2;
  }).toBeCloseTo(1.5 * 25.4, 4);
});

test("creates a visible size guide draft with a derived read-only name and optional minimums", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();

  const sizeGuides = page.getByLabel("Size Guides");
  const draftRow = sizeGuides.locator(".size-preset-row.is-selected");
  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(draftRow).toContainText("New guide draft");
  await expect(cancelButton).toBeEnabled();
  await expect(page.locator("#sizePresetNameInput")).toBeEditable({ editable: false });

  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("3 x H");

  await page.locator("#sizePresetMaxHeightInput").fill("2");

  await expect(page.locator("#sizePresetNameInput")).toHaveValue("3 x 2");
  await expect(draftRow).toContainText("3 x 2");
  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeHidden();

  await page.getByRole("button", { name: "Save Guide" }).click();
  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved 3 x 2");
  await expect(sizeGuides.getByText("3 x 2", { exact: true })).toBeVisible();
});

test("cancels creating a new size guide draft", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();
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
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();

  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeDisabled();

  await page.locator("#sizePresetMaxWidthInput").fill("2.3");
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
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();

  const saveButton = page.getByRole("button", { name: "Save Guide" });
  const cancelButton = page.locator("#sizeGuideWorkspace .size-guide-editor-panel .editor-header")
    .getByRole("button", { name: "Cancel" });
  await expect(saveButton).toBeDisabled();
  await expect(cancelButton).toBeDisabled();

  await page.locator("#sizePresetMaxWidthInput").fill("2.3");
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
  await page.goto("/");

  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.getByRole("button", { name: "Save Guide" }).click();

  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved 3 x 2");
  await expect(page.getByLabel("Size Guides").getByText("3 x 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await clickBatchAction(page, "Add Design");
  await page.locator("#boundingSizePresetInput").selectOption({ label: "3 x 2" });

  await expect(page.locator("#boundingSizePresetInput")).toHaveValue(/size-/);
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('3"');
  await expect(page.locator("#preview .preview-guide-label").nth(1)).toHaveText('2"');
  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(0);

  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetMaxWidthInput").fill("2.5");
  await page.locator("#sizePresetMaxHeightInput").fill("1.75");
  await page.locator("#sizePresetMinWidthInput").fill("1.5");
  await page.locator("#sizePresetMinHeightInput").fill("1");
  await page.locator("#sizePresetCircleDiameterInput").fill("1.75");
  await page.getByRole("button", { name: "Save Guide" }).click();

  await page.getByRole("button", { name: "Production Batch" }).click();
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

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).click();
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
