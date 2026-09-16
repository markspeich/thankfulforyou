import { expect, test } from "playwright/test";
const attempt = (status, action = "validate", revision = 1) => ({ id: `${action}-${status}`, action, status, revision, createdAt: "2026-09-17T00:00:00Z", issues: [] });
const productionDetails = { packageLengthInches: 3, packageWidthInches: 2, packageHeightInches: 1, packageWeightOunces: 1.1, manufacturer: "Thankful For You", partNumber: "TFY-4357670739", specialFeature: "Personalized", closureType: "Clip" };
const draft = (attempts = [], revision = 1) => ({ id: "prod-test", revision, title: "Badge", description: "Description", bullets: ["One", "Two", "Three", "Four", "Five"], copyApproved: true, images: [{ id: "i1", url: "https://example.com/image.jpg", selected: true, main: true, approved: true }], amazonProductionDetails: productionDetails, amazonProduction: { sku: "test-sku", attempts, localIssues: [] } });
async function mount(page, current, respond) {
 await page.route("**/api/listings", route => ["POST", "PATCH"].includes(route.request().method()) ? respond(route) : route.fulfill({ json: { drafts: [current], capabilities: { amazonProduction: true } } }));
 await page.goto("/index.html");
 await page.evaluate(async () => { const { createListingsWorkspace } = await import("/src/listings-workspace.js"); document.body.innerHTML = '<main></main>'; window.workspace = createListingsWorkspace({ root: document.querySelector('main'), getAccessToken: () => 'test-token' }); await window.workspace.open(); });
}
test("production validation working and success; creation requires confirmation and reports acceptance", async ({ page }) => {
 let release; let count = 0;
 await mount(page, draft(), async route => {
  count++;
  const body = route.request().postDataJSON();
  if (body.action === 'validateAmazonProduction') { await new Promise(resolve => { release = resolve; }); return route.fulfill({ json: { draft: draft([attempt('checked')]) } }); }
  expect(body).toMatchObject({ action: 'submitAmazonProduction', confirmProduction: true, revision: 1 });
  return route.fulfill({ json: { draft: draft([attempt('checked'), attempt('accepted','submit')]) } });
 });
 await expect(page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true })).toBeDisabled();
 await page.getByRole('button', { name: 'Validate with Amazon', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('Validating with Amazon');
 release();
 await expect(page.getByRole('dialog')).toContainText('validation passed');
 await page.getByRole('button', { name: 'OK', exact: true }).click();
 await page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true }).click();
 await page.getByRole('button', { name: 'Cancel', exact: true }).click();
 expect(count).toBe(1);
 await page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true }).click();
 await page.getByRole('button', { name: 'Create inactive listing', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('does not yet confirm an inactive listing');
 await page.getByRole('button', { name: 'OK', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true })).toBeDisabled();
 await expect(page.getByRole('button', { name: 'Check Amazon status', exact: true })).toBeEnabled();
});
test('production remote validation errors appear in dialog and field', async ({ page }) => {
 const invalid = { ...attempt('invalid'), issues: [{ severity: 'ERROR', message: 'Description too long. Shorten it.', attributeNames: ['product_description'] }] };
 await mount(page, draft(), route => route.fulfill({ json: { draft: draft([invalid]) } }));
 await page.getByRole('button', { name: 'Validate with Amazon', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('Description too long');
 await page.getByRole('button', { name: 'OK', exact: true }).click();
 await expect(page.locator('[data-field=description]')).toHaveAttribute('aria-invalid','true');
 await page.locator('[data-field=description]').fill('Shortened description');
 await expect(page.locator('[data-field=description]')).not.toHaveAttribute('aria-invalid','true');
});
test('stale revision cannot submit and HTTP failure recovers', async ({ page }) => {
 await mount(page, draft([attempt('checked')],2), route => route.fulfill({ status: 503, json: { error: 'Amazon unavailable. Retry later.' } }));
 await expect(page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true })).toBeDisabled();
 await page.getByRole('button', { name: 'Validate with Amazon', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('Amazon unavailable');
 await page.getByRole('button', { name: 'OK', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Validate with Amazon', exact: true })).toBeEnabled();
});
test('production facts save with the draft and stale validation does not unlock creation', async ({ page }) => {
 let saved = null;
 await mount(page, draft([attempt('checked')]), route => {
  const body = route.request().postDataJSON();
  if (route.request().method() === 'PATCH') {
   saved = body;
   return route.fulfill({ json: { draft: { ...draft([attempt('checked')], 2), amazonProductionDetails: body.changes.amazonProductionDetails } } });
  }
  return route.fulfill({ json: { draft: draft() } });
 });
 await expect(page.getByRole('heading', { name: 'Amazon production details' })).toBeVisible();
 await page.locator('[data-production-detail="manufacturer"]').fill('Thankful For You LLC');
 await expect(page.getByRole('button', { name: 'Validate with Amazon', exact: true })).toBeDisabled();
 await page.getByRole('button', { name: 'Save draft', exact: true }).click();
 await expect.poll(() => saved).not.toBeNull();
 expect(saved.changes.amazonProductionDetails).toMatchObject({ manufacturer: 'Thankful For You LLC', packageWeightOunces: 1.1 });
 await expect(page.locator('[data-production-detail="manufacturer"]')).toHaveValue('Thankful For You LLC');
 await expect(page.getByRole('button', { name: 'Create inactive Amazon listing', exact: true })).toBeDisabled();
});
test('missing production facts block validation locally and recover field errors', async ({ page }) => {
 let apiCalls = 0;
 await mount(page, { ...draft(), amazonProductionDetails: { ...productionDetails, manufacturer: '' } }, route => {
  apiCalls++;
  return route.fulfill({ json: { draft: draft() } });
 });
 const manufacturer = page.locator('[data-production-detail="manufacturer"]');
 await page.getByRole('button', { name: 'Validate with Amazon', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('highlighted Amazon production details');
 expect(apiCalls).toBe(0);
 await page.getByRole('button', { name: 'OK', exact: true }).click();
 await expect(manufacturer).toHaveAttribute('aria-invalid', 'true');
 await expect(manufacturer).toBeFocused();
 await manufacturer.fill('Thankful For You');
 await expect(manufacturer).not.toHaveAttribute('aria-invalid', 'true');
});
