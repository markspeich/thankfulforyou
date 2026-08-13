# Preserve Etsy Font Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve numbered Etsy font selections for absent text lines and resolve the Etsy value `Super Boy` to the workspace font `Super Boys`.

**Architecture:** Keep line-number ownership in the Etsy normalizer: every numbered dropdown becomes source metadata even when its text line is absent. Keep marketplace spelling compatibility in the shared customer-font resolver through a small internal alias map, allowing the existing overlay path to apply the stored selection whenever a later text line materializes.

**Tech Stack:** JavaScript ESM, Vitest, existing Etsy import and customer-font modules.

## Global Constraints

- Do not synthesize blank design lines.
- Do not split personalization text on repeated spaces.
- Preserve unmatched numbered selections in `source.customerFontSelections`.
- No Fonts UI changes in this work.
- Keep alias resolution isolated from Etsy normalization for future operator-managed aliases.

---

### Task 1: Preserve numbered selections independently of text lines

**Files:**
- Modify: `tests/unit/etsy-import-normalizer.test.js`
- Modify: `api/_lib/etsy-import-normalizer.js`

**Interfaces:**
- Consumes: Etsy variation labels matching `Line N` and normalized design text.
- Produces: `source.customerFontSelections: Array<{lineIndex: number, name: string}>` for every numbered selection and diagnostic outcome `paired | stored_without_design_line`.

- [ ] **Step 1: Add the production-shaped failing regression test**

Use personalization `Kiara  MA`, Line 1 `Quincy`, and Line 2 `Super Boy`. Assert the text retains two spaces, both source selections are present, and diagnostic selection 2 is:

```js
{
  selectionIndex: 1,
  name: "Super Boy",
  lineIndex: 1,
  outcome: "stored_without_design_line",
  mappingSource: "label_line_number",
  labelLineNumber: 2,
}
```

- [ ] **Step 2: Run the focused test and confirm the current behavior fails**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js`

Expected: the second selection is absent from `source.customerFontSelections` and reports `unmatched_design_line` with a null index.

- [ ] **Step 3: Implement independent numbered selection persistence**

In `normalizeEtsyTransaction`, retain `mappedLineIndex` for every positive explicit label number. Use ordinal fallback only when a label lacks a line number, and continue dropping ordinal selections that cannot map to existing text. Set the numbered selection outcome from line existence without clearing its `lineIndex`:

```js
const hasDesignLine = Boolean(designLines[mappedLineIndex]);
const preservesExplicitLine = labelLineNumber !== null;
const lineIndex = hasDesignLine || preservesExplicitLine ? mappedLineIndex : null;
const outcome = hasDesignLine ? "paired" : "stored_without_design_line";
```

Build `customerFontSelections` from every selection with a non-null `lineIndex`.

- [ ] **Step 4: Run the focused normalizer tests**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add api/_lib/etsy-import-normalizer.js tests/unit/etsy-import-normalizer.test.js
git commit -m "fix: preserve future Etsy font selections"
```

---

### Task 2: Resolve internal font aliases and prove later-line application

**Files:**
- Modify: `tests/unit/amazon-customer-fonts.test.js`
- Modify: `src/amazon-customer-fonts.js`
- Test: `tests/unit/etsy-import-service.test.js`

**Interfaces:**
- Consumes: `resolveCustomerFontId(name, fontOptions)` and stored line-number selections.
- Produces: exact alias resolution from requested `Super Boy` to a font option whose display name is `Super Boys`; existing `overlayCustomerFontsOnLines` applies it by line index.

- [ ] **Step 1: Add failing resolver and delayed-line tests**

Add a resolver assertion using:

```js
const fonts = [{ id: "super-boys", displayName: "Super Boys" }];
expect(resolveCustomerFontId("Super Boy", fonts)).toBe("super-boys");
```

Add an overlay assertion proving a stored `{ lineIndex: 1, name: "Super Boy" }` does nothing to a one-line array but applies `super-boys` when a second line is present.

- [ ] **Step 2: Run the focused tests and confirm alias resolution fails**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js tests/unit/etsy-import-service.test.js`

Expected: `resolveCustomerFontId("Super Boy", fonts)` returns null before implementation.

- [ ] **Step 3: Add the internal alias boundary**

Add an immutable requested-name alias map near `aliasesForFontValue`:

```js
const CUSTOMER_FONT_NAME_ALIASES = new Map([
  ["super boy", "super boys"],
]);
```

In `resolveCustomerFontId`, normalize the request and replace it through the map before comparing it with font aliases. Do not add marketplace-specific logic to the Etsy normalizer.

- [ ] **Step 4: Run focused and related import tests**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js tests/unit/etsy-import-normalizer.test.js tests/unit/etsy-import-service.test.js tests/unit/orders-store.test.js`

Expected: all tests pass and no persistence behavior regresses.

- [ ] **Step 5: Commit the task**

```bash
git add src/amazon-customer-fonts.js tests/unit/amazon-customer-fonts.test.js tests/unit/etsy-import-service.test.js
git commit -m "fix: resolve Etsy customer font aliases"
```

---

### Task 3: Full verification and production-shaped review

**Files:**
- Review: `api/_lib/etsy-import-normalizer.js`
- Review: `src/amazon-customer-fonts.js`
- Review: `docs/requirements.md`

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: verified release candidate with no additional schema migration.

- [ ] **Step 1: Run formatting and diff checks**

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 2: Run the full unit suite**

Run: `npm run test:unit`

Expected: all unit tests pass.

- [ ] **Step 3: Run the full end-to-end suite**

Run: `npm run test:e2e`

Expected: all end-to-end tests pass.

- [ ] **Step 4: Review the final diff against the approved design**

Confirm repeated spaces remain unchanged, source metadata includes both numbered selections, the second selection uses `stored_without_design_line`, alias handling lives in the shared resolver, and no schema or UI alias editor was added.
