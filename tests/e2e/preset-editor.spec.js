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
  const createdPresetName = `Morgan RN ${Date.now()}`;
  const createdPresetId = createdPresetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const renamedPresetName = `All Candlepin Updated ${Date.now()}`;
  const renamedPresetId = renamedPresetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  await page.goto("/");

  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");

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

  const presetToUpdate = await page.locator("#presetEditorSelect").evaluate((select, createdId) => {
    const options = [...select.options]
      .map((option) => ({ value: option.value, label: option.textContent || "" }))
      .filter((option) => option.value && option.value !== createdId);
    return options[0] || null;
  }, createdPresetId);

  expect(presetToUpdate).not.toBeNull();

  await page.locator("#presetEditorSelect").selectOption(presetToUpdate.value);
  await expect(page.locator("#presetDraftName")).toHaveValue(presetToUpdate.label);
  await page.locator("#presetDraftName").fill(renamedPresetName);
  await page.getByRole("button", { name: "Save Preset" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
  await expect(page.locator("#presetEditorSelect")).toHaveValue(renamedPresetId);
  await expect(page.locator("#presetEditorSelect")).toContainText(renamedPresetName);
  await expect(page.locator("#presetDraftId")).toHaveValue(renamedPresetId);
});
