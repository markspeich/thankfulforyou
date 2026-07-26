# ShipStation Amazon Customization Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated `Import Amazon` workflow that imports every pending Amazon ShipStation shipment into Orders, appends normalized Amazon Custom data to ShipStation notes, and tags a shipment only after both destinations are complete.

**Architecture:** A server-side streaming endpoint coordinates a focused ShipStation client, a bounded Amazon ZIP reader, a pure customization normalizer, and a workspace-scoped import service. A Supabase migration supplies a durable import lease and a transactional per-shipment Orders RPC so retries cannot strand partial order/design data; the browser only renders sanitized progress and completion counts.

**Tech Stack:** Node.js 20+ ES modules, ShipStation API V2, Supabase/Postgres, `yauzl@3.4.0`, Vitest 4, Playwright 1.60, vanilla browser JavaScript/CSS.

## Global Constraints

- Use ShipStation API V2 at `https://api.shipstation.com/v2`; do not introduce V1 endpoints.
- Keep `SHIPSTATION_API_KEY`, `SHIPSTATION_AMAZON_STORE_ID`, signed URLs, ZIP bodies, and personalization values server-side.
- Configure the current store as `SHIPSTATION_AMAZON_STORE_ID=se-4461867`.
- Process only `pending` shipments and skip `Amazon Customization Imported`.
- Trust customization downloads only from HTTPS `zme-caps.amazon.com`, including every redirect target.
- Ignore every customization field whose label starts with `^`.
- Use ShipStation item `name` as the product title.
- Preserve existing `notes_to_buyer`; cap the combined result at 1,000 characters and never truncate.
- Use Amazon order-item ID as the durable app identity and note-block retry marker.
- Import every line item to Orders only; never add it to Production Batch.
- Add the processed tag only after notes and transactional app persistence are both satisfied.
- Continue after isolated shipment failures and leave failures untagged.
- ShipStation platform V2 has no sandbox: automated tests use mocks and synthetic archives.
- Any database behavior added here must ship with a checked-in migration created by `npx supabase migration new` and verified locally.
- Before production migration application, report the migration path, live project ref `oezjskcygvfyezvoulzw`, and that the migration is additive; ask before applying it.

---

## File Structure

**New production modules**

- `api/_lib/shipstation-client.js` - config validation, V2 pagination, note updates, tagging, retry/backoff, and sanitized errors.
- `api/_lib/amazon-customization-archive.js` - trusted-host download and bounded ZIP/JSON extraction.
- `api/_lib/amazon-customization-normalizer.js` - pure Amazon Custom traversal, field classification, note blocks, and normalized app items.
- `api/_lib/amazon-import-store.js` - workspace lease operations and transactional RPC adapter.
- `api/_lib/amazon-import-service.js` - per-shipment orchestration, progress, reconciliation, and summary.
- `api/amazon-import.js` - authenticated POST-only NDJSON handler.
- `src/amazon-api.js` - strict browser NDJSON client.

**New tests**

- `tests/unit/shipstation-client.test.js`
- `tests/unit/amazon-customization-archive.test.js`
- `tests/unit/amazon-customization-normalizer.test.js`
- `tests/unit/amazon-import-store.test.js`
- `tests/unit/amazon-import-service.test.js`
- `tests/unit/amazon-import-api.test.js`
- `tests/unit/amazon-api-client.test.js`
- `tests/e2e/amazon-import.spec.js`
- `tests/db/amazon-import-store.db.test.js`
- `tests/fixtures/amazon-customization-v3.json` - synthetic, non-customer fixture matching observed `version3.0.customizationInfo.surfaces[].areas`.
- `tests/fixtures/amazon-customization.zip` - generated synthetic ZIP containing the fixture JSON plus ignored XML/JPG/SVG entries.

**Modified files**

- `package.json`, `package-lock.json` - `yauzl@3.4.0`.
- `api/_lib/orders-store.js` - expose pure row builders needed by the transactional adapter without changing existing Etsy/clipboard behavior.
- `tools/dev_server.mjs` - local `/api/amazon-import` route.
- `src/app.js`, `src/orders-workspace.js`, `src/styles.css` - Amazon header action, progress, summary, refresh, and accessibility.
- `tests/unit/dev-server-presets.test.js`, `tests/unit/vercel-routing.test.js`, `tests/unit/orders-workspace.test.js` - routing and UI descriptor coverage.
- The exact migration path printed by Task 4's Supabase command - durable lease and atomic item import.

---

### Task 1: Add a bounded Amazon Custom archive reader

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `api/_lib/amazon-customization-archive.js`
- Create: `tests/unit/amazon-customization-archive.test.js`
- Create: `tests/fixtures/amazon-customization-v3.json`
- Create: `tests/fixtures/amazon-customization.zip`

**Interfaces:**
- Produces: `fetchAmazonCustomizationJson({ url, fetchImpl, signal, limits, openZip }) -> Promise<object>`
- Produces: `AmazonCustomizationArchiveError` with safe `code`, `statusCode`, and non-sensitive message.
- Default limits: 5 MiB compressed response, 32 entries, 20 MiB total uncompressed, 2 MiB JSON entry, 15-second timeout.

- [ ] **Step 1: Install the current bounded ZIP dependency**

Run:

```bash
npm install yauzl@3.4.0
```

Expected: `package.json` and `package-lock.json` add `yauzl` version `^3.4.0`.

- [ ] **Step 2: Add synthetic Amazon Custom fixtures**

Create JSON with the observed structure and no production values:

```json
{
  "orderId": "TEST-ORDER",
  "orderItemId": "TEST-ITEM",
  "customizationData": {},
  "version3.0": {
    "customizationInfo": {
      "surfaces": [{
        "name": "Surface 1",
        "areas": [
          { "customizationType": "Option", "name": "Color 1", "label": "Color", "optionValue": "Teal" },
          { "customizationType": "Text", "name": "Text Input 1", "label": "Text Line 1", "text": "Jane" },
          { "customizationType": "Text", "name": "Text Input 2", "label": "^Internal", "text": "ignore me" }
        ]
      }]
    }
  }
}
```

Generate the ZIP through a test helper or checked-in fixture creation script so it contains the JSON plus small ignored `.xml`, `.jpg`, and `.svg` entries.

- [ ] **Step 3: Write failing archive security and limit tests**

Cover:

```js
await expect(fetchAmazonCustomizationJson({
  url: "http://zme-caps.amazon.com/file",
  fetchImpl,
})).rejects.toMatchObject({ code: "untrusted_customization_url" });

await expect(fetchAmazonCustomizationJson({
  url: "https://evil.example/file",
  fetchImpl,
})).rejects.toMatchObject({ code: "untrusted_customization_url" });
```

Also assert: a redirect to an untrusted host fails; non-ZIP content fails; entry-count, compressed, total-uncompressed, and JSON-entry limits fail; abort and timeout fail safely; valid ZIP returns the parsed object; error messages never contain the signed URL.

- [ ] **Step 4: Run the archive tests to verify failure**

Run:

```bash
npx vitest run tests/unit/amazon-customization-archive.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement the minimal bounded reader**

Use `new URL(url)` and require exactly:

```js
url.protocol === "https:"
  && url.hostname === "zme-caps.amazon.com"
  && !url.username
  && !url.password
  && !url.port
```

Use `redirect: "manual"`; resolve and revalidate each redirect with a maximum of three. Stream or incrementally read the body while enforcing the compressed limit. Open with `yauzl.fromBufferPromise(buffer, { lazyEntries: true, validateEntrySizes: true })`, iterate entries, sum `uncompressedSize`, reject unsafe/duplicate JSON entries, and read only the single supported JSON entry through a byte-counting stream.

- [ ] **Step 6: Run archive tests and commit**

Run:

```bash
npx vitest run tests/unit/amazon-customization-archive.test.js
```

Expected: PASS.

Commit:

```bash
git add package.json package-lock.json api/_lib/amazon-customization-archive.js tests/unit/amazon-customization-archive.test.js tests/fixtures
git commit -m "Add bounded Amazon customization archive reader"
```

---

### Task 2: Build the ShipStation V2 client

**Files:**
- Create: `api/_lib/shipstation-client.js`
- Create: `tests/unit/shipstation-client.test.js`

**Interfaces:**
- Produces: `readShipStationConfig(env) -> { apiKey, amazonStoreId }`
- Produces: `createShipStationClient({ apiKey, fetchImpl, sleep, createTimeoutSignal })`
- Client methods:
  - `iteratePendingShipments({ storeId, signal }) -> AsyncGenerator<shipment>`
  - `updateNotesToBuyer({ shipmentId, notesToBuyer, signal }) -> Promise<shipment>`
  - `addShipmentTag({ shipmentId, tagName, signal }) -> Promise<void>`
- Produces: `ShipStationError` with safe `code`, `statusCode`, and `retryable`.

- [ ] **Step 1: Write failing config, pagination, mutation, and retry tests**

Assert exact requests:

```js
expect(fetchImpl).toHaveBeenCalledWith(
  expect.stringContaining("/v2/shipments?"),
  expect.objectContaining({ headers: expect.objectContaining({ "API-Key": "secret" }) }),
);
```

Required cases: missing key/store returns configuration error without printing values; pagination sends `shipment_status=pending`, `store_id`, `page_size=100`, and every page; response-shape validation; `PUT /v2/shipments/{id}` sends only `{ notes_to_buyer }`; tag uses encoded `POST /v2/shipments/{id}/tags/Amazon%20Customization%20Imported`; one response may be partial success only when its schema says so; `429` honors bounded `Retry-After`; `5xx` uses bounded exponential backoff; `4xx` is not retried; abort cancels; errors omit API key and raw body.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npx vitest run tests/unit/shipstation-client.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement request and retry primitives**

Use the fixed base URL `https://api.shipstation.com/v2`, `API-Key`, JSON accept/content headers, 15-second timeouts, at most three total attempts, maximum 10-second server-directed delay, and safe response validation. Do not accept a configurable base URL outside injected tests.

- [ ] **Step 4: Implement the three client methods and strict schemas**

A shipment must have string `shipment_id`, array `items`, array `tags`, and string/null `notes_to_buyer`. Yield each page in API order and stop at `pages`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run tests/unit/shipstation-client.test.js
```

Expected: PASS.

Commit:

```bash
git add api/_lib/shipstation-client.js tests/unit/shipstation-client.test.js
git commit -m "Add ShipStation V2 client"
```

---

### Task 3: Normalize Amazon Custom data and format idempotent notes

**Files:**
- Create: `api/_lib/amazon-customization-normalizer.js`
- Create: `tests/unit/amazon-customization-normalizer.test.js`

**Interfaces:**
- Produces: `extractAmazonCustomizationFields(document) -> { freeTextFields, configurationFields }`
- Produces: `buildAmazonNoteBlock({ productTitle, orderItemId, fields }) -> string`
- Produces: `appendAmazonNoteBlocks({ existingNotes, blocks, maxLength = 1000 }) -> { notes, appendedItemIds }`
- Produces: `normalizeShipStationItem({ shipment, item, customization }) -> { id, text, source }`
- IDs use `amazon-order-item:<external_order_item_id>`.

- [ ] **Step 1: Write failing traversal and classification tests**

Use `version3.0.customizationInfo.surfaces[].areas` in source order. Classify `customizationType` containing `text` as free text from `text` or `displayValue`; classify `optionValue`/option customizations as configuration. Exclude blank labels/values, labels beginning with `^`, URLs/assets, preview/layout metadata, IDs, image paths, and SVG content.

Assert:

```js
expect(extractAmazonCustomizationFields(fixture)).toEqual({
  freeTextFields: [{ name: "Text Line 1", value: "Jane" }],
  configurationFields: [{ name: "Color", value: "Teal" }],
});
```

- [ ] **Step 2: Write failing note and app-item mapping tests**

Cover existing notes preservation, ShipStation product title, multiple item blocks in item order, exact `Amazon Order Item: <id>` marker, no duplicate block on retry, 1,000-character rejection, Amazon order ID mapping, ASIN/SKU/image/quantity/ship-by metadata, ordered newline design text, and `customizationNeeded: true` when free text is absent.

- [ ] **Step 3: Verify tests fail**

Run:

```bash
npx vitest run tests/unit/amazon-customization-normalizer.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement pure normalization**

Prefer the observed `version3.0` shape. Add a narrowly scoped fallback traversal for legacy `customizationData` nodes using `type`, `label`, `displayValue`, `optionSelection.label`, and text-node values. Never treat Amazon archive `title` as product title; accept `item.name`.

Map source metadata:

```js
{
  marketplace: "amazon",
  orderNumber,
  transactionId: orderItemId,
  amazonOrderItemId: orderItemId,
  shipStationShipmentId: shipment.shipment_id,
  listingId: item.asin || "",
  sku: item.sku || "",
  listingTitle: item.name || "",
  listingImageUrl75x75: item.image_url || "",
  quantity: String(item.quantity || 1),
  shipByDate,
  personalizationResponses: [...freeTextFields, ...configurationFields],
  customizationNeeded: freeTextFields.length === 0
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run tests/unit/amazon-customization-normalizer.test.js
```

Expected: PASS.

Commit:

```bash
git add api/_lib/amazon-customization-normalizer.js tests/unit/amazon-customization-normalizer.test.js
git commit -m "Normalize Amazon Custom order data"
```

---

### Task 4: Add a durable Amazon lease and transactional Orders import

**Files:**
- Create via command: the exact migration path printed by `npx supabase migration new amazon_import_state_and_transactional_order_import`
- Create: `tests/db/amazon-import-store.db.test.js`
- Create: `api/_lib/amazon-import-store.js`
- Create: `tests/unit/amazon-import-store.test.js`
- Modify: `api/_lib/orders-store.js`
- Modify: `tests/unit/orders-store.test.js`

**Interfaces:**
- Database RPC: `import_amazon_order_items(p_workspace_id uuid, p_user_id uuid, p_items jsonb) -> jsonb`
- Store methods:
  - `acquireAmazonImportLock({ workspaceId, lockToken, now }) -> Promise<boolean>`
  - `renewAmazonImportLock({ workspaceId, lockToken, now }) -> Promise<boolean>`
  - `releaseAmazonImportLock({ workspaceId, lockToken }) -> Promise<boolean>`
  - `importAmazonOrderItemsTransactional({ workspaceId, userId, items }) -> Promise<{ importedOrderItemIds, existingOrderItemIds }>`
- Lease duration: ten minutes; renew at least every five minutes.

- [ ] **Step 1: Generate the migration using the required command**

Run from repository root:

```bash
npx supabase migration new amazon_import_state_and_transactional_order_import
```

Expected: Supabase prints the exact new migration path. Use that generated file; do not invent or rename its timestamp.

- [ ] **Step 2: Write failing SQL tests for lease ownership and atomic imports**

Prove:

- one workspace lock can be acquired once until expiry;
- only the owning token renews/releases;
- expired locks are reclaimable;
- a batch of normalized shipment items inserts `order_items`, `designs`, and ordered `design_lines` atomically;
- existing durable item IDs are returned as existing and remain unchanged;
- an invalid line payload rolls back the entire RPC with no partial order row;
- service-role-only permissions and RLS block browser clients.

- [ ] **Step 3: Implement additive database state and RPC**

Create `public.amazon_import_state` with `workspace_id uuid primary key references workspaces(id) on delete cascade`, paired `import_lock_until timestamptz`/`import_lock_token text`, timestamps, RLS enabled, all privileges revoked from `anon` and `authenticated`, and service-role access.

Implement `security definer set search_path = public` RPC `import_amazon_order_items`. Validate `p_items` is an array. For each item, insert its supplied order row with `on conflict (id) do nothing`; only when that insert succeeds, insert its design and ordered design lines. Return:

```json
{
  "importedOrderItemIds": ["amazon-order-item:NEW"],
  "existingOrderItemIds": ["amazon-order-item:EXISTING"]
}
```

Any exception aborts the PostgreSQL transaction.

- [ ] **Step 4: Expose pure payload builders without altering existing import semantics**

In `orders-store.js`, export focused helpers that build the existing order/design/line shapes for a normalized item. Keep `importWorkspaceOrderItems` behavior and tests unchanged. The Amazon store adapter packages those shapes as the RPC `p_items` JSON.

- [ ] **Step 5: Write and run failing store adapter tests**

Mock `createSupabaseAdminClient`. Assert lock token checks, conditional acquisition, renewal/release ownership, exact RPC name/arguments, strict return validation, and safe database errors.

Run:

```bash
npx vitest run tests/unit/amazon-import-store.test.js tests/unit/orders-store.test.js
npm run test:db:local
```

Expected before implementation: unit failures; after migration/store implementation: PASS.

- [ ] **Step 6: Verify a fresh local database and commit**

Run:

```bash
npm run prepare:local
npm run test:db:local
npx vitest run tests/unit/amazon-import-store.test.js tests/unit/orders-store.test.js
```

Expected: migration applies cleanly and all focused tests pass.

Commit:

```bash
git add supabase/migrations supabase/tests api/_lib/amazon-import-store.js api/_lib/orders-store.js tests/unit/amazon-import-store.test.js tests/unit/orders-store.test.js
git commit -m "Add transactional Amazon order import state"
```

---

### Task 5: Orchestrate per-shipment Amazon imports

**Files:**
- Create: `api/_lib/amazon-import-service.js`
- Create: `tests/unit/amazon-import-service.test.js`

**Interfaces:**
- Produces: `createAmazonImportService({ store, createShipStationClient, fetchCustomizationJson, normalizeItem, appendNoteBlocks, clock, randomUUID })`
- Service method: `prepare({ workspaceId, userId, signal, onProgress }) -> Promise<{ run, release, lockToken }>`
- Progress:
  - `{ type: "progress", stage: "fetching_shipments", processed: 0, total: null }`
  - `{ type: "progress", stage: "processing_shipments", processed, total }`
- Completion:
  - `{ type: "complete", processedShipments, importedItems, existingItems, alreadyProcessedShipments, customizationNeeded, failed }`.

- [ ] **Step 1: Write failing orchestration tests**

Required scenarios:

- config/client created only after lock acquisition;
- every page is materialized before determinate processing begins;
- processed tag recognized whether tag is `{ name }` or a validated string;
- every line item normalized and persisted;
- missing `CustomizedURL` yields review-needed item without archive fetch;
- multiple customized items create ordered blocks;
- notes are updated before transactional persistence, then tag is added last;
- already-present marker skips note append but still repairs/persists app data and tags;
- existing app items count separately;
- one shipment failure increments `failed`, remains untagged, and later shipments continue;
- abort or lost lease terminates the run;
- lock always releases;
- no progress event includes notes, URLs, or personalization.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npx vitest run tests/unit/amazon-import-service.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the state machine**

For each shipment:

1. skip/count processed tag;
2. find each item's `CustomizedURL` option by exact name;
3. fetch/normalize customization when present;
4. build normalized app items and note blocks;
5. append only missing note blocks and update ShipStation only if notes changed;
6. call the transactional RPC once with all shipment items;
7. add `Amazon Customization Imported`;
8. emit sanitized progress.

Catch deterministic per-shipment errors inside the loop; rethrow abort, auth/config, import-lock loss, and global listing failures.

- [ ] **Step 4: Add lease renewal and concurrency behavior**

Renew after five minutes using the injected clock. Throw a safe `AmazonImportError("import_lock_lost", ..., 409)` if ownership is lost. Return `409 import_in_progress` on acquisition failure.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run tests/unit/amazon-import-service.test.js
```

Expected: PASS.

Commit:

```bash
git add api/_lib/amazon-import-service.js tests/unit/amazon-import-service.test.js
git commit -m "Orchestrate ShipStation Amazon imports"
```

---

### Task 6: Add the authenticated streaming API route

**Files:**
- Create: `api/amazon-import.js`
- Create: `tests/unit/amazon-import-api.test.js`
- Modify: `tools/dev_server.mjs`
- Modify: `tests/unit/dev-server-presets.test.js`
- Modify: `tests/unit/vercel-routing.test.js`

**Interfaces:**
- Produces: `createAmazonImportHandler({ resolveAuth, serviceFactory, dependencies })`
- Route: `POST /api/amazon-import`
- Response: `application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`.

- [ ] **Step 1: Write failing handler and route tests**

Copy the dependency-injection shape from `createEtsyImportHandler`. Prove authentication occurs before service preparation, POST-only behavior, headers flush before run, ordered NDJSON, safe pre-stream and in-stream errors, release on failure/disconnect, no raw error/secret response, local route mapping, and Vercel catch-all exclusion.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npx vitest run tests/unit/amazon-import-api.test.js tests/unit/dev-server-presets.test.js tests/unit/vercel-routing.test.js
```

Expected: FAIL because route/handler do not exist.

- [ ] **Step 3: Implement handler composition**

Inject:

```js
{
  store: amazonImportStore,
  createShipStationClient,
  fetchCustomizationJson: fetchAmazonCustomizationJson,
  normalizeItem: normalizeShipStationItem,
  appendNoteBlocks: appendAmazonNoteBlocks
}
```

Use `resolveProductionBatchAuth`, `writeNdjson`, `isResponseWritable`, and sanitized fallback `Unable to import Amazon orders.`.

- [ ] **Step 4: Map local and deployed routing**

Add `/api/amazon-import` beside `/api/etsy-import` in `tools/dev_server.mjs`. Add routing assertions that `vercel.json` does not rewrite it to `index.html`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run tests/unit/amazon-import-api.test.js tests/unit/dev-server-presets.test.js tests/unit/vercel-routing.test.js tests/unit/dev-server-abort.test.js
```

Expected: PASS.

Commit:

```bash
git add api/amazon-import.js tools/dev_server.mjs tests/unit/amazon-import-api.test.js tests/unit/dev-server-presets.test.js tests/unit/vercel-routing.test.js
git commit -m "Add Amazon import API route"
```

---

### Task 7: Add the browser client and Orders header action

**Files:**
- Create: `src/amazon-api.js`
- Create: `tests/unit/amazon-api-client.test.js`
- Modify: `src/orders-workspace.js`
- Modify: `tests/unit/orders-workspace.test.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Create: `tests/e2e/amazon-import.spec.js`

**Interfaces:**
- Produces: `importAmazonOrders({ accessToken, signal, onEvent }) -> Promise<void>`
- Produces: `getAmazonImportSummary(result) -> string`
- Strict completion keys match Task 5.

- [ ] **Step 1: Write failing browser-client tests**

Mirror the Etsy stream reader but validate Amazon stages/counts. Cover bearer header, POST/Accept headers, malformed/oversized/missing-terminal/multiple-terminal records, safe streamed errors, abort cancellation, reader release, and exact completion count validation.

Run:

```bash
npx vitest run tests/unit/amazon-api-client.test.js
```

Expected: FAIL because the client does not exist.

- [ ] **Step 2: Implement the strict browser client**

Use a 256 KiB maximum NDJSON record, one terminal event, and generic public error `Unable to import Amazon orders.`. Never accept or render extra upstream fields.

- [ ] **Step 3: Write failing UI descriptor and e2e tests**

Assert:

- `Import Amazon` is in the Orders `.batch-header-actions` beside the Etsy action and absent from ellipsis menus;
- stable class `.amazon-import-button`;
- disabled spinner and `aria-busy=true` while running;
- a second click starts no second request;
- Etsy and Amazon actions cannot overlap, so disable both while either import runs;
- progress updates the existing operation dialog;
- completion shows all six approved metrics;
- Orders reloads, current selection survives, and an in-flight Orders load queues one forced refresh;
- retry after safe failure works;
- no signed URL, note body, customer value, raw upstream error, or API key appears;
- compact viewport keeps actions usable and avoids filter/first-row overlap.

- [ ] **Step 4: Implement Amazon UI state**

Create button/spinner/label elements near the Etsy declarations. Initialize them in the Orders header with deterministic order: Etsy action, Amazon action, then Paste and ellipsis. Add `amazonImporting`, request/abort state, render/start/complete/error functions, click listener, and teardown on auth/session reset.

Use:

```js
startOperationDialog({
  title: "Importing from Amazon",
  description: "Importing pending Amazon orders from ShipStation.",
  progressLabel: "Fetching Amazon orders..."
});
```

On completion call `loadDatabaseOrders({ force: true })` and preserve selected ID through the existing load path.

- [ ] **Step 5: Run unit and e2e tests**

Resolve the worktree test URL first as required:

```bash
node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl({ role: 'test' }))"
npx vitest run tests/unit/amazon-api-client.test.js tests/unit/orders-workspace.test.js
npm run test:e2e -- tests/e2e/amazon-import.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/amazon-api.js src/orders-workspace.js src/app.js src/styles.css tests/unit/amazon-api-client.test.js tests/unit/orders-workspace.test.js tests/e2e/amazon-import.spec.js
git commit -m "Add Amazon import Orders workflow"
```

---

### Task 8: Full verification and controlled live rollout preparation

**Files:**
- Modify only if verification exposes a defect in files already listed above.
- Local-only: `.env.local` gains `SHIPSTATION_AMAZON_STORE_ID=se-4461867` if absent; never stage it.

**Interfaces:**
- No new interfaces; this task verifies the complete story.

- [ ] **Step 1: Configure the local non-secret store selector**

Add the ignored local value without printing the API key:

```text
SHIPSTATION_AMAZON_STORE_ID=se-4461867
```

Confirm `git status --short` does not show `.env.local`.

- [ ] **Step 2: Run focused verification**

```bash
npx vitest run tests/unit/shipstation-client.test.js tests/unit/amazon-customization-archive.test.js tests/unit/amazon-customization-normalizer.test.js tests/unit/amazon-import-store.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js tests/unit/orders-workspace.test.js tests/unit/dev-server-presets.test.js tests/unit/vercel-routing.test.js
npm run test:db:local
npm run test:e2e -- tests/e2e/amazon-import.spec.js
```

Expected: all pass.

- [ ] **Step 3: Run full regression verification**

```bash
npm run test:unit
npm run test:e2e
npm run build
```

Expected: all pass with no new warnings attributable to the feature.

- [ ] **Step 4: Perform a read-only local smoke test**

Start through the mandated workflow, authenticate as the test operator, call only the shipment-list path through the app/service in explicit read-only mode, and confirm it reports the expected pending Amazon count without updating notes, tags, or app orders. Do not expose customer data in logs or chat.

- [ ] **Step 5: Stop before live writes and report the deployment gates**

Report:

- exact generated migration path;
- migration is additive;
- production project ref is `oezjskcygvfyezvoulzw`;
- production needs `SHIPSTATION_API_KEY` and `SHIPSTATION_AMAZON_STORE_ID=se-4461867`;
- production migration is not yet applied;
- a deliberately selected single pending shipment should be the first write test.

Ask before applying the migration or performing any production ShipStation write.

- [ ] **Step 6: Review and commit any verification-only fixes**

If no fixes were needed, do not create an empty commit. If fixes were needed, return to the task that owns each affected file, rerun that task's focused verification, and use that task's exact staging and commit command.

Then run `git status --short` and confirm the worktree is clean.
