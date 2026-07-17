import { expect, test } from "playwright/test";
function session(page) { return page.addInitScript(() => { window.__APP_CONFIG__ = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon" }; window.__TFU_TEST_SUPABASE_CLIENT__ = { auth: { getSession: async () => ({ data: { session: { access_token: "token", user: { id: "u", email: "operator@example.com" } } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }; }); }
const order = customizationNeeded => ({ id: "order:1001", orderNumber: "1001", buyerName: "Ada", items: [{ id: "item-1", listingTitle: "Badge reel", source: { customizationNeeded }, design: { text: "Ada RN", lines: [{ lineIndex: 0, text: "Ada RN", fontId: "candlepin" }] } }] });
async function routes(page, connection = "connected", customizationNeeded = false) {
  let gets = 0;
  await page.route("**/api/batch-session", r => r.fulfill({ json: { operator: { id: "u", email: "operator@example.com" }, workspace: { id: "w", name: "TFY" }, batch: { id: "b", workspaceId: "w" } } }));
  await page.route("**/api/production-batch?batchId=b", r => r.fulfill({ json: { batch: { id: "b", workspaceId: "w" }, activeOrderItemId: null, orderItems: [] } }));
  await page.route("**/api/orders**", r => { gets++; return r.fulfill({ json: { orders: [order(customizationNeeded)] } }); });
  await page.route("**/api/etsy-connection", r => r.fulfill({ json: r.request().method() === "POST" ? { authorizeUrl: "https://www.etsy.com/oauth/connect?state=test" } : { status: connection, shopName: "Badge Shop" } }));
  return () => gets;
}
async function stream(page) { await page.addInitScript(() => { const original = fetch.bind(window); window.calls = 0; window.controllers = []; window.pushEvent = e => window.controllers.at(-1)?.enqueue(new TextEncoder().encode(`${JSON.stringify(e)}\n`)); window.closeStream = () => window.controllers.shift()?.close(); window.fetch = (input, init) => { if (new URL(typeof input === "string" ? input : input.url, location.href).pathname !== "/api/etsy-import") return original(input, init); window.calls++; return Promise.resolve(new Response(new ReadableStream({ start(c) { window.controllers.push(c); } }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } })); }; }); }
async function open(page, url = "/orders") { await page.goto(url); await expect(page.getByRole("region", { name: "Orders workspace" })).toBeVisible(); }
async function navigationIntent(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Page.enable");
  return new Promise(resolve => session.once("Page.frameRequestedNavigation", event => {
    resolve(event.url);
  }));
}

test("disconnected Orders connects Etsy once", async ({ page }) => {
  await session(page); await routes(page, "disconnected"); let begins = 0;
  page.on("request", request => { if (request.url().includes("/api/etsy-connection") && request.method() === "POST") begins++; });
  await page.route("https://www.etsy.com/oauth/connect?state=test", r => r.abort());
  await open(page); const button = page.locator(".etsy-import-button"); await expect(button).toHaveText("Connect Etsy Shop");
  const navigation = navigationIntent(page); await button.click();
  await expect(await navigation).toBe("https://www.etsy.com/oauth/connect?state=test"); await expect.poll(() => begins).toBe(1);
});

test("connected import reports stages and completion while preserving selection", async ({ page }) => {
  await session(page); const gets = await routes(page); await stream(page); await open(page); await page.getByRole("button", { name: /Order 1001/ }).click();
  const button = page.locator(".etsy-import-button"); await expect(button).toHaveText("Import from Etsy"); await button.click(); await expect(button).toHaveText("Importing\u2026"); await expect(button).toBeDisabled();
  await button.evaluate(element => element.click()); await expect.poll(() => page.evaluate(() => calls)).toBe(1);
  await page.evaluate(() => pushEvent({ type: "progress", stage: "fetching_receipts", processed: 0, total: null })); await expect(page.locator("#etsyImportFeedback")).toHaveAttribute("aria-live", "polite"); await expect(page.locator(".etsy-import-status")).toHaveText("Fetching Etsy receipts\u2026");
  const progress = page.getByRole("progressbar", { name: "Etsy import progress" }); await expect(progress).toBeVisible(); await expect(progress).not.toHaveAttribute("aria-valuenow", /.+/);
  await page.evaluate(() => pushEvent({ type: "progress", stage: "importing_items", processed: 6, total: 14 })); await expect(page.locator(".etsy-import-status")).toHaveText("Importing 6 of 14 order items\u2026");
  await expect(progress).toHaveAttribute("value", "6"); await expect(progress).toHaveAttribute("max", "14"); await expect(progress).toHaveAttribute("aria-valuenow", "6"); await expect(progress).toHaveAttribute("aria-valuemax", "14");
  await page.evaluate(() => { pushEvent({ type: "complete", imported: 3, existing: 2, customizationNeeded: 1, failed: 4 }); closeStream(); });
  await expect(page.locator(".etsy-import-status")).toHaveText("3 orders imported, 2 existing orders, 1 item needing customization, 4 failures."); await expect(progress).toHaveAttribute("hidden", ""); await expect.poll(gets).toBeGreaterThan(1); await expect(page.locator(".database-order-row.is-selected")).toContainText("Order 1001");
});

test("stream errors retry and reauthorization reconnects", async ({ page }) => {
  await session(page); await routes(page); await stream(page); await open(page); await page.getByRole("button", { name: "Import from Etsy" }).click();
  await page.evaluate(() => pushEvent({ type: "error", code: "temporary", message: "Try Etsy again." })); await expect(page.getByRole("button", { name: "Retry" })).toBeVisible(); await expect(page.locator(".etsy-import-progress")).toHaveAttribute("hidden", "");
  await page.getByRole("button", { name: "Retry" }).click(); await expect.poll(() => page.evaluate(() => calls)).toBe(2); await page.evaluate(() => pushEvent({ type: "error", code: "reauthorize", message: "Reconnect Etsy." })); await expect(page.getByRole("button", { name: "Reconnect Etsy Shop" })).toBeVisible();
});

test("callback error stays reconnect-required and reconnect navigates once", async ({ page }) => {
  await session(page); await routes(page, "connected"); let begins = 0;
  page.on("request", request => { if (request.url().includes("/api/etsy-connection") && request.method() === "POST") begins++; });
  await page.route("https://www.etsy.com/oauth/connect?state=test", r => r.abort());
  await open(page, "/orders?etsy=connection-error&keep=yes#items");
  await expect(page).toHaveURL(/\/orders\?keep=yes#items$/); await expect(page.locator(".etsy-import-status")).toHaveText("Etsy connection failed. Reconnect to try again.");
  const button = page.getByRole("button", { name: "Reconnect Etsy Shop" }); const navigation = navigationIntent(page);
  await button.click();
  await expect(await navigation).toBe("https://www.etsy.com/oauth/connect?state=test"); await expect.poll(() => begins).toBe(1);
});

test("customization keeps actionable item control and OAuth consumes only Etsy param", async ({ page }) => {
  await session(page); await routes(page, "connected", true); await open(page, "/orders?etsy=connected&keep=yes#items"); await expect(page.locator(".etsy-import-status")).toHaveText("Connected to Etsy."); await expect(page).toHaveURL(/\/orders\?keep=yes#items$/);
  const card = page.locator(".database-order-item-card"); const warning = card.getByText("Customization needed", { exact: false }); await expect(warning).toBeVisible();
  await card.getByRole("button", { name: "Item actions" }).click(); const copy = card.getByRole("button", { name: "Copy Design" }); await expect(copy).toBeEnabled(); await copy.click();
  await expect(page.locator("#importStatus")).toContainText("Complete and save this design before copying."); await expect(warning).toBeVisible();
});
