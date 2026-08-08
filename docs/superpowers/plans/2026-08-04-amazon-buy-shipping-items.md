# Amazon Buy Shipping Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include existing ShipStation shipment items in Amazon notes-update requests so Amazon Buy Shipping accepts the update.

**Architecture:** Pass the original `shipment.items` array from the import service into `updateNotesToBuyer()`. Include that array unchanged in the ShipStation PUT body when it is an array; do not add item normalization or filtering.

**Tech Stack:** Node.js ES modules, Fetch API, Vitest, Playwright.

## Global Constraints

- Keep the fix limited to forwarding the existing ShipStation `items` array.
- Do not rebuild, normalize, or filter shipment items.
- Omit `items` only when the supplied value is not an array.
- Preserve existing notes, addresses, carrier, service, shipping-rule, package, retry, logging, persistence, and tagging behavior.
- Add no dependencies or database changes.

---

### Task 1: Forward shipment items in the notes update

**Files:**
- Modify: `api/_lib/amazon-import-service.js`
- Modify: `api/_lib/shipstation-client.js`
- Test: `tests/unit/amazon-import-service.test.js`
- Test: `tests/unit/shipstation-client.test.js`

**Interfaces:**
- `updateNotesToBuyer({ ..., items, ... })` consumes `items: unknown`.
- The PUT body includes `items` unchanged only when `Array.isArray(items)`.

- [ ] **Step 1: Write the failing service regression test**

Extend the existing shipping-preservation test fixture with a representative Amazon Buy Shipping item array. Assert `client.updateNotesToBuyer` receives the exact same `shipment.items` array reference/content under `items`.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because the service call does not pass `items`.

- [ ] **Step 3: Pass shipment items from the service**

Add exactly one property to the existing call:

```js
items: shipment.items,
```

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: all service tests pass.

- [ ] **Step 5: Write the failing client request-body test**

Extend the existing `preserves mutable shipping configuration when updating buyer notes` test. Pass a representative `items` array and assert the JSON request body contains that exact array alongside `notes_to_buyer`, `packages`, carrier, service, rule, and address fields. Add one case proving a non-array `items` value is omitted.

- [ ] **Step 6: Run the client test and verify RED**

Run: `npx vitest run tests/unit/shipstation-client.test.js`

Expected: FAIL because `updateNotesToBuyer()` does not accept or serialize `items`.

- [ ] **Step 7: Add items to the client request**

Add `items` to the function parameters and one conditional body entry:

```js
...(Array.isArray(items) ? { items } : {}),
```

- [ ] **Step 8: Run both focused suites and verify GREEN**

Run:

```text
npx vitest run tests/unit/amazon-import-service.test.js tests/unit/shipstation-client.test.js
```

Expected: both focused suites pass.

- [ ] **Step 9: Commit Task 1**

```text
git add api/_lib/amazon-import-service.js api/_lib/shipstation-client.js tests/unit/amazon-import-service.test.js tests/unit/shipstation-client.test.js
git commit -m "fix: preserve Amazon shipment items"
```

### Task 2: Requirements and full verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Documents that Amazon Buy Shipping notes updates resend the existing shipment items.

- [ ] **Step 1: Update requirements**

Add one requirement stating that ShipStation notes updates for Amazon Buy Shipping shipments must include the shipment's existing items array because ShipStation requires it.

- [ ] **Step 2: Run focused and full verification**

Run:

```text
npx vitest run tests/unit/amazon-import-service.test.js tests/unit/shipstation-client.test.js
npm run test:unit
npm run test:e2e -- tests/e2e/amazon-import.spec.js tests/e2e/orders-workspace.spec.js --grep "Amazon"
npm run build
git diff --check
git status --short
```

Expected: all focused and unit tests pass, relevant browser tests pass on the worktree-specific test port, build exits 0, no whitespace errors, and status lists only intended files.

- [ ] **Step 3: Commit Task 2**

```text
git add docs/requirements.md
git commit -m "docs: require Amazon shipment items"
```
