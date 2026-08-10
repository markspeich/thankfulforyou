# Amazon Import Failure Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a privacy-safe, order-specific explanation when ShipStation rejects an Amazon shipment update, while recording the same safe reason in production diagnostics.

**Architecture:** Parse each terminal ShipStation error response once into an immutable safe metadata object. Propagate a bounded public failure record through the Amazon import service and NDJSON completion event, then format that record in a pure Orders workspace helper before the app renders it with the existing operation dialog.

**Tech Stack:** Node.js ES modules, Fetch API, Vitest, Playwright, Vercel serverless functions.

## Global Constraints

- Never retain or expose the raw ShipStation error payload or arbitrary upstream message.
- Never expose buyer contact data, customization text, notes-to-buyer content, URLs, credentials, or response values.
- Use only allowlisted validation structures, bounded strings/arrays, stable reason codes, and application-authored friendly sentences.
- Keep existing import ordering, retries, successful shipment behavior, and database schema unchanged.
- Render untrusted response data through `textContent`; do not introduce HTML rendering.
- An import with failures must settle the existing modal into a dismissible `Operation Failed` state.

---

### Task 1: Sanitize ShipStation validation responses

**Files:**
- Modify: `api/_lib/shipstation-client.js`
- Test: `tests/unit/shipstation-client.test.js`

**Interfaces:**
- Produces: `ShipStationError.validation` as either `null` or a frozen `{ reasonCode: string, field: string | null, summary: string }`.
- Produces: one guarded error-body reader that returns `{ requestId, validation }` without retaining the source payload.
- Consumes: ShipStation terminal non-success `Response` objects.

- [ ] **Step 1: Write failing tests for safe validation extraction**

Add tests whose mocked 400 JSON response includes `request_id` and a documented validation error for `packages[0].weight`. Assert the rejected `ShipStationError` contains the request ID and exactly:

```js
validation: {
  reasonCode: "required_field",
  field: "package_weight",
  summary: "Package weight is required.",
}
```

Add table cases for invalid shipping service and a generic 400 response.

- [ ] **Step 2: Write failing privacy and bounds tests**

Use distinctive buyer names, addresses, notes, URLs, and oversized arbitrary messages in unknown response properties. Serialize the thrown error's enumerable safe metadata and assert none of those values appear; assert unknown/malformed JSON yields `validation: null` while preserving safe `request_id` behavior.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/shipstation-client.test.js`

Expected: FAIL because `ShipStationError.validation` and validation extraction do not exist.

- [ ] **Step 4: Implement the minimal safe parser**

Extend the constructor signature to:

```js
constructor(code, {
  statusCode = null,
  retryable = false,
  requestId = null,
  validation = null,
} = {})
```

Replace `readRequestId(response)` with one guarded JSON read. Recognize only explicit field/code combinations needed by the tests, map upstream fields to stable internal field names, construct summaries from application-owned copy, freeze the resulting object, and return `null` for everything else. Pass `{ requestId, validation }` to the terminal `ShipStationError`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/unit/shipstation-client.test.js`

Expected: all ShipStation client tests pass.

- [ ] **Step 6: Commit Task 1**

```text
git add api/_lib/shipstation-client.js tests/unit/shipstation-client.test.js
git commit -m "feat: sanitize ShipStation validation errors"
```

### Task 2: Propagate bounded Amazon shipment failures

**Files:**
- Modify: `api/_lib/amazon-import-diagnostics.js`
- Modify: `api/_lib/amazon-import-service.js`
- Modify: `api/amazon-import.js`
- Test: `tests/unit/amazon-import-diagnostics.test.js`
- Test: `tests/unit/amazon-import-service.test.js`
- Test: `tests/unit/amazon-import-api.test.js`

**Interfaces:**
- Consumes: `ShipStationError.validation` from Task 1.
- Produces: completion property `failures: Array<{ orderNumber: string, stage: string, reasonCode: string, summary: string }>` capped at 10 entries.
- Produces: diagnostic details `validationReasonCode`, `validationField`, and `validationSummary`, all derived from trusted Task 1 metadata.

- [ ] **Step 1: Write failing diagnostic sanitizer tests**

Create a genuine `ShipStationError` with safe validation metadata and assert `safeAmazonImportError()` returns the three validation fields. Create forged errors and unsafe strings and assert those fields are omitted.

- [ ] **Step 2: Run diagnostic tests and verify RED**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: FAIL because validation metadata is not emitted.

- [ ] **Step 3: Extend diagnostics with strict allowlists**

Allow only Task 1 reason codes and field identifiers, cap the summary at 160 characters, and accept validation metadata only when `error instanceof ShipStationError`. Include these fields in `shipment.failed` details without changing existing identifiers or error fields.

- [ ] **Step 4: Run diagnostic tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: all diagnostic tests pass.

- [ ] **Step 5: Write failing service tests for public failure records**

Make `updateNotesToBuyer` reject with a real sanitized `ShipStationError`. Assert the completion result retains existing counters and adds one record with the order number, `notes_update`, reason code, and friendly summary. Add 11 failing shipments and assert only 10 records are returned while `failed === 11`. Assert arbitrary properties and unsafe messages never appear in `JSON.stringify(result)`.

- [ ] **Step 6: Run service tests and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because the completion result has no `failures` array.

- [ ] **Step 7: Implement bounded failure accumulation**

Initialize a local `failures = []`. In the existing per-shipment catch, derive a public record only from the safe error helper, append at most 10 records, and keep incrementing the aggregate `failed` count. Include `failures` in the final completion result and progress event.

- [ ] **Step 8: Run service tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: all Amazon import service tests pass.

- [ ] **Step 9: Write and run API stream regression tests**

Add a completion-stream assertion that the safe `failures` array reaches the NDJSON client unchanged and a privacy assertion that arbitrary error response content does not. Run:

`npx vitest run tests/unit/amazon-import-api.test.js`

Expected after the tests are written: PASS without changing the API handler unless its existing completion-event validation strips the new field; if it does, minimally extend that allowlist.

- [ ] **Step 10: Commit Task 2**

```text
git add api/_lib/amazon-import-diagnostics.js api/_lib/amazon-import-service.js api/amazon-import.js tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js
git commit -m "feat: report Amazon shipment failure details"
```

### Task 3: Render an actionable failure dialog

**Files:**
- Modify: `src/orders-workspace.js`
- Modify: `src/app.js`
- Test: `tests/unit/orders-workspace.test.js`
- Test: `tests/e2e/orders-workspace.spec.js`

**Interfaces:**
- Consumes: Task 2 completion object and bounded `failures` records.
- Produces: `getAmazonImportFailureDescription(summary): string | null`.
- Produces: dialog title `Operation Failed` when `summary.failed > 0`.

- [ ] **Step 1: Write failing pure formatter tests**

Assert one safe failure formats as:

```text
Amazon order 111-0318024-9415409 failed while updating ShipStation notes: Package weight is required.
```

Assert two failures add ` One additional Amazon order failed.` Assert invalid records return the generic fallback and a zero-failure summary returns `null`. Include hostile strings and assert they are never returned.

- [ ] **Step 2: Run formatter tests and verify RED**

Run: `npx vitest run tests/unit/orders-workspace.test.js`

Expected: FAIL because `getAmazonImportFailureDescription` is not exported.

- [ ] **Step 3: Implement the pure formatter**

Validate order numbers, stages, reason codes, and application-authored summary strings against explicit allowlists. Translate `notes_update` to `while updating ShipStation notes`. Return the generic fallback for invalid or absent details and never interpolate unvalidated strings.

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run: `npx vitest run tests/unit/orders-workspace.test.js`

Expected: all Orders workspace unit tests pass.

- [ ] **Step 5: Write a failing browser test**

Mock the Amazon NDJSON completion event with `failed: 1` and a safe failure record. Trigger Import Amazon and assert the existing modal shows `Operation Failed`, the order-specific description, the six metrics, and a visible Close button.

- [ ] **Step 6: Run the browser test and verify RED**

First resolve the worktree test URL with the repository helper, then run the specific Playwright test through `npm run test:e2e -- tests/e2e/orders-workspace.spec.js --grep "Amazon import failure details"`.

Expected: FAIL because the app still titles the modal `Amazon Import Complete` and only renders aggregate counts.

- [ ] **Step 7: Wire the formatter into the dialog**

Import `getAmazonImportFailureDescription` in `src/app.js`. When `amazonImportResult.failed > 0`, call `completeOperationDialog()` with title `Operation Failed`, the formatted description, and the existing metrics. Preserve `Amazon Import Complete` for zero failures.

- [ ] **Step 8: Run unit and browser tests and verify GREEN**

Run:

```text
npx vitest run tests/unit/orders-workspace.test.js
npm run test:e2e -- tests/e2e/orders-workspace.spec.js --grep "Amazon import failure details"
```

Expected: both commands pass.

- [ ] **Step 9: Commit Task 3**

```text
git add src/orders-workspace.js src/app.js tests/unit/orders-workspace.test.js tests/e2e/orders-workspace.spec.js
git commit -m "feat: explain Amazon import failures"
```

### Task 4: Requirements and full verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Documents the safe error-detail and dialog behavior delivered by Tasks 1–3.

- [ ] **Step 1: Update requirements**

Add explicit requirements that Amazon per-shipment failures show the affected order and friendly stage-specific reason, production logs retain matching sanitized validation metadata, raw ShipStation error responses remain private, and partial failures preserve successful-result metrics.

- [ ] **Step 2: Run focused tests together**

Run:

```text
npx vitest run tests/unit/shipstation-client.test.js tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js tests/unit/orders-workspace.test.js
```

Expected: all focused unit tests pass.

- [ ] **Step 3: Run the complete unit suite**

Run: `npm run test:unit`

Expected: zero failing tests.

- [ ] **Step 4: Run relevant browser verification**

Run: `npm run test:e2e -- tests/e2e/orders-workspace.spec.js --grep "Amazon import"`

Expected: all Amazon import browser tests pass using the worktree-specific test port.

- [ ] **Step 5: Run static and production checks**

Run:

```text
git diff --check
npm run build
git status --short
```

Expected: no whitespace errors, build exits 0, and status lists only intended task files.

- [ ] **Step 6: Review privacy invariants**

Search the diff for `responseBody`, raw `message`, buyer/contact fields, notes content, and HTML insertion. Confirm every browser-visible or logged detail originates from an allowlist and application-authored copy.

- [ ] **Step 7: Commit Task 4**

```text
git add docs/requirements.md
git commit -m "docs: require actionable Amazon import errors"
```
