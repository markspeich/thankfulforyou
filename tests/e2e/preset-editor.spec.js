import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..");
const PRESETS_DIR = path.join(REPO_ROOT, "public", "presets");

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function withPresetLibraryBackup(run) {
  const backupDir = await mkdtemp(path.join(tmpdir(), "thankfulforyou-preset-editor-"));

  await cp(PRESETS_DIR, backupDir, { recursive: true, force: true });

  try {
    await run();
  } finally {
    await rm(PRESETS_DIR, { recursive: true, force: true });
    await cp(backupDir, PRESETS_DIR, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
  }
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
  await withPresetLibraryBackup(async () => {
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

    await page.getByRole("button", { name: "Add Design" }).click();
    await page.locator("#textInput").fill("Taylor\nRN");
    await page.locator("#presetInput").selectOption(createdPresetId);
    await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

    await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).click();
    await expect(page.locator("#presetInput")).toHaveValue(createdPresetId);

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
});
