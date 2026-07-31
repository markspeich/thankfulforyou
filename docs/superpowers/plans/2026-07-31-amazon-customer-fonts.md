# Amazon Customer Font Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Amazon customer font selections per text line, overlay recognized selections on ASIN preset fonts only, persist the effective fonts, and display the original selections beneath Design Text.

**Architecture:** Add a small environment-neutral customer-font module that normalizes metadata, resolves workspace font names, and overlays only `fontId` on preset-derived line settings. Seller Central and Amazon Custom normalization both emit the same `source.customerFontSelections` shape; browser clipboard import and server ShipStation import each supply their available preset/font registry to the helper before persistence. The Production Batch UI renders sanitized source metadata and uses persisted design-line settings for its effective font controls.

**Tech Stack:** JavaScript ES modules, Vitest, existing Supabase persistence, DOM-based application UI.

## Global Constraints

- Apply an ASIN preset before applying customer font selections.
- A recognized customer font may change only the corresponding line's `fontId`; every other preset setting must remain unchanged.
- Matching, missing, and unknown customer fonts must not change effective preset settings.
- Display imported non-empty selections exactly as `Line N Font: <customer value>` beneath `Design Text`.
- Retain unknown customer font names for display and review.
- Do not add a database migration; use existing `source_json` and `design_lines.font_id` storage.

---

### Task 1: Shared Amazon customer-font semantics

**Files:**
- Create: `src/amazon-customer-fonts.js`
- Test: `tests/unit/amazon-customer-fonts.test.js`

**Interfaces:**
- Produces: `normalizeCustomerFontSelections(selections)`, returning ordered `{ lineIndex, name }` records.
- Produces: `resolveCustomerFontId(name, fontOptions)`, returning a stable font id or `null` using trimmed case-insensitive display-name matching.
- Produces: `overlayCustomerFontsOnLines(lines, selections, fontOptions)`, returning cloned line settings with only recognized, differing `fontId` values changed.
- Produces: `formatCustomerFontSelection(selection)`, returning `Line N Font: value`.

- [ ] **Step 1: Write failing unit tests**

Cover normalized ordering, malformed input, case-insensitive built-in and workspace font resolution, recognized differing overrides, matching/missing/unknown no-ops, preservation of all non-font settings, and exact display copy.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

Expected: FAIL because `src/amazon-customer-fonts.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Use immutable object/array copies. Compare font options by `label` and `displayName`, with built-in id/name fallback, after trimming and lowercasing. Never substitute an unknown font id.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

Expected: PASS.

### Task 2: Seller Central clipboard extraction and browser import overlay

**Files:**
- Modify: `tools/amazon-copy-badge-clipboard.js`
- Modify: `src/etsy-import.js`
- Modify: `src/app.js`
- Test: `tests/unit/amazon-copy-badge-clipboard.test.js`
- Test: `tests/unit/etsy-import.test.js`

**Interfaces:**
- Consumes: shared customer-font helpers from Task 1.
- Produces: clipboard entries with `customerFontSelections: [{ lineIndex: 0, name: "Skywalk" }, ...]`.
- Produces: normalized imported items with the same metadata under `source.customerFontSelections` and preset-derived `settings.lines` overlaid by recognized fonts.

- [ ] **Step 1: Write failing extraction and normalization tests**

Add the `Name: Maria`, `Name Font: Skywalk`, `Title: RN`, `Title Font: Somekind` regression. Assert ordered metadata, source preservation, preset-first line construction, customer-only `fontId` changes, and preservation of bridge/size/offset/scale/lock fields.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/amazon-copy-badge-clipboard.test.js tests/unit/etsy-import.test.js`

Expected: FAIL because the clipboard payload omits customer font metadata and browser normalization does not overlay it.

- [ ] **Step 3: Implement Seller Central metadata emission**

Pair `Name`/`Name Font`, `Title`/`Title Font`, and numbered text/font fields by their emitted text-line order. Include only non-empty font selections and retain their customer-facing names.

- [ ] **Step 4: Implement browser preset-first overlay**

Pass `buildPresetLines`, `createDefaultLineSettings`, `getPresetBaseSettings`, and current `FONT_OPTIONS` through the import normalization options. Construct complete preset settings for the imported text and listing id, then apply the shared font overlay. Preserve `source.customerFontSelections` for persistence and UI use.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-copy-badge-clipboard.test.js tests/unit/etsy-import.test.js`

Expected: PASS.

### Task 3: ShipStation Amazon Custom extraction and server import overlay

**Files:**
- Modify: `api/_lib/amazon-customization-normalizer.js`
- Modify: `api/amazon-import.js`
- Modify: `api/_lib/amazon-import-service.js`
- Test: `tests/unit/amazon-customization-normalizer.test.js`
- Test: `tests/unit/amazon-import-api.test.js`
- Test: `tests/unit/amazon-import-service.test.js`
- Test: `tests/unit/amazon-import-store.test.js`

**Interfaces:**
- Consumes: shared customer-font helpers from Task 1.
- Consumes: workspace preset snapshot from `loadPresetSnapshot(workspaceId)` and font records from `listWorkspaceFonts({ workspaceId })`.
- Produces: normalized Amazon items with preset id, complete preset line settings, `source.customerFontSelections`, and overlaid customer fonts before transactional persistence.

- [ ] **Step 1: Write failing server-path tests**

Assert Amazon Custom fields produce the common ordered metadata, handler dependencies load preset/font registries, the service persists preset-derived lines with only differing customer font ids replaced, and design-line rows contain `skywalk`/`somekind` for the sample.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/amazon-customization-normalizer.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-store.test.js`

Expected: FAIL because the server path currently preserves raw responses but neither pairs fonts nor applies preset settings.

- [ ] **Step 3: Implement Amazon Custom pairing**

Build text lines from accepted free-text fields while excluding configuration-only values, pair font configuration fields by semantic labels, and add ordered customer-font metadata to the normalized source.

- [ ] **Step 4: Implement server preset/font context and overlay**

Load the workspace snapshot and active fonts in the API handler, inject a focused item-enrichment dependency into the service, and enrich each normalized item before it is passed to `importAmazonOrderItemsTransactional`. Resolve listing assignment, merge preset defaults/rules/listing overrides per line, then overlay recognized customer fonts.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-customization-normalizer.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-store.test.js`

Expected: PASS.

### Task 4: Production Batch customer-font display

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/e2e/preview-layout.spec.js`
- Test: `tests/e2e/orders-workspace.spec.js`

**Interfaces:**
- Consumes: `activeOrder.source.customerFontSelections` and `formatCustomerFontSelection`.
- Produces: a hidden-when-empty read-only list directly beneath `#textInput`.

- [ ] **Step 1: Write failing UI test**

Seed an Amazon order whose source contains Skywalk and Somekind selections. Assert the Design Text section shows exactly `Line 1 Font: Skywalk` and `Line 2 Font: Somekind`, and that an order without metadata shows no list.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `npm run test:e2e -- tests/e2e/orders-workspace.spec.js`

Expected: FAIL because no customer-font list exists.

- [ ] **Step 3: Implement semantic markup, rendering, and compact styling**

Add an `aria-live="polite"` container below the Design Text textarea. During render, normalize the active order metadata, replace its children with read-only rows using the exact formatter, and hide the container when empty.

- [ ] **Step 4: Run the focused UI test and verify GREEN**

Run: `npm run test:e2e -- tests/e2e/orders-workspace.spec.js`

Expected: PASS.

### Task 5: Requirements and verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: all completed behavior from Tasks 1-4.
- Produces: source-of-truth requirements documenting import precedence and UI display.

- [ ] **Step 1: Update requirements**

Document that Amazon per-line customer fonts override only differing preset fonts, persist into the design editor, preserve all other preset settings, and display beneath Design Text in the exact `Line N Font: value` format.

- [ ] **Step 2: Run formatting and unit verification**

Run: `git diff --check`

Run: `npm run test:unit`

Expected: both exit 0 with no failures.

- [ ] **Step 3: Run build verification**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 4: Run safe end-to-end verification**

Resolve the worktree test URL through `tools/dev_port.mjs`, then run: `npm run test:e2e`

Expected: exit 0 with no failures.

- [ ] **Step 5: Review the final diff against the design**

Confirm both import paths emit common metadata, preset settings are applied before font overlay, only `fontId` changes, persisted lines drive editor controls, unknown values remain display-only, the exact UI copy is present, and no migration was added.
