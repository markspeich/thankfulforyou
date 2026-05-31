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

async function selectPresetEditorRow(page, name) {
  await page.locator(".preset-library-row", { hasText: name }).click();
}

async function selectedPresetEditorRowId(page) {
  return page.locator(".preset-library-row.is-selected").getAttribute("data-preset-id");
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
  const presetsWorkspace = page.locator("#presetsWorkspace");
  const sizeGuideWorkspace = page.locator("#sizeGuideWorkspace");
  const editorPanel = page.getByLabel("Selected design editor");

  await expect(page.getByRole("button", { name: "Production Batch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Size Guides" })).toBeVisible();
  await expect(ordersWorkspace).toBeVisible();
  await expect(presetsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Presets" }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await expect(presetsWorkspace).toBeVisible();
  await expect(sizeGuideWorkspace).toBeHidden();

  await page.getByRole("button", { name: "Size Guides" }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(presetsWorkspace).toBeHidden();
  await expect(sizeGuideWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Size guides workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await expect(page.getByRole("region", { name: "Order items workspace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeHidden();
  await expect(sizeGuideWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(appShell).toHaveAttribute("data-nav-collapsed", "true");
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
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5 in");
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
  await expect(page.locator("#sizePresetNameInput")).toHaveValue("2.2 x 1.5 in");
});

test("uses a master-detail layout for preset selection and editing", async ({ page }) => {
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

test("shows a live preview while editing a size guide", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();

  const preview = page.locator("#sizePresetPreview");
  await expect(preview).toBeVisible();
  await expect(page.locator("#sizePresetPreviewEmptyState")).toBeVisible();

  await page.locator("#sizePresetNameInput").fill("Preview Box");
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

test("preserves the size guide when saving and reloading a layout preset", async ({ page }) => {
  await page.goto("/");
  await clickBatchAction(page, "Add Design");

  await page.locator("#boundingSizePresetInput").selectOption("size-2-2x1-5");
  await clickPresetAction(page, "Save as New Preset");
  await page.locator("#presetDraftName").fill("Default Size Preset");
  await expect(page.locator("#presetBoundingSizePresetInput")).toHaveValue("size-2-2x1-5");
});

test("creates a custom size guide and uses it in the order editor preview", async ({ page }) => {
  await installPresetRoutes(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetNameInput").fill("Test Box");
  await page.locator("#sizePresetMaxWidthInput").fill("3");
  await page.locator("#sizePresetMaxHeightInput").fill("2");
  await page.locator("#sizePresetMinWidthInput").fill("2");
  await page.locator("#sizePresetMinHeightInput").fill("1.25");
  await page.getByRole("button", { name: "Save Guide" }).click();

  await expect(page.locator("#sizePresetEditorStatus")).toContainText("Saved Test Box");
  await expect(page.getByLabel("Size Guides").getByText("Test Box", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await clickBatchAction(page, "Add Design");
  await page.locator("#boundingSizePresetInput").selectOption({ label: "Test Box" });

  await expect(page.locator("#boundingSizePresetInput")).toHaveValue(/size-/);
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('3"');
  await expect(page.locator("#preview .preview-guide-label").nth(1)).toHaveText('2"');
  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(0);

  await page.getByRole("button", { name: "Size Guides" }).click();
  await page.getByRole("button", { name: "New Guide" }).click();
  await page.locator("#sizePresetNameInput").fill("Circle Box");
  await page.locator("#sizePresetMaxWidthInput").fill("2.5");
  await page.locator("#sizePresetMaxHeightInput").fill("1.75");
  await page.locator("#sizePresetMinWidthInput").fill("1.5");
  await page.locator("#sizePresetMinHeightInput").fill("1");
  await page.locator("#sizePresetCircleDiameterInput").fill("1.75");
  await page.getByRole("button", { name: "Save Guide" }).click();

  await page.getByRole("button", { name: "Production Batch" }).click();
  await page.locator("#boundingSizePresetInput").selectOption({ label: "Circle Box" });

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

  await clickPresetAction(page, "Save as New Preset");
  const presetWorkspace = page.getByRole("region", { name: "Preset editor workspace" });
  await expect(presetWorkspace).toBeVisible();
  await expect(presetWorkspace).not.toContainText("tools will land here next");
  await expect(page.locator("#presetBackingInput")).toBeVisible();
  await expect(page.locator("#presetGlobalHorizontalScaleInput")).toBeVisible();
  await expect(page.locator("#presetGlobalVerticalScaleInput")).toBeVisible();
  await expect(page.locator('[data-preset-rule-key="lineDefaults"]')).toHaveCount(0);
  await expect(page.locator('[data-preset-rule-key="first"] [data-setting="fontSizeMm"]')).toBeVisible();
  await page.locator("#presetDraftName").fill(createdPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();

  let createdPresetId = "";
  await expect.poll(async () => {
    createdPresetId = await selectedPresetEditorRowId(page) || "";
    return createdPresetId !== "";
  }, { timeout: 10000 }).toBe(true);
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator(".preset-library-row.is-selected")).toContainText(createdPresetName);

  await page.getByRole("button", { name: "Production Batch" }).click();
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");

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
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");
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

  await clickPresetAction(page, "Save as New Preset");
  await page.locator("#presetDraftName").fill(createdPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();
  let createdPresetId = "";
  await expect.poll(async () => {
    createdPresetId = await selectedPresetEditorRowId(page) || "";
    return createdPresetId !== "";
  }, { timeout: 10000 }).toBe(true);
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");

  await page.getByRole("button", { name: "Production Batch" }).click();
  await completeDesign(page, "Design 1");

  await setClipboardPayload(page, importPayload);
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");

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

  await clickPresetAction(page, "Save as New Preset");
  await page.locator("#presetDraftName").fill(createdPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();
  let createdPresetId = "";
  await expect.poll(async () => {
    createdPresetId = await selectedPresetEditorRowId(page) || "";
    return createdPresetId !== "";
  }, { timeout: 10000 }).toBe(true);
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");

  await page.getByRole("button", { name: "Production Batch" }).click();
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
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");
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
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");
  await expect(page.locator("#presetInput")).not.toHaveValue("preset-c3e8a1d7f520");
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
  await page.locator("#importClipboardButton").click();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");
  await expect(page.locator("#presetInput")).toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Linked");
  await expect(page.locator("#presetListingIndicator")).toHaveAttribute("title", /assigned to the selected preset/);

  await page.locator("#presetInput").selectOption("preset-a1f4c8e2b601");
  await expect(page.locator("#presetListingIndicator")).toHaveText("Assigned elsewhere");
  await expect(page.locator("#presetListingIndicator")).toHaveAttribute("title", /assigned to Skywalk, Somekind/);
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

  await clickPresetAction(page, "Save as New Preset");
  await page.locator("#presetDraftName").fill(createdPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();

  let createdPresetId = "";
  await expect.poll(async () => {
    createdPresetId = await selectedPresetEditorRowId(page) || "";
    return createdPresetId !== "";
  }, { timeout: 10000 }).toBe(true);
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");

  await page.getByRole("button", { name: "Production Batch" }).click();
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
