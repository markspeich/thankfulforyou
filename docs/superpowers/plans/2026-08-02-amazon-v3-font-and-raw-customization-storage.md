# Amazon V3 Font and Raw Customization Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Amazon v3 `fontFamily` selections correctly and retain each downloaded customization JSON document in a server-only order-item column.

**Architecture:** The normalizer will carry v3 text-area fonts through candidate classification into `customerFontSelections`, with legacy `Name Font` fields as fallback. The import service will attach the unmodified parsed document to an internal top-level property on the enriched item; the transactional store will map that property into a dedicated JSONB column accepted and inserted by the existing atomic RPC. Ordinary order and batch queries will continue using explicit projections that omit the raw column.

**Tech Stack:** Node.js ES modules, Vitest, Supabase Postgres/RLS, Supabase CLI migrations.

## Global Constraints

- Store raw customization JSON in nullable `order_items.amazon_customization_json`.
- Never add the raw document to normalized `source_json`, ShipStation notes, application logs, or client telemetry.
- Ordinary frontend-facing order queries must omit `amazon_customization_json`.
- Existing rows require no backfill; the migration is additive and non-destructive.
- Apply the migration to production project `oezjskcygvfyezvoulzw` only after explicit user approval.
- Use a Supabase CLI-generated migration filename; never invent one manually.

---

### Task 1: Import Version 3 Text-Area Fonts

**Files:**
- Modify: `tests/unit/amazon-customization-normalizer.test.js`
- Modify: `tests/fixtures/amazon-customization-v3.json`
- Modify: `api/_lib/amazon-customization-normalizer.js:84-95,255-265,369-397`

**Interfaces:**
- Consumes: Amazon v3 text areas shaped as `{ customizationType, label, text, fontFamily }`.
- Produces: `normalizeShipStationItem(...).source.customerFontSelections` as `{ lineIndex: number, name: string }[]`.

- [ ] **Step 1: Expand the v3 fixture and write the failing regression test**

Update the accepted text areas in `tests/fixtures/amazon-customization-v3.json` to include literal `fontFamily` values `Skywalk` and `Somekind`. Add a test that normalizes the fixture and asserts:

```js
expect(result.source.customerFontSelections).toEqual([
  { lineIndex: 0, name: "Skywalk" },
  { lineIndex: 1, name: "Somekind" },
]);
```

The test catches removal or omission of v3 `fontFamily` propagation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/amazon-customization-normalizer.test.js`

Expected: FAIL because `customerFontSelections` is absent or empty for v3 area-level fonts.

- [ ] **Step 3: Carry direct font selections through candidate normalization**

Extend accepted v3 text candidates with a normalized optional font name, for example:

```js
return {
  kind: "text",
  fontName: normalizedString(area?.fontFamily),
  ...classifyField(area?.label, firstNonBlank(area?.text, area?.displayValue)),
};
```

Refactor `customerFontData` to consume the classified candidates or equivalent direct-font metadata. For each accepted non-font text field, prefer its direct `fontName`; otherwise use the existing separate-field lookup by normalized label. Preserve line ordering and exclude empty font names.

- [ ] **Step 4: Run the normalizer tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-customization-normalizer.test.js`

Expected: all tests PASS, including existing legacy separate-font-field behavior.

- [ ] **Step 5: Commit the normalization fix**

```powershell
git add api/_lib/amazon-customization-normalizer.js tests/unit/amazon-customization-normalizer.test.js tests/fixtures/amazon-customization-v3.json
git commit -m "fix: import Amazon v3 font selections"
```

### Task 2: Carry the Raw Document to the Transactional Store

**Files:**
- Modify: `tests/unit/amazon-import-service.test.js`
- Modify: `tests/unit/amazon-import-store.test.js`
- Modify: `api/_lib/amazon-import-service.js:385-469`
- Modify: `api/_lib/amazon-import-store.js:55-75`
- Modify: `api/_lib/orders-store.js:68-88`

**Interfaces:**
- Consumes: parsed customization document returned by `fetchCustomizationJson`.
- Produces: internal enriched item property `amazonCustomizationJson`; transactional `orderItem.amazon_customization_json` value.

- [ ] **Step 1: Write a failing service-boundary test**

In `tests/unit/amazon-import-service.test.js`, use a literal parsed customization object and assert that the item passed to `store.importAmazonOrderItemsTransactional` has:

```js
expect.objectContaining({
  amazonCustomizationJson: customizationDocument,
})
```

Also assert an item without a CustomizationURL carries `amazonCustomizationJson: null`. This catches failure to preserve the downloaded object independently of normalized `source`.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because persisted items do not yet have `amazonCustomizationJson`.

- [ ] **Step 3: Attach the raw document without logging or normalizing it**

After enrichment, construct the persistence item with:

```js
const persistenceItem = {
  ...enriched,
  amazonCustomizationJson: url ? customization : null,
};
```

Use `persistenceItem` in `normalizedItems` and `itemRecords`. Do not place the document under `source` or diagnostic context.

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: PASS.

- [ ] **Step 5: Write a failing transactional payload test**

In `tests/unit/amazon-import-store.test.js`, add a representative object to the input item:

```js
amazonCustomizationJson: {
  orderItemId: "amazon-item-1",
  "version3.0": { customizationInfo: { surfaces: [] } },
},
```

Assert `database.calls[0].args.p_items[0].orderItem.amazon_customization_json` equals that object and `source_json` remains exactly `items[0].source`.

- [ ] **Step 6: Run the store test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-store.test.js`

Expected: FAIL because the order-item row omits `amazon_customization_json`.

- [ ] **Step 7: Map the internal property into the database row**

Update `buildImportedOrderItemRow` to add:

```js
amazon_customization_json:
  item?.amazonCustomizationJson && typeof item.amazonCustomizationJson === "object"
    ? item.amazonCustomizationJson
    : null,
```

Keep `source_json: { ...source }` unchanged.

- [ ] **Step 8: Run both focused tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-service.test.js tests/unit/amazon-import-store.test.js`

Expected: all tests PASS.

- [ ] **Step 9: Commit the application data-flow change**

```powershell
git add api/_lib/amazon-import-service.js api/_lib/amazon-import-store.js api/_lib/orders-store.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-store.test.js
git commit -m "feat: retain raw Amazon customization documents"
```

### Task 3: Add the JSONB Column and Update the Atomic Import RPC

**Files:**
- Create: the exact migration path printed by `npx supabase migration new store_raw_amazon_customization`
- Modify: `tests/db/amazon-import-store.db.test.js`

**Interfaces:**
- Consumes: `p_items[*].orderItem.amazon_customization_json` from `importAmazonOrderItemsTransactional`.
- Produces: nullable `public.order_items.amazon_customization_json jsonb`; updated `public.import_amazon_order_items` insertion behavior.

- [ ] **Step 1: Check current Supabase guidance and CLI syntax**

Read the current Supabase changelog and official migration/database JSON documentation. Run:

```powershell
npx supabase --version
npx supabase migration new --help
```

Confirm no relevant breaking migration or JSONB behavior change applies.

- [ ] **Step 2: Generate the migration with the CLI**

Run: `npx supabase migration new store_raw_amazon_customization`

Use only the exact path printed by the command for the SQL below.

- [ ] **Step 3: Write the failing database integration assertion**

Extend `tests/db/amazon-import-store.db.test.js` so an imported item contains a literal `amazonCustomizationJson` document, then explicitly select `amazon_customization_json` and assert deep equality. Re-import the same order-item ID with a second literal document and assert the stored value becomes the second document while the saved design text remains unchanged. These tests catch the RPC allowlist or persistence conflict path dropping the diagnostic payload.

- [ ] **Step 4: Run the database test and verify RED**

Run: `npm run test:db:local -- --run tests/db/amazon-import-store.db.test.js`

Expected: FAIL because the column does not exist or the RPC rejects the new order-item key.

- [ ] **Step 5: Implement the additive migration**

In the CLI-generated migration:

```sql
alter table public.order_items
  add column amazon_customization_json jsonb;
```

Recreate `public.import_amazon_order_items` from its current definition, changing only these contracts:

```sql
-- Include in the order-item JSON key allowlist:
'amazon_customization_json'

-- Include in INSERT columns:
amazon_customization_json

-- Include in INSERT values:
v_order_row.amazon_customization_json
```

Preserve the function's existing security mode, `search_path`, grants, validation, conflict behavior, and transaction semantics exactly.

In the existing-item branch, update only `amazon_customization_json` from the incoming row when the incoming value is non-null and the row belongs to `p_workspace_id`. Do not replace the existing design or normalized order metadata. This ensures a diagnostic document is captured when an order item is re-imported after the feature ships.

- [ ] **Step 6: Rebuild the local database and verify GREEN**

Run: `npm run prepare:local`

Then run: `npm run test:db:local -- --run tests/db/amazon-import-store.db.test.js`

Expected: local preparation succeeds and all Amazon import database tests PASS.

- [ ] **Step 7: Verify migration history and database advisors**

Discover supported syntax first:

```powershell
npx supabase migration list --help
npx supabase db --help
```

Then run the supported local migration-list and advisor commands. Confirm the generated migration is applied locally and no new security/performance advisory is introduced.

- [ ] **Step 8: Commit migration and database test**

```powershell
git add supabase/migrations tests/db/amazon-import-store.db.test.js
git commit -m "feat: store raw Amazon customization JSON"
```

### Task 4: Prove Client Non-Exposure and Document the Requirement

**Files:**
- Modify: `tests/unit/orders-store.test.js`
- Modify: `tests/unit/production-batch-store.test.js`
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: explicit PostgREST select projections in `orders-store.js` and `production-batch-store.js`.
- Produces: ordinary Orders and Production Batch responses without `amazon_customization_json`.

- [ ] **Step 1: Add regression assertions for explicit safe projections**

Extend the existing store-query tests to assert the selected order-item column strings equal the current allowlists and do not contain `amazon_customization_json`. Assert on the returned application objects as well:

```js
expect(result.orderItems[0]).not.toHaveProperty("amazonCustomizationJson");
expect(result.orderItems[0]).not.toHaveProperty("amazon_customization_json");
```

These tests catch accidentally changing an ordinary query to `select("*")` or explicitly exposing the raw column.

- [ ] **Step 2: Run the safe-projection tests**

Run: `npx vitest run tests/unit/orders-store.test.js tests/unit/production-batch-store.test.js`

Expected: PASS with the existing explicit projections. If a test passes without exercising a real projection/result boundary, revise it so removing the projection would fail it.

- [ ] **Step 3: Update the requirements source of truth**

Add requirements stating that Amazon imports retain the complete CustomizationURL JSON in a dedicated server-side diagnostic field, that ordinary client responses and logs omit it, and that v3 `fontFamily` is authoritative for its corresponding text line with legacy labeled font fields as fallback.

- [ ] **Step 4: Run the complete relevant unit suite**

Run:

```powershell
npx vitest run tests/unit/amazon-customization-normalizer.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-store.test.js tests/unit/orders-store.test.js tests/unit/production-batch-store.test.js
```

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Run broader project verification**

Run:

```powershell
npm run test:unit
npm run build
git diff --check
git status --short
```

Expected: unit suite and build exit 0, `git diff --check` prints nothing, and status shows only intended files.

- [ ] **Step 6: Commit documentation and non-exposure coverage**

```powershell
git add docs/requirements.md tests/unit/orders-store.test.js tests/unit/production-batch-store.test.js
git commit -m "test: protect raw Amazon customization data"
```

### Task 5: Deployment Handoff

**Files:**
- Read: the CLI-generated `supabase/migrations/*_store_raw_amazon_customization.sql`

**Interfaces:**
- Consumes: verified additive migration and application commits.
- Produces: an explicit user decision before any live schema or deployment mutation.

- [ ] **Step 1: Report the migration before production application**

Provide the exact migration path, state that it is additive and non-destructive, name live project ref `oezjskcygvfyezvoulzw`, and ask the user for approval to apply it to production.

- [ ] **Step 2: Stop before live changes**

Do not apply the migration, deploy code, merge branches, or push production changes until the user explicitly authorizes those actions.
