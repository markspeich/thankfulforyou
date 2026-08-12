# Etsy Customer Font Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Etsy font-selection dropdowns as persisted per-line font settings instead of design text.

**Architecture:** Classify font selections in the Etsy API normalizer and emit the existing `customerFontSelections` metadata contract. Enrich normalized Etsy items with the existing preset/workspace-font overlay before persistence, then remove the temporary raw-payload diagnostic.

**Tech Stack:** Node.js ES modules, Vitest, Supabase-backed order persistence, Vercel Functions.

## Global Constraints

- Only property-54 dropdown responses with a non-null `value_id`, a non-URL value, and a label containing the standalone word `font` are font selections.
- Non-font dropdown personalization remains design text.
- Free-text responses remain design text even if their label contains `font`.
- Unknown font names remain visible in source metadata and do not override preset fonts.
- Recognized font selections must be persisted into the corresponding `design_lines.font_id` through existing import settings.
- Preserve raw normalized Etsy variations in source metadata.
- Do not add a database migration.
- Remove the temporary targeted raw-transaction production log.

---

### Task 1: Normalize Etsy Font Selections

**Files:**
- Modify: `api/_lib/etsy-import-normalizer.js`
- Test: `tests/unit/etsy-import-normalizer.test.js`

**Interfaces:**
- Consumes: Etsy transaction `variations` objects.
- Produces: `item.text` without font values and `item.source.customerFontSelections` entries shaped as `{ lineIndex, name }`.

- [ ] **Step 1: Write failing normalization tests**

Add literal fixtures covering the captured `Personalization: CPL EDWARDS` plus dropdown `Font Choice: Candlepin` payload, unrelated dropdown design text, free-text font-labeled questions, URLs/empty values, multiple lines, and unmatched selections.

- [ ] **Step 2: Verify the focused normalizer tests fail**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js`

Expected: the captured payload test fails because `Candlepin` remains in design text and no `customerFontSelections` value exists.

- [ ] **Step 3: Implement minimal classification and ordinal pairing**

Normalize identifiers and labels with the existing helpers. Partition accepted property-54 responses into font selections and design responses using the global constraints; build text lines and pair selection names only to existing line indexes.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js`

Expected: all normalizer tests pass.

- [ ] **Step 5: Commit Task 1**

Commit message: `fix: classify Etsy customer font selections`

### Task 2: Enrich and Persist Etsy Line Fonts

**Files:**
- Modify: `api/_lib/etsy-import-service.js`
- Modify: `api/etsy-import.js`
- Test: `tests/unit/etsy-import-service.test.js`
- Test: `tests/unit/etsy-import-api.test.js`

**Interfaces:**
- Consumes: normalized Etsy items containing `source.customerFontSelections`, workspace font options, and preset snapshot data.
- Produces: imported item settings whose recognized font selections override only corresponding preset line `fontId` values before persistence.

- [ ] **Step 1: Write failing service and route tests**

Cover enrichment before `importWorkspaceOrderItems`, unknown font preservation without override, and route construction using workspace fonts plus preset snapshot.

- [ ] **Step 2: Verify the focused service/API tests fail**

Run: `npx vitest run tests/unit/etsy-import-service.test.js tests/unit/etsy-import-api.test.js`

Expected: tests fail because Etsy currently persists the direct normalized item and the route does not create the preset/font enricher.

- [ ] **Step 3: Add Etsy enrichment using the existing shared behavior**

Inject an `enrichItem` function into `createEtsyImportService`, call it after normalization and before persistence, and construct it in the route from the preset snapshot and workspace fonts. Reuse marketplace-agnostic existing overlay behavior rather than duplicating font resolution.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/unit/etsy-import-service.test.js tests/unit/etsy-import-api.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Task 2**

Commit message: `fix: persist Etsy customer line fonts`

### Task 3: Remove Temporary Diagnostic and Verify the Feature

**Files:**
- Modify: `api/_lib/etsy-import-service.js`
- Modify: `tests/unit/etsy-import-service.test.js`

**Interfaces:**
- Consumes: the completed Etsy normalization/enrichment behavior.
- Produces: production-ready code without customer payload logging.

- [ ] **Step 1: Remove the scoped raw-transaction logger and its diagnostic-only test**

Delete `RAW_DIAGNOSTIC_RECEIPT_ID`, `RAW_DIAGNOSTIC_TRANSACTION_ID`, `defaultLogRawTransaction`, the injected diagnostic logger parameter, the import-loop log call, and the diagnostic-only test.

- [ ] **Step 2: Run feature-focused verification**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js tests/unit/etsy-import-service.test.js tests/unit/etsy-import-api.test.js tests/unit/etsy-import.test.js`

Expected: all focused tests pass with zero failures.

- [ ] **Step 3: Run build verification**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Commit Task 3**

Commit message: `chore: remove Etsy payload diagnostic`
