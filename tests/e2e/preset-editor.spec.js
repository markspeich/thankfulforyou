import { expect, test } from "playwright/test";

test("switches between order items and presets from the left nav", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Order Items" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected design editor" })).toBeVisible();

  await page.getByRole("button", { name: "Presets" }).click();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-nav-collapsed", "true");
});
