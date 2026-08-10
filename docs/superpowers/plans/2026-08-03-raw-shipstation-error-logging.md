# Raw ShipStation Error Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record complete ShipStation error response bodies in trusted server logs while keeping them out of API responses and the browser.

**Architecture:** Read terminal ShipStation error responses once as text, retain a capped raw body only on the server-side `ShipStationError`, and parse the same text best-effort for existing structured metadata. Pass the raw body directly to the existing server diagnostic logger without adding it to public failure sanitizers.

**Tech Stack:** Node.js ES modules, Fetch API, Vitest, Playwright, Vercel serverless logs.

## Global Constraints

- Log ShipStation error response content without field filtering or message allowlisting.
- Keep raw ShipStation error bodies out of API/NDJSON responses, browser dialogs, client telemetry, database records, and source-controlled production fixtures.
- Read each non-success response body exactly once.
- Cap raw bodies at 16,384 characters solely to prevent runaway log volume; append `\n[truncated after 16384 characters]` when truncated.
- Preserve existing request-ID extraction, friendly validation extraction, retry behavior, counters, and public summaries.
- Logger failures must remain non-throwing and must not alter import results.

---

### Task 1: Capture raw ShipStation error bodies

**Files:**
- Modify: `api/_lib/shipstation-client.js`
- Test: `tests/unit/shipstation-client.test.js`

**Interfaces:**
- Produces: `ShipStationError.rawResponseBody: string | null`, server-only.
- Produces: `readErrorDetails(response): Promise<{ requestId, validation, rawResponseBody }>` using one `response.text()` call.

- [ ] **Step 1: Write failing capture tests**

Add tests asserting a terminal JSON response preserves the exact JSON text in `rawResponseBody`, a plain-text 400 preserves its text, and the mock response body reader is called exactly once.

- [ ] **Step 2: Write failing truncation and compatibility tests**

Assert a 16,385-character body becomes the first 16,384 characters plus `\n[truncated after 16384 characters]`. Assert request ID and existing validation metadata are still extracted from JSON text. Assert an unreadable body yields `rawResponseBody: "[ShipStation response body could not be read]"`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/unit/shipstation-client.test.js`

Expected: FAIL because `rawResponseBody` and the read-once text path do not exist.

- [ ] **Step 4: Implement the minimal read-once path**

Add constants for the cap and markers. Extend `ShipStationError` with `rawResponseBody = null`. Replace `response.json()` with one `response.text()` call; retain the capped text, parse that same text with `JSON.parse()` for request ID/validation, and use the unreadable-body marker if reading throws. Do not filter body content.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/shipstation-client.test.js`

Expected: all ShipStation client tests pass.

- [ ] **Step 6: Commit Task 1**

```text
git add api/_lib/shipstation-client.js tests/unit/shipstation-client.test.js
git commit -m "feat: capture raw ShipStation errors"
```

### Task 2: Log raw bodies without exposing them publicly

**Files:**
- Modify: `api/_lib/amazon-import-diagnostics.js`
- Modify: `api/_lib/amazon-import-service.js`
- Test: `tests/unit/amazon-import-diagnostics.test.js`
- Test: `tests/unit/amazon-import-service.test.js`
- Test: `tests/unit/amazon-import-api.test.js`
- Test: `tests/unit/amazon-api-client.test.js`

**Interfaces:**
- Consumes: `ShipStationError.rawResponseBody` from Task 1.
- Produces: server diagnostic detail `rawShipStationResponse` only for genuine `ShipStationError` instances.
- Public `failures` records remain exactly `{ orderNumber, stage, reasonCode, summary }`.

- [ ] **Step 1: Write failing diagnostic tests**

Create genuine `ShipStationError` instances containing distinctive raw JSON and plain text. Assert `amazon_import.shipment.failed` diagnostic details include the exact body under `rawShipStationResponse`. Assert forged non-ShipStation errors cannot inject this field and throwing getters remain non-throwing.

- [ ] **Step 2: Run diagnostic tests and verify RED**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: FAIL because the diagnostic sanitizer does not include the raw body.

- [ ] **Step 3: Add the server-only diagnostic field**

Read `rawResponseBody` only after confirming `error instanceof ShipStationError`; guard the property read so logging cannot throw. Attach it as `rawShipStationResponse` to server diagnostic details. Do not add it to `publicShipmentFailure`, API serializers, or browser parsers.

- [ ] **Step 4: Run diagnostic tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: all diagnostic tests pass.

- [ ] **Step 5: Write and run boundary regressions**

Add service/API/client tests using a distinctive raw body such as `{"message":"PRIVATE SHIPSTATION ERROR","field_value":"PRIVATE VALUE"}`. Assert it appears in the injected server diagnostic logger but not in `JSON.stringify(result)`, NDJSON output, parsed browser completion event, or public failure summaries.

Run:

```text
npx vitest run tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js
```

Expected: all boundary tests pass.

- [ ] **Step 6: Verify logger failure isolation**

Use an injected logger that throws while logging the raw body and assert the shipment failure count/result remain unchanged.

- [ ] **Step 7: Commit Task 2**

```text
git add api/_lib/amazon-import-diagnostics.js api/_lib/amazon-import-service.js tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js
git commit -m "feat: log raw ShipStation error bodies"
```

### Task 3: Requirements and verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Documents the trusted-server-log exception and unchanged public privacy boundary.

- [ ] **Step 1: Update requirements**

Replace the current prohibition on ShipStation response bodies in application logs with an explicit requirement that complete raw ShipStation error bodies be recorded in trusted server logs, capped only for log volume, and remain prohibited from API/browser/client/database surfaces.

- [ ] **Step 2: Run focused unit tests**

Run:

```text
npx vitest run tests/unit/shipstation-client.test.js tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-import-service.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-api-client.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Run full verification**

Run:

```text
npm run test:unit
npm run test:e2e -- tests/e2e/amazon-import.spec.js tests/e2e/orders-workspace.spec.js --grep "Amazon"
npm run build
git diff --check
git status --short
```

Expected: unit and relevant browser tests pass, build exits 0, no whitespace errors, and only intended files are changed.

- [ ] **Step 4: Review the data boundary**

Search the feature diff for `rawResponseBody` and `rawShipStationResponse`. Confirm occurrences are limited to the ShipStation client, server diagnostics, tests, and requirements; no browser or API serializer includes either field.

- [ ] **Step 5: Commit Task 3**

```text
git add docs/requirements.md
git commit -m "docs: require raw ShipStation error logs"
```
