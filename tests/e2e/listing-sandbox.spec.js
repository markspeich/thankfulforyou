import { expect, test } from "playwright/test";

const image = { id: "image-1", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=", kind: "original", selected: true, main: true, approved: true };
const sandbox = (attempts = [], notice = "Canned sandbox responses only. No production listing is created.") => ({ sku: "TFY-draft1", attempts, notice });
const draft = (revision = 1, attempts = []) => ({ id: "draft-1", revision, sourceTitle: "Badge reel", title: "Approved title", description: "Approved description", bullets: ["One", "Two", "Three", "Four", "Five"], copyApproved: true, images: [image], facts: {}, warnings: [], amazonSandbox: sandbox(attempts) });

async function mount(page, initial = draft()) {
  await page.goto("/index.html");
  await page.evaluate(async () => {
    const { createListingsWorkspace } = await import("/src/listings-workspace.js");
    document.body.innerHTML = '<main id="test-listings"></main>';
    window.listingTest = createListingsWorkspace({ root: document.querySelector("main"), getAccessToken: () => "test-token" });
  });
  return initial;
}

test("sandbox preview enables same-revision test submission", async ({ page }) => {
  let current = await mount(page);
  const actions = [];
  await page.route("**/api/listings", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { drafts: [current], capabilities: { amazon: false, amazonSandbox: true } } });
    const body = route.request().postDataJSON();
    actions.push(body);
    expect(body.revision).toBe(1);
    if (body.action === "validateAmazonSandbox") current = draft(1, [{ id: "a1", revision: 1, action: "validate", status: "checked", issues: [], createdAt: "2026-09-15T10:00:00Z" }]);
    else if (body.action === "submitAmazonSandbox") current = draft(1, [{ id: "a1", revision: 1, action: "validate", status: "checked", issues: [], createdAt: "2026-09-15T10:00:00Z" }, { id: "a2", revision: 1, action: "submit", status: "accepted", issues: [], createdAt: "2026-09-15T10:01:00Z" }]);
    else throw new Error(`Unexpected action ${body.action}`);
    return route.fulfill({ json: { draft: current } });
  });
  await page.evaluate(() => window.listingTest.open());
  await expect(page.getByRole("heading", { name: "Amazon sandbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test sandbox submission" })).toBeDisabled();
  await page.getByRole("button", { name: "Run sandbox preview" }).click();
  await expect(page.getByRole("button", { name: "Test sandbox submission" })).toBeEnabled();
  await page.getByRole("button", { name: "Test sandbox submission" }).click();
  await expect.poll(() => actions.map((entry) => entry.action)).toEqual(["validateAmazonSandbox", "submitAmazonSandbox"]);
  await expect(page.getByRole("button", { name: "Test sandbox submission" })).toBeDisabled();
  await expect(page.getByText("No production listing is created.")).toBeVisible();
});

test("sandbox shows escaped invalid issues and blocks dirty actions", async ({ page }) => {
  const current = await mount(page, draft(1, [{ id: "a1", revision: 1, action: "validate", status: "invalid", issues: [{ code: "UNSAFE", severity: "ERROR", message: "<unsafe issue>" }], createdAt: "2026-09-15T10:00:00Z" }]));
  let calls = 0;
  await page.route("**/api/listings", (route) => {
    if (route.request().method() === "POST") calls += 1;
    return route.fulfill({ json: { drafts: [current], capabilities: { amazon: false, amazonSandbox: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await expect(page.getByText("UNSAFE: ERROR: <unsafe issue>", { exact: true })).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);
  await page.locator("[data-field=title]").fill("Unsaved");
  await page.getByRole("button", { name: "Run sandbox preview" }).click();
  await expect(page.getByRole("dialog").getByText("Save draft before running the sandbox action.")).toBeVisible();
  expect(calls).toBe(0);
});

test("revision change invalidates preview readiness and unknown requires status check", async ({ page }) => {
  let current = await mount(page, draft(2, [
    { id: "older", revision: 1, action: "validate", status: "checked", issues: [], createdAt: "2026-09-14T10:00:00Z" },
    { id: "unknown", revision: 1, action: "submit", status: "unknown", issues: [], createdAt: "2026-09-15T10:00:00Z" },
    { id: "current", revision: 2, action: "validate", status: "checked", issues: [], createdAt: "2026-09-15T11:00:00Z" },
  ]));
  await page.route("**/api/listings", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { drafts: [current], capabilities: { amazon: false, amazonSandbox: true } } });
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ action: "reconcileAmazonSandbox", revision: 2 });
    current = draft(2, [...current.amazonSandbox.attempts, { id: "reconciled", revision: 2, action: "reconcile", status: "unconfirmed", issues: [{ code: "STATIC_SANDBOX", severity: "WARNING", message: "Sandbox cannot confirm state" }], createdAt: "2026-09-15T12:00:00Z" }]);
    return route.fulfill({ json: { draft: current } });
  });
  await page.evaluate(() => window.listingTest.open());
  await expect(page.getByText(/Revision 1.*not current/i)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Test sandbox submission" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check sandbox status" })).toBeEnabled();
  await expect(page.getByText(/unknown.*Check sandbox status/i)).toBeVisible();
  await page.getByRole("button", { name: "Check sandbox status" }).click();
  await expect(page.getByText("STATIC_SANDBOX: WARNING: Sandbox cannot confirm state")).toBeVisible();
});

test("latest same-revision invalid preview removes submission readiness", async ({ page }) => {
  const current = await mount(page, draft(2, [
    { id: "checked", revision: 2, action: "validate", status: "checked", issues: [], createdAt: "2026-09-15T10:00:00Z" },
    { id: "invalid", revision: 2, action: "validate", status: "invalid", issues: [{ code: "REQUIRED", severity: "ERROR", message: "Missing required field" }], createdAt: "2026-09-15T11:00:00Z" },
  ]));
  await page.route("**/api/listings", (route) => route.fulfill({ json: { drafts: [current], capabilities: { amazon: false, amazonSandbox: true } } }));
  await page.evaluate(() => window.listingTest.open());
  await expect(page.getByText("Missing required field")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test sandbox submission" })).toBeDisabled();
});

test("preview marks invalid inputs and excluded image controls are disabled", async ({ page }) => {
  const current = { ...draft(), description: "", bullets: ["", "Two", "Three", "Four", "Five"], images: [{ ...image, approved: false }, { ...image, id: "excluded", selected: false, main: false }] };
  await mount(page);
  await page.route("**/api/listings", route => route.request().method() === "POST" ? route.fulfill({ status: 422, json: { error: "Enter a description. Complete all five bullet points. Approve every selected image." } }) : route.fulfill({ json: { drafts: [current], capabilities: { amazonSandbox: true } } }));
  await page.evaluate(() => window.listingTest.open());
  await expect(page.locator('[data-image-main="excluded"]')).toBeDisabled();
  await expect(page.locator('[data-image-approved="excluded"]')).toBeDisabled();
  await page.getByRole("button", { name: "Run sandbox preview" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator('[data-field="description"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[data-bullet="0"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[data-bullet="1"]')).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[data-image-approved="image-1"]')).toHaveAttribute("aria-invalid", "true");
  await page.locator('[data-field="description"]').fill("Fixed description");
  await expect(page.locator('[data-field="description"]')).not.toHaveAttribute("aria-invalid", "true");
  await page.locator('[data-image-select="excluded"]').check();
  await expect(page.locator('[data-image-main="excluded"]')).toBeEnabled();
  await expect(page.locator('[data-image-approved="excluded"]')).toBeEnabled();
});
