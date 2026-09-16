import { expect, test } from "playwright/test";

async function mountIsolatedWorkspace(page) {
  await page.goto("/index.html");
  await page.evaluate(async () => {
    const { createListingsWorkspace } = await import("/src/listings-workspace.js");
    document.body.innerHTML = '<main id="test-listings"></main>';
    window.listingTest = createListingsWorkspace({ root: document.querySelector("main"), getAccessToken: () => "test-token" });
  });
}

function testDraft(id = "draft-1") {
  return { id, revision: 1, sourceTitle: "Acrylic badge topper", title: "Reviewed title", description: "Description", bullets: ["One", "Two", "Three", "Four", "Five"], basePriceCents: 1999, copyApproved: true, images: [{ id: "img1", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=", kind: "original", selected: true, main: true, approved: true }], warnings: [], facts: {} };
}

test("old account response cannot restore data after reset and a new load", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  const pending = [];
  await page.route("**/api/listings", (route) => { pending.push(route); });
  await page.evaluate(() => { void window.listingTest.open(); });
  await expect.poll(() => pending.length).toBe(1);
  await page.evaluate(() => { window.listingTest.reset(); void window.listingTest.open(); });
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill({ json: { drafts: [{ ...testDraft("new"), title: "New account" }], capabilities: {} } });
  await expect(page.locator("[data-field=title]")).toHaveValue("New account");
  await pending[0].fulfill({ json: { drafts: [{ ...testDraft("old"), title: "Old account secret" }], capabilities: {} } });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(page.locator("[data-field=title]")).toHaveValue("New account");
  await expect(page.getByText("Old account secret")).toHaveCount(0);
});

test("dirty copy blocks image generation and failed saves retain edits", async ({ page }, testInfo) => {
  await mountIsolatedWorkspace(page);
  let providerCalls = 0;
  await page.route("**/api/listings", (route) => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 409, json: { error: "This draft changed. Reload it and try again." } });
    if (route.request().method() === "POST") { providerCalls++; return route.fulfill({ status: 502, json: { error: "Provider unavailable" } }); }
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { imagePreparation: true, copyGeneration: true, amazon: false } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.locator("[data-field=title]").fill("Keep my edits");
  await expect(page.locator("[data-copy-approved]")).not.toBeChecked();
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByRole("dialog")).toContainText("Save draft before preparing an image.");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(providerCalls).toBe(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator(".listings-status")).toHaveText("This draft changed. Reload it and try again.");
  await expect(page.locator("[data-field=title]")).toHaveValue("Keep my edits");
  await page.screenshot({ path: testInfo.outputPath("listing-review.png"), fullPage: true });
});

test("Listings shows a dismissible dialog for generation quota errors without losing the draft", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  await page.route("**/api/listings", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 402, json: { error: "OpenAI API credits are exhausted or the project quota has been reached. Check billing and usage limits for the OpenAI project associated with your API key, then try again." } });
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { copyGeneration: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByRole("button", { name: "Generate copy" }).click();
  await page.getByRole("button", { name: "Replace copy", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Listing request failed" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("OpenAI API credits are exhausted or the project quota has been reached.");
  await expect(page.getByRole("button", { name: "OK" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate copy" })).toBeFocused();
  await expect(page.locator("[data-field=title]")).toHaveValue("Reviewed title");
  await expect(page.locator(".listings-status")).toContainText("OpenAI API credits are exhausted or the project quota has been reached.");
});

test("Listings workspace shows a disconnected preparation state", async ({ page }) => {
  await page.addInitScript(() => {
    window.__APP_CONFIG__ = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon-key" };
    window.__TFU_TEST_SUPABASE_CLIENT__ = { auth: { getSession: async () => ({ data: { session: { access_token: "token-1", user: { id: "user-1" } } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  });
  await page.route("**/api/batch-session", (route) => route.fulfill({ json: { operator: { id: "user-1" }, workspace: { id: "workspace-1" }, batch: { id: "batch-1", workspaceId: "workspace-1" } } }));
  await page.route("**/api/production-batch?batchId=batch-1", (route) => route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, orderItems: [] } }));
  await page.route("**/api/listings", (route) => route.fulfill({ json: { drafts: [], capabilities: { amazon: false, copyGeneration: false, imagePreparation: false } } }));
  await page.goto("/listings");
  await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
  await expect(page.getByText("Amazon submission is unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Etsy listing" })).toBeVisible();
});

test("Listings saves only edited copy and keeps typing focus", async ({ page }) => {
  let draft = { id: "draft-1", revision: 2, sourceTitle: "Quoted \"source\"", title: "Original", description: "Description", bullets: ["One", "", "", "", ""], basePriceCents: 1999, facts: {}, warnings: [], copyApproved: true, images: [{ id: "image-1", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", kind: "original", selected: true, main: true, approved: true }] };
  await page.addInitScript(() => { window.__APP_CONFIG__ = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon-key" }; window.__TFU_TEST_SUPABASE_CLIENT__ = { auth: { getSession: async () => ({ data: { session: { access_token: "token-1", user: { id: "user-1" } } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }; });
  await page.route("**/api/batch-session", (route) => route.fulfill({ json: { operator: { id: "user-1" }, workspace: { id: "workspace-1" }, batch: { id: "batch-1", workspaceId: "workspace-1" } } }));
  await page.route("**/api/production-batch?batchId=batch-1", (route) => route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, orderItems: [] } }));
  await page.route("**/api/listings**", async (route) => { if (route.request().method() === "PATCH") { const body = route.request().postDataJSON(); expect(body.changes).toEqual({ title: "First \"quoted\"", description: "First\nSecond", basePriceCents: 2150, copyApproved: false }); draft = { ...draft, ...body.changes, revision: 3 }; await route.fulfill({ json: { draft } }); return; } await route.fulfill({ json: { drafts: [draft], capabilities: { amazon: false, copyGeneration: false, imagePreparation: false } } }); });
  await page.goto("/listings/draft-1");
  const title = page.locator("[data-field=title]");
  await title.fill("");
  await title.pressSequentially("First \"quoted\"");
  await expect(title).toBeFocused();
  await page.locator("[data-field=description]").fill("First\nSecond");
  await page.locator("[data-price]").fill("21.50");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved draft")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-field=title]")).toHaveValue("First \"quoted\"");
  await expect(page.locator("[data-price]")).toHaveValue("21.50");
  await expect(page.locator("[data-copy-approved]")).not.toBeChecked();
});

test("Listings keeps the import error visible when Etsy import fails", async ({ page }) => {
  await page.addInitScript(() => { window.__APP_CONFIG__ = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon-key" }; window.__TFU_TEST_SUPABASE_CLIENT__ = { auth: { getSession: async () => ({ data: { session: { access_token: "token-1", user: { id: "user-1" } } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }; });
  await page.route("**/api/batch-session", (route) => route.fulfill({ json: { operator: { id: "user-1" }, workspace: { id: "workspace-1" }, batch: { id: "batch-1", workspaceId: "workspace-1" } } }));
  await page.route("**/api/production-batch?batchId=batch-1", (route) => route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, orderItems: [] } }));
  await page.route("**/api/listings", (route) => route.request().method() === "POST" ? route.fulfill({ status: 422, json: { error: "That Etsy listing is not available." } }) : route.fulfill({ json: { drafts: [], capabilities: { amazon: false, copyGeneration: false, imagePreparation: false } } }));
  await page.goto("/listings");
  await page.getByLabel("Etsy listing URL or ID").fill("not-a-listing");
  await page.getByRole("button", { name: "Import Etsy listing" }).click();
  await expect(page.getByRole("alert")).toHaveText("That Etsy listing is not available.");
});

test("pending generation shows a modal until completion and restores focus", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let pending;
  let calls = 0;
  await page.route("**/api/listings", (route) => {
    if (route.request().method() === "POST") { calls++; pending = route; return; }
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { copyGeneration: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByRole("button", { name: "Generate copy" }).click();
  await page.getByRole("button", { name: "Replace copy", exact: true }).click();
  const working = page.getByRole("dialog", { name: "Generating listing copy..." });
  await expect(working).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate copy" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(working).toBeVisible();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending.fulfill({ json: { draft: { ...testDraft(), title: "Generated title", revision: 2 } } });
  await expect(working).toHaveCount(0);
  await expect(page.locator("[data-field=title]")).toHaveValue("Generated title");
  await expect(page.getByRole("button", { name: "Generate copy" })).toBeFocused();
  expect(calls).toBe(1);
});

test("invalid price survives blocked actions and recovers after correction", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  await page.route("**/api/listings", route => route.fulfill({ json: { drafts: [{ ...testDraft(), copyApproved: false }], capabilities: { copyGeneration: true } } }));
  await page.evaluate(() => window.listingTest.open());
  await page.getByLabel("Base price (USD)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Generate copy", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Listing request failed" })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByLabel("Base price (USD)", { exact: true })).toHaveValue("0");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await page.getByLabel("Base price (USD)", { exact: true }).fill("19.99");
  await expect(page.locator(".listings-status")).not.toHaveClass(/is-error/);
  await expect(page.getByText("Saved draft", { exact: true })).toBeVisible();
});

test("image preparation cancellation and upload validation preserve the draft", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let calls = 0;
  await page.route("**/api/listings", route => {
    if (route.request().method() === "POST") calls++;
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { imagePreparation: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByRole("button", { name: "Remove background", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("[data-upload]").setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("dialog")).toContainText("Upload a JPEG, PNG, or WebP image no larger than 3 MiB.");
  await page.getByRole("button", { name: "Close error dialog" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Reviewed title");
  expect(calls).toBe(0);
});

test("prepared image stays unapproved and gallery choices save and reload", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let current = testDraft();
  let pending;
  await page.route("**/api/listings", async route => {
    if (route.request().method() === "POST") { pending = route; return; }
    if (route.request().method() === "PATCH") { current = { ...current, ...route.request().postDataJSON().changes, revision: current.revision + 1 }; return route.fulfill({ json: { draft: current } }); }
    return route.fulfill({ json: { drafts: [current], capabilities: { imagePreparation: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByRole("button", { name: "Remove background", exact: true }).click();
  await page.getByRole("button", { name: "Prepare image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Preparing main image..." })).toBeVisible();
  await expect.poll(() => Boolean(pending)).toBe(true);
  current = { ...current, revision: 2, images: [...current.images, { ...current.images[0], id: "prepared", kind: "prepared", main: false, approved: false }] };
  await pending.fulfill({ json: { draft: current } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const cards = page.locator(".listings-image");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).getByLabel("Approved", { exact: true })).not.toBeChecked();
  await cards.nth(1).getByLabel("Main image", { exact: true }).check();
  await expect(cards.nth(0).getByLabel("Main image", { exact: true })).not.toBeChecked();
  await cards.nth(1).getByLabel("Approved", { exact: true }).check();
  await cards.nth(0).getByLabel("Include", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved draft", { exact: true })).toBeVisible();
  await page.evaluate(async () => { window.listingTest.reset(); await window.listingTest.open(); });
  await expect(cards.nth(1).getByLabel("Main image", { exact: true })).toBeChecked();
  await expect(cards.nth(1).getByLabel("Approved", { exact: true })).toBeChecked();
  await expect(cards.nth(0).getByLabel("Include", { exact: true })).not.toBeChecked();
});

test("copy confirmation supports Cancel and Escape without making a request", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let calls = 0;
  await page.route("**/api/listings", route => {
    if (route.request().method() === "POST") calls++;
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { copyGeneration: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  for (const action of ["cancel", "escape"]) {
    await page.getByRole("button", { name: "Generate copy", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Replace listing copy?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    if (action === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate copy", exact: true })).toBeFocused();
  }
  expect(calls).toBe(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Reviewed title");
});

test("source stays read-only and Generate copy reveals Amazon below the button", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  await page.route("**/api/listings", route => route.fulfill({ json: { drafts: [{ ...testDraft(), sourceDescription: "Original Etsy description", bullets: ["", "", "", "", ""] }], capabilities: { copyGeneration: true } } }));
  await page.evaluate(() => window.listingTest.open());
  const source = page.getByRole("region", { name: "Etsy listing details" });
  const amazon = page.getByRole("region", { name: "Amazon listing details", includeHidden: true });
  await expect(source).toContainText("Original Etsy description");
  await expect(source.locator("input, textarea, button, [contenteditable=true]")).toHaveCount(0);
  await expect(amazon).toBeHidden();
  await page.getByRole("button", { name: "Generate copy", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(amazon).toBeVisible();
  const order = await page.locator(".listings-editor-body").evaluate(el => Array.from(el.children).map(child => child.className));
  expect(order[0]).toBe("listings-etsy-card");
  expect(order[1]).toContain("listings-generation-actions");
  expect(order[2]).toBe("listings-amazon-card");
});

test("main image selection keeps the gallery scroll position and focus", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  const original = testDraft();
  await page.route("**/api/listings", route => route.fulfill({ json: { drafts: [{ ...original, sourceDescription: "Source details\n".repeat(100), images: [...original.images, { ...original.images[0], id: "second", main: false }] }], capabilities: {} } }));
  await page.evaluate(() => window.listingTest.open());
  const radio = page.locator("[data-image-main=second]");
  await radio.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => ({ page: window.scrollY, editor: document.querySelector(".listings-editor").scrollTop }));
  await radio.check();
  await expect(radio).toBeChecked();
  await expect(radio).toBeFocused();
  const after = await page.evaluate(() => ({ page: window.scrollY, editor: document.querySelector(".listings-editor").scrollTop }));
  expect(after).toEqual(before);
});

test("prompt dialog loads saved text, cancels, saves and preserves edits on failure", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let saved = "Write five useful product bullets.";
  let failSave = false;
  await page.route("**/api/listings**", route => {
    if (route.request().url().includes("setting=copyPrompt")) return route.fulfill({ json: { prompt: saved } });
    if (route.request().method() === "POST") {
      if (failSave) return route.fulfill({ status: 500, json: { error: "Unable to save prompt. Try again." } });
      const body = route.request().postDataJSON();
      expect(body.action).toBe("saveCopyPrompt");
      saved = body.prompt;
      return route.fulfill({ json: { prompt: saved } });
    }
    return route.fulfill({ json: { drafts: [testDraft()], capabilities: { copyGeneration: true } } });
  });
  await page.evaluate(() => window.listingTest.open());
  const edit = page.getByRole("button", { name: "Edit prompt", exact: true });
  await edit.click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(saved);
  await page.getByLabel("Prompt", { exact: true }).fill("Discard me");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(saved).toBe("Write five useful product bullets.");
  await edit.click();
  await page.getByLabel("Prompt", { exact: true }).fill("Use concise friendly bullets.");
  failSave = true;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Listing request failed" })).toContainText("Unable to save prompt");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Use concise friendly bullets.");
  failSave = false;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await edit.click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Use concise friendly bullets.");
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
});

test("upload retains unsaved edits and saves against the new revision", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let current = testDraft();
  let pending;
  let savedPayload;
  await page.route("**/api/listings", async route => {
    if (route.request().method() === "POST") { pending = route; return; }
    if (route.request().method() === "PATCH") {
      savedPayload = route.request().postDataJSON();
      current = { ...current, ...savedPayload.changes, revision: current.revision + 1 };
      return route.fulfill({ json: { draft: current } });
    }
    return route.fulfill({ json: { drafts: [current], capabilities: {} } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
  await page.locator("[data-image-select]").first().uncheck();
  await page.locator("[data-upload]").setInputFiles({ name: "new.png", mimeType: "image/png", buffer: Buffer.from("test photo") });
  await expect(page.getByRole("dialog")).toContainText("Uploading image");
  await expect.poll(() => Boolean(pending)).toBe(true);
  current = { ...current, revision: current.revision + 1, images: [...current.images, { id: "new-photo", kind: "uploaded", selected: true, main: false, approved: false }] };
  const uploadRevision = current.revision;
  await pending.fulfill({ json: { draft: current } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
  await expect(page.locator("[data-image-select]").first()).not.toBeChecked();
  await expect(page.locator('[data-image-select="new-photo"]')).toBeChecked();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  expect(savedPayload.revision).toBe(uploadRevision);
  expect(savedPayload.changes.title).toBe("Unsaved title");
  expect(current.images).toHaveLength(2);
});

test("copy approval can be checked, saved, and unchecked", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  let current = { ...testDraft(), copyApproved: false };
  await page.route("**/api/listings", route => {
    if (route.request().method() === "PATCH") { current = { ...current, ...route.request().postDataJSON().changes, revision: current.revision + 1 }; return route.fulfill({ json: { draft: current } }); }
    return route.fulfill({ json: { drafts: [current], capabilities: {} } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.locator("[data-copy-approved]").check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("[data-copy-approved]")).toBeChecked();
  expect(current.copyApproved).toBe(true);
  await page.locator("[data-copy-approved]").uncheck();
  await expect(page.locator("[data-copy-approved]")).not.toBeChecked();
});

test("dropzone uploads an image while preserving edits and rejects invalid files", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  const current = testDraft();
  let uploads = 0;
  await page.route("**/api/listings", route => {
    if (route.request().method() === "POST") { uploads++; return route.fulfill({ json: { draft: { ...current, revision: current.revision + 1, images: [...current.images, { id: "drop", kind: "uploaded", selected: true }] } } }); }
    return route.fulfill({ json: { drafts: [current], capabilities: {} } });
  });
  await page.evaluate(() => window.listingTest.open());
  await page.getByLabel("Title", { exact: true }).fill("Keep dropped edits");
  await expect(page.getByText("Upload image", { exact: true })).toBeVisible();
  const drop = async (type, name) => {
    const transfer = await page.evaluateHandle(({type,name}) => { const data = new DataTransfer(); data.items.add(new File(["image"], name, {type})); return data; }, {type,name});
    await page.locator("[data-upload-zone]").dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
  };
  await drop("image/png", "photo.png");
  await expect(page.locator('[data-image-select="drop"]')).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Keep dropped edits");
  await drop("text/plain", "bad.txt");
  await expect(page.getByRole("dialog")).toContainText("Upload a JPEG, PNG, or WebP");
  expect(uploads).toBe(1);
});

test("selected image count updates immediately across the nine image limit without saving", async ({ page }) => {
  await mountIsolatedWorkspace(page);
  const draft = { ...testDraft(), images: Array.from({ length: 10 }, (_, i) => ({ id: `photo-${i}`, selected: true, kind: "original" })) };
  await page.route("**/api/listings", route => route.fulfill({ json: { drafts: [draft], capabilities: {} } }));
  await page.evaluate(() => window.listingTest.open());
  const count = page.locator(".listings-image-count");
  await expect(count).toContainText("10 of 9 images selected");
  await expect(count).toHaveCSS("color", "rgb(180, 35, 24)");
  await page.locator('[data-image-select="photo-0"]').uncheck();
  await expect(count).toHaveText("9 of 9 images selected");
  await expect(count).not.toHaveClass(/is-over-limit/);
  await page.locator('[data-image-select="photo-0"]').check();
  await expect(count).toContainText("10 of 9 images selected");
  await expect(count).toHaveClass(/is-over-limit/);
});
