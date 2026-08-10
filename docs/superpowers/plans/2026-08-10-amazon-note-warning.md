# Amazon Note Synchronization Warning Implementation Plan

> **Superseded warning-detail transport instructions (approved 2026-08-10):** The original ten-detail cap described below in Task 1 and Task 2 is no longer valid. The approved requirement is to preserve every validated safe warning detail without a fixed total-count cap. To keep the browser's 256 KiB per-record safety limit, the API streams warning details in bounded `warning_details` NDJSON frames before a detail-free terminal `complete` record. The browser validates and accumulates those frames in stream order, then delivers one terminal completion event with the full `warningDetails` list only after the stream ends successfully. Historical cap language remains below only as a record of the original plan and must not be implemented.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist valid Amazon order items when ShipStation note or tag synchronization fails, reporting safe non-blocking warnings in completion feedback.

**Architecture:** Make transactional app persistence the shipment's durable success boundary, then execute ShipStation Notes to Buyer and processed-tag side effects. Extend the strict NDJSON stream with sanitized warning-detail frames whose individual record size is bounded while the total validated warning count is not, and render warnings without changing a zero-failure import into an error.

**Tech Stack:** Node.js ESM, Supabase RPC, ShipStation API client, vanilla browser JavaScript, Vitest, Playwright.

## Global Constraints

- Persist each shipment's normalized items all-or-nothing.
- Public warnings contain only an Amazon order number, `notes_update` or `tag_update`, and fixed app-authored text.
- No raw ShipStation response, note, customer/buyer data, customization URL, or provider error text may reach the browser.
- A note warning skips tagging; no automatic note truncation is allowed.

---

### Task 1: Add the safe warning protocol

**Files:**
- Modify: `api/amazon-import.js:29-95`
- Modify: `src/amazon-api.js:3-140`
- Test: `tests/unit/amazon-import-api.test.js`
- Test: `tests/unit/amazon-api-client.test.js`

**Interfaces:**
- Consumes: complete events with `warnings: number` and optional `warningDetails: Array<{ orderNumber, stage, summary }>`.
- Produces: exact browser events that accept only safe warning records.

- [ ] **Step 1: Write failing API-handler and browser-parser tests**

```js
const warningCompletion = { type: "complete", processedShipments: 0, importedItems: 6, existingItems: 0, alreadyProcessedShipments: 0, customizationNeeded: 0, warnings: 1, failed: 0, warningDetails: [{ orderNumber: "114-7445306-8228220", stage: "notes_update", summary: "ShipStation Notes to Buyer is too long to update." }] };
```

Assert the handler streams the exact record and `importAmazonOrders({ onEvent })` delivers it unchanged.

- [ ] **Step 2: Run the tests to verify the new contract fails**

Run: `npx vitest run tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js`

Expected: FAIL because warnings are currently extra completion fields.

- [ ] **Step 3: Implement exact sanitization and parsing**

**Superseded historical instruction:** Add `warnings` to completion numeric fields. Add `safeWarnings`/`parseWarningDetails` with a limit of ten and exact keys `{ orderNumber, stage, summary }`. Accept only stages `notes_update`/`tag_update` and fixed summaries `ShipStation Notes to Buyer is too long to update.` and `ShipStation synchronization could not be completed.`. Add four completion-key variants: base, failures, warning details, both. **Do not implement the ten-detail limit or terminal warning-detail variants; use the approved bounded-frame transport described at the top of this plan.**

- [ ] **Step 4: Add rejection tests and rerun**

Reject oversized lists, unsafe order numbers/stages/summaries, and extra keys such as `rawShipStationResponse`.

Run: `npx vitest run tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add api/amazon-import.js src/amazon-api.js tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js; git commit -m "feat: expose safe Amazon sync warnings"`

### Task 2: Persist before ShipStation side effects

**Files:**
- Modify: `api/_lib/amazon-import-service.js:405-615`
- Modify: `api/_lib/amazon-import-diagnostics.js:1-250`
- Test: `tests/unit/amazon-import-service.test.js:315-530`

**Interfaces:**
- Consumes: normalized/enriched items and current persistence, note, and tag dependencies.
- Produces: `warnings`, `warningDetails`, and trusted `amazon_import.shipment.warning` diagnostics.

- [ ] **Step 1: Write the failing oversized-note regression test**

Make `appendNoteBlocks` throw `new RangeError("ShipStation notes exceed 1000 characters")` for a six-item shipment. Assert six items persist, `warnings: 1`, `failed: 0`, the warning is `{ orderNumber: "114-7445306-8228220", stage: "notes_update", summary: "ShipStation Notes to Buyer is too long to update." }`, and no tag call occurs. Add a later good shipment and assert it completes.

- [ ] **Step 2: Add tag failure and retry tests**

After successful persistence, reject `addShipmentTag` and assert a `tag_update` warning with zero failures. Run the note-warning shipment twice, returning imported IDs then existing IDs; make the second note/tag attempt succeed and assert no duplicate app rows.

- [ ] **Step 3: Run the test to prove current behavior fails**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because current note work precedes persistence and increments `failed`.

- [ ] **Step 4: Reorder and isolate ShipStation work**

After item normalization/enrichment, call `importAmazonOrderItemsTransactional`, update imported/existing/customization counts, and emit `item.persisted`. Then run note build/append/update in a nested synchronization `try`. Convert a `RangeError` to the fixed note-size warning; map other synchronization errors to the generic fixed warning. Emit `shipment.warning`, increment `warnings`, retain every validated detail record with no fixed total cap, and skip tagging on a note warning. Attempt tag only after notes succeed; convert tag failure to a `tag_update` warning. Increment `processedShipments` only after persistence, notes, and tag all succeed. Keep pre-persistence and persistence errors in the existing failure path. The original instruction to append no more than ten details is superseded by the approved bounded-frame transport described at the top of this plan.

- [ ] **Step 5: Extend diagnostics safely**

Add `shipment.warning` and `warnings` count support to `amazon-import-diagnostics.js`; retain trusted error metadata in logs only, without adding message fields to public context.

- [ ] **Step 6: Rerun and commit**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: PASS.

Run: `git add api/_lib/amazon-import-service.js api/_lib/amazon-import-diagnostics.js tests/unit/amazon-import-service.test.js; git commit -m "fix: import Amazon orders despite note sync warnings"`

### Task 3: Render warning-only imports as successful

**Files:**
- Modify: `src/orders-workspace.js:280-355`
- Modify: `src/app.js:Amazon import completion handler`
- Test: `tests/unit/orders-workspace.test.js`
- Test: `tests/e2e/amazon-import.spec.js:128-230`

**Interfaces:**
- Consumes: validated `warnings` and `warningDetails`.
- Produces: `getAmazonImportWarningDescription(summary)` and a successful dialog with `Warnings` metric.

- [ ] **Step 1: Write failing helper tests**

Assert the safe detail returns `Amazon order 114-7445306-8228220 was imported, but ShipStation Notes to Buyer could not be updated because the note is too long.` Assert malformed data uses generic fixed copy and injected text is never echoed. Assert the standard summary includes warning count.

- [ ] **Step 2: Implement safe presentation**

Add a defensive warning helper beside `getAmazonImportFailureDescription`, with exact order/stage/summary validation. In `src/app.js`, choose failed presentation only when `failed > 0`. For warnings with zero failures, keep `Amazon Import Complete`, append the safe warning description, and render metrics: processed, imported, existing, already processed, needs review, warnings, failed.

- [ ] **Step 3: Add browser coverage and run tests**

Send a completion event with six imports, one warning, and zero failures. Assert title `Amazon Import Complete`, seven metrics including `Warnings: 1` and `Failed: 0`, safe order/action copy, and Orders refresh. Preserve the existing failed-event case.

Run: `npx vitest run tests/unit/orders-workspace.test.js`

Run: `npm run test:e2e -- --grep "Amazon"`

Expected: PASS on the worktree-isolated test port.

- [ ] **Step 4: Commit**

Run: `git add src/orders-workspace.js src/app.js tests/unit/orders-workspace.test.js tests/e2e/amazon-import.spec.js; git commit -m "feat: show Amazon note sync warnings"`

### Task 4: Verify end-to-end safety

**Files:**
- Modify only if a test reveals a defect in Tasks 1-3.

- [ ] **Step 1: Run focused verification**

Run: `npx vitest run tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js tests/unit/amazon-import-service.test.js tests/unit/orders-workspace.test.js`

Expected: PASS.

- [ ] **Step 2: Run Amazon browser verification**

Run: `npm run test:e2e -- --grep "Amazon"`

Expected: PASS.

- [ ] **Step 3: Confirm final diff**

Run: `git diff main...HEAD --check; git log --oneline main..HEAD; git status --short`

Expected: no whitespace errors and only intentional implementation changes.
