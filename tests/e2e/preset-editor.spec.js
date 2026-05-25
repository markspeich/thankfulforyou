import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..");
const PRESETS_DIR = path.join(REPO_ROOT, "public", "presets");
const PRESET_MANIFEST_PATH = path.join(PRESETS_DIR, "manifest.json");

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
    manifest: {
      ...manifest,
      presets: (manifest.presets || []).map((entry) => ({ ...entry })),
    },
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

  await page.route("**/api/presets", async (route) => {
    const method = route.request().method();
    const payload = route.request().postDataJSON() || {};
    const preset = payload?.preset;
    const previousId = typeof payload?.previousId === "string" && payload.previousId.trim()
      ? payload.previousId.trim()
      : null;

    if (!preset || typeof preset !== "object") {
      await route.fulfill({
        status: 400,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Preset payload is required." }),
      });
      return;
    }

    const nextPreset = {
      ...preset,
      name: typeof preset.name === "string" ? preset.name.trim() : "",
    };
    const existingIndex = store.manifest.presets.findIndex((entry) => entry.id === (method === "PUT" ? (previousId || nextPreset.id) : nextPreset.id));
    const conflictingIndex = store.manifest.presets.findIndex((entry) => entry.id === nextPreset.id);

    if (method === "POST" && conflictingIndex >= 0) {
      await route.fulfill({
        status: 409,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Preset id already exists." }),
      });
      return;
    }

    if (method === "PUT" && existingIndex < 0) {
      await route.fulfill({
        status: 404,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Preset to update was not found." }),
      });
      return;
    }

    if (method === "PUT" && conflictingIndex >= 0 && conflictingIndex !== existingIndex) {
      await route.fulfill({
        status: 409,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ error: "Preset id already exists." }),
      });
      return;
    }

    const previousEntry = existingIndex >= 0 ? store.manifest.presets[existingIndex] : null;
    if (existingIndex >= 0) {
      store.manifest.presets[existingIndex] = {
        id: nextPreset.id,
        path: buildPresetPath(nextPreset.id),
      };
    } else {
      store.manifest.presets.push({
        id: nextPreset.id,
        path: buildPresetPath(nextPreset.id),
      });
    }

    if (method === "PUT" && previousEntry?.id && previousEntry.id !== nextPreset.id) {
      store.definitions.delete(previousEntry.id);
      if (store.manifest.defaultPresetId === previousEntry.id) {
        store.manifest.defaultPresetId = nextPreset.id;
      }
    }

    store.definitions.set(nextPreset.id, JSON.parse(JSON.stringify(nextPreset)));

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        preset: nextPreset,
        manifest: store.manifest,
      }),
    });
  });
}

async function openQueueTools(page) {
  const menu = page.locator(".queue-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await page.locator(".queue-tools-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
}

async function clickQueueAction(page, name) {
  await openQueueTools(page);
  await page.getByRole("button", { name }).click();
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

test.beforeEach(async ({ page, request }) => {
  await request.delete("/api/queue-snapshot?workspaceKey=primary").catch(() => null);
  await page.addInitScript(() => {
    window.localStorage.removeItem("thankfulforyou.designQueue");
  });
});

test("switches between order items and presets from the left nav", async ({ page }) => {
  await page.goto("/");

  const appShell = page.locator(".app-shell");
  const ordersWorkspace = page.locator("#ordersWorkspace");
  const presetsWorkspace = page.locator("#presetsWorkspace");
  const editorPanel = page.locator(".editor-panel");

  await expect(page.getByRole("button", { name: "Order Items" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets" })).toBeVisible();
  await expect(ordersWorkspace).toBeVisible();
  await expect(presetsWorkspace).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Presets" }).click();
  await expect(ordersWorkspace).toBeHidden();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await expect(presetsWorkspace).toBeVisible();

  await page.getByRole("button", { name: "Order Items" }).click();
  await expect(page.getByRole("region", { name: "Order items workspace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeHidden();
  await expect(editorPanel).toHaveClass(/is-hidden/);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(appShell).toHaveAttribute("data-nav-collapsed", "true");
});

test("can create a new preset from order settings and update an existing preset", async ({ page }) => {
  const nonce = Date.now();
  const createdPresetName = `Morgan RN ${nonce}`;
  const createdPresetId = slugify(createdPresetName);
  const renamedPresetName = `Morgan RN Updated ${nonce}`;
  const renamedPresetId = slugify(renamedPresetName);
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

  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");
  await setRangeValue(page, "#backingInput", 4.4);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 23);

  await page.getByRole("button", { name: "Save as New Preset" }).click();
  const presetWorkspace = page.getByRole("region", { name: "Preset editor workspace" });
  await expect(presetWorkspace).toBeVisible();
  await expect(presetWorkspace).not.toContainText("tools will land here next");
  await page.locator("#presetDraftName").fill(createdPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();

  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator("#presetEditorSelect")).toHaveValue(createdPresetId);
  await expect(page.locator("#presetEditorSelect")).toContainText(createdPresetName);
  await expect(page.locator("#presetDraftId")).toHaveValue(createdPresetId);

  await page.getByRole("button", { name: "Order Items" }).click();
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");

  await completeDesign(page, "Design 1");
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Taylor\nRN");
  await page.locator("#presetInput").selectOption(createdPresetId);
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);
  await expect(page.locator("#downloadButton")).toBeEnabled();

  await page.getByRole("button", { name: "Presets" }).click();
  await page.locator("#presetEditorSelect").selectOption(createdPresetId);
  await expect(page.locator("#presetDraftName")).toHaveValue(createdPresetName);
  await page.locator("#presetDraftName").fill(renamedPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();

  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator("#presetEditorSelect")).toHaveValue(renamedPresetId);
  await expect(page.locator("#presetEditorSelect")).toContainText(renamedPresetName);
  await expect(page.locator("#presetDraftId")).toHaveValue(renamedPresetId);

  await page.getByRole("button", { name: "Order Items" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(renamedPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" })).toContainText("Complete");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 2" }).click();
  await expect(page.locator("#presetInput")).toHaveValue(renamedPresetId);

  await setClipboardPayload(page, importPayload);
  await clickQueueAction(page, "Import Clipboard");
  await expect(page.locator("#importStatus")).toContainText("Imported 1 Etsy design from the clipboard.");
  await expect(page.locator("#presetInput")).not.toHaveValue(renamedPresetId);

  await page.locator("#presetInput").selectOption(renamedPresetId);
  await setRangeValue(page, "#backingInput", 1.0);
  await setRangeValue(page, '[data-line-index="1"] [data-setting="fontSizeMm"]', 40);
  await expect(page.locator("#backingInput")).toHaveValue("1");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("40");

  await page.getByRole("button", { name: "Assign Preset to Listing" }).click();
  await expect(page.locator("#importStatus")).toContainText("Assigned");
  await expect(page.locator("#presetInput")).toHaveValue(renamedPresetId);
  await expect(page.locator('[data-line-index="0"] [data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('[data-line-index="1"] [data-setting="fontSizeMm"]')).toHaveValue("23");
  await expect(page.locator("#backingInput")).toHaveValue("4.4");
});
