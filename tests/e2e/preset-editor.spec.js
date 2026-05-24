import { expect, test } from "playwright/test";

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
  await page.goto("/");

  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");

  await page.getByRole("button", { name: "Save as New Preset" }).click();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await page.locator("#presetDraftName").fill("Morgan RN");
  await page.getByRole("button", { name: "Save Preset" }).click();

  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");

  await page.locator("#presetEditorSelect").selectOption("all-candlepin");
  await page.locator("#presetDraftName").fill("All Candlepin Updated");
  await page.getByRole("button", { name: "Save Preset" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
});
