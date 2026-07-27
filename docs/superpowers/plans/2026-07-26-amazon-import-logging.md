# Amazon Import Failure Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit one sanitized, stage-aware structured Vercel log for every failed Amazon import request.

**Architecture:** Extend `ShipStationError` with an optional safe upstream request ID, then let the Amazon import API boundary translate caught errors into a fixed metadata allowlist. Track the handler lifecycle explicitly so the log identifies where the request failed while preserving all existing public responses.

**Tech Stack:** Node.js ES modules, Vercel Functions, Vitest

## Global Constraints

- Never log API keys, authorization headers, upstream response bodies, error messages, stack traces, order or shipment identifiers, customization data, or customer data.
- Preserve all existing HTTP and NDJSON response behavior.
- Emit no error log for successful imports.
- No database migration or product requirements update.

---

### Task 1: Preserve ShipStation Request IDs Safely

**Files:**
- Modify: `api/_lib/shipstation-client.js`
- Test: `tests/unit/shipstation-client.test.js`

**Interfaces:**
- Consumes: ShipStation error response JSON shaped as `{ request_id?: string }`.
- Produces: `new ShipStationError(code, { statusCode, retryable, requestId })`, where `requestId` is a non-empty string or `null`.

- [ ] **Step 1: Write the failing test**

Add a unit test that returns a 401 response with `{ request_id: "req-safe", errors: [{ message: "secret body" }] }`, invokes `iteratePendingShipments`, and expects the rejection to match:

```js
{
  code: "request_failed",
  statusCode: 401,
  retryable: false,
  requestId: "req-safe",
}
```

Also assert that `String(error)` and `JSON.stringify(error)` do not contain `"secret body"`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run tests/unit/shipstation-client.test.js
```

Expected: FAIL because `requestId` is absent.

- [ ] **Step 3: Implement the minimal safe request-ID capture**

Update the error constructor:

```js
export class ShipStationError extends Error {
  constructor(code, {
    statusCode = null,
    retryable = false,
    requestId = null,
  } = {}) {
    super("Unable to communicate with ShipStation.");
    this.name = "ShipStationError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.requestId = typeof requestId === "string" && requestId ? requestId : null;
  }
}
```

For terminal non-success responses, parse JSON inside a guarded helper, keep only a valid `request_id`, and pass it to `ShipStationError`. Do not attach the payload, parsing error, or error messages.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run tests/unit/shipstation-client.test.js
```

Expected: all ShipStation client tests pass.

- [ ] **Step 5: Commit**

```powershell
git add api/_lib/shipstation-client.js tests/unit/shipstation-client.test.js
git commit -m "Capture ShipStation request IDs safely"
```

### Task 2: Emit Sanitized Stage-Aware API Logs

**Files:**
- Modify: `api/amazon-import.js`
- Test: `tests/unit/amazon-import-api.test.js`

**Interfaces:**
- Consumes: caught errors with optional `name`, `code`, `statusCode`, `retryable`, and `requestId`.
- Produces: `console.error("Amazon import API error", metadata)`, with metadata containing only `stage`, `errorName`, `errorCode`, `statusCode`, `retryable`, `requestId`, and `streaming`.

- [ ] **Step 1: Write failing pre-stream and streamed logging tests**

Add a pre-stream test using:

```js
const error = Object.assign(new Error("secret body"), {
  name: "ShipStationError",
  code: "request_failed",
  statusCode: 401,
  retryable: false,
  requestId: "req-safe",
  stack: "secret stack",
});
```

Make `service.prepare()` reject with that error. Spy on `console.error` and expect exactly:

```js
expect(console.error).toHaveBeenCalledWith("Amazon import API error", {
  stage: "prepare",
  errorName: "ShipStationError",
  errorCode: "request_failed",
  statusCode: 401,
  retryable: false,
  requestId: "req-safe",
  streaming: false,
});
```

Assert the serialized log call excludes `"secret body"` and `"secret stack"`.

Add a streamed test whose `run()` rejects and expect `stage: "run"` with `streaming: true`.

Add a success assertion to the existing happy-path test proving `console.error` was not called.

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```powershell
npx vitest run tests/unit/amazon-import-api.test.js
```

Expected: FAIL because the handler emits no logs.

- [ ] **Step 3: Implement lifecycle tracking and allowlisted logging**

Add a stage variable initialized to `"auth"` and update it immediately before `prepare`, `run`, and primary `release` operations.

Add an allowlist serializer:

```js
function errorLogMetadata(error, { stage, streaming }) {
  return {
    stage,
    errorName: typeof error?.name === "string" ? error.name : null,
    errorCode: typeof error?.code === "string" ? error.code : null,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    requestId: typeof error?.requestId === "string" ? error.requestId : null,
    streaming,
  };
}
```

At the start of the outer `catch`, call:

```js
console.error("Amazon import API error", errorLogMetadata(error, { stage, streaming }));
```

Do not pass the error object itself to the logger.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/amazon-import-api.test.js tests/unit/shipstation-client.test.js
```

Expected: both files pass.

- [ ] **Step 5: Commit**

```powershell
git add api/amazon-import.js tests/unit/amazon-import-api.test.js
git commit -m "Log Amazon import failures safely"
```

### Task 3: Full Verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: verified branch ready for integration.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: all unit and browser tests pass.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Check the final diff**

Run:

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors and only the planned commits ahead of `origin/main`.
