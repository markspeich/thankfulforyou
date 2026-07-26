# Orders Import Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Etsy and Amazon import actions from the Orders header into the existing ellipsis menu so the menu remains visible at narrow widths.

**Architecture:** Keep the existing import button elements, IDs, classes, event listeners, and state renderers intact; change only their DOM placement and menu styling. Update browser coverage to assert the new action hierarchy and retain existing lifecycle behavior.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Playwright, Vitest.

## Global Constraints

- The always-visible Orders header contains only `Paste` and the Orders ellipsis menu.
- The menu contains an `Import` group before the existing `Orders` group.
- Import actions retain their existing loading, disabled, authentication, progress, completion, error, and mutual-exclusion behavior.
- The compact popover remains content-sized.
- No unrelated refactoring.

---

### Task 1: Relocate and verify Orders import actions

**Files:**

- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `tests/e2e/amazon-import.spec.js`
- Modify: `tests/e2e/etsy-import.spec.js`

**Interfaces:**

- Consumes: Existing `.etsy-import-button` and `.amazon-import-button` elements created by the Orders workspace bootstrap, plus their existing event listeners and state renderers.
- Produces: Header DOM ordered as `#pasteOrdersButton`, `#ordersToolsMenu`; menu DOM ordered as `Import` group, `Orders` group.

- [ ] **Step 1: Write the failing browser assertions**

Update the Amazon import layout test to require two direct header children, require both import buttons inside `#ordersToolsMenu`, and assert Etsy precedes Amazon:

```js
const actions = page.locator("#databaseOrdersWorkspace .batch-header-actions");
await expect(actions.locator(":scope > *")).toHaveCount(2);
await expect(actions.locator(":scope > *").nth(0)).toHaveAttribute(
  "id",
  "pasteOrdersButton",
);
await expect(actions.locator(":scope > *").nth(1)).toHaveAttribute(
  "id",
  "ordersToolsMenu",
);
await expect(page.locator("#ordersToolsMenu .etsy-import-button")).toHaveText(
  "Import Etsy",
);
await expect(page.locator("#ordersToolsMenu .amazon-import-button")).toHaveText(
  "Import Amazon",
);
```

Retain the current import lifecycle assertions against the same classes so behavior coverage follows the relocated elements.

- [ ] **Step 2: Run the focused browser tests and verify failure**

Run:

```text
npm run test:e2e -- tests/e2e/amazon-import.spec.js tests/e2e/etsy-import.spec.js
```

Expected: the layout assertion fails because the import buttons are still direct header children.

- [ ] **Step 3: Move the existing controls into the menu**

In `index.html`, add an `Import` group before the existing `Orders` group:

```html
<div
  class="workspace-tools-group batch-tools-group"
  aria-label="Import actions"
>
  <p class="workspace-tools-heading batch-tools-heading">Import</p>
  <!-- Existing Etsy and Amazon controls are inserted here by the workspace bootstrap. -->
</div>
```

Update the Orders workspace bootstrap insertion target so the unchanged Etsy and Amazon button elements are appended to this group instead of inserted before `#pasteOrdersButton`.

Apply existing `.batch-tool-button` menu sizing to both import controls while preserving `.etsy-import-button` and `.amazon-import-button` hooks.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```text
npm run test:e2e -- tests/e2e/amazon-import.spec.js tests/e2e/etsy-import.spec.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Verify the narrow layout and full relevant suites**

Run:

```text
npm run test:unit
npm run test:e2e
git diff --check
```

Open the Orders workspace at the reported narrow viewport and confirm `Paste` and the ellipsis menu remain visible without horizontal overflow.

- [ ] **Step 6: Commit**

```text
git add index.html src/styles.css tests/e2e/amazon-import.spec.js tests/e2e/etsy-import.spec.js docs/superpowers/plans/2026-07-25-orders-import-menu.md
git commit -m "Move Orders imports into tools menu"
```
