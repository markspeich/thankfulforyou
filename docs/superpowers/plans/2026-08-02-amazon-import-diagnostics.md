# Amazon Import Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correlated, privacy-conscious production logs that trace an Amazon Custom item from archive retrieval through parsing, font enrichment, and database persistence.

**Architecture:** Create a focused diagnostics module that builds bounded JSON-safe summaries and shields the import from logger failures. Inject it into the existing Amazon import service, emit safe events at pipeline boundaries, and retain the existing API progress and import behavior.

**Tech Stack:** JavaScript ES modules, Vitest, Vercel Functions logs, existing ShipStation/Amazon Custom and Supabase import services.

## Global Constraints

- Do not log customer-entered customization values, buyer/contact data, raw archives, customization URLs, credentials, authorization data, unsanitized error messages, or stacks.
- Permit only correlation identifiers, bounded structural metadata, preset IDs, internal font IDs, safe error properties, and persistence outcomes.
- Logging failures must never change the import result.
- Do not add a database migration or diagnostic table.
- Keep the public NDJSON progress protocol and import behavior unchanged.

---

### Task 1: Safe Diagnostic Primitives and Customization Summary

**Files:**
- Create: `api/_lib/amazon-import-diagnostics.js`
- Modify: `api/_lib/amazon-customization-normalizer.js`
- Create: `tests/unit/amazon-import-diagnostics.test.js`
- Modify: `tests/unit/amazon-customization-normalizer.test.js`

**Interfaces:**
- Produces: `createAmazonImportDiagnostics({ logger, runId, workspaceId })`, returning `{ info(event, context), error(event, context) }` methods that never throw.
- Produces: `safeAmazonImportError(error)`, returning allowlisted `{ errorName, errorCode, statusCode, retryable, requestId }` properties.
- Produces: `summarizeAmazonCustomization(document)`, returning `{ format, surfaceCount, areaCount, candidateNodeCount, acceptedTextCount, acceptedConfigurationCount, acceptedLabels, rejectedCounts }` without values.
- Consumes: the same v3 and legacy containers and field-acceptance rules used by `extractAmazonCustomizationFields`.

- [ ] **Step 1: Write failing tests for safe envelopes and logger isolation**

Add tests that inject a recording logger and assert the event envelope includes the correlation fields and bounded details. Inject a logger that throws and assert neither `info` nor `error` throws. Serialize every captured event and assert it excludes fixture secrets such as `PRIVATE CUSTOMER TEXT`, `https://zme-caps.amazon.com/private`, `123 Main Street`, and `secret-api-key`.

```js
const diagnostics = createAmazonImportDiagnostics({
  logger,
  runId: "run-1",
  workspaceId: "workspace-1",
});
diagnostics.info("amazon_import.item.started", {
  shipmentId: "shipment-1",
  orderNumber: "113-0000000-0000000",
  orderItemId: "item-1",
  stage: "item_start",
  details: { hasCustomizationUrl: true },
});
expect(logger.info).toHaveBeenCalledWith("Amazon import diagnostic", expect.objectContaining({
  event: "amazon_import.item.started",
  runId: "run-1",
}));
```

- [ ] **Step 2: Run the diagnostics test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: FAIL because `amazon-import-diagnostics.js` does not exist.

- [ ] **Step 3: Implement the minimal safe diagnostics module**

Implement allowlisted envelope construction, bounded strings/arrays/counts, safe error metadata, and guarded logger calls. Use `console` as the default logger but accept an injected logger. Never accept arbitrary raw payloads as event details.

- [ ] **Step 4: Run the diagnostics test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing customization-summary tests**

Add v3, legacy, empty, and unknown fixtures. Include accepted text/configuration fields and rejected internal, URL, asset, markup, metadata-label, and blank candidates. Assert exact structural counts and labels, and assert serialized summaries contain none of the fixture values.

```js
expect(summarizeAmazonCustomization(customization)).toMatchObject({
  format: "v3",
  surfaceCount: 1,
  areaCount: 4,
  acceptedTextCount: 2,
  acceptedConfigurationCount: 2,
  acceptedLabels: ["Name", "Name Font", "Title", "Title Font"],
});
```

- [ ] **Step 6: Run the normalizer test and verify RED**

Run: `npx vitest run tests/unit/amazon-customization-normalizer.test.js`

Expected: FAIL because `summarizeAmazonCustomization` is not exported.

- [ ] **Step 7: Implement the minimal structural summarizer**

Refactor only enough shared classification logic so extraction and diagnostics inspect the same candidates. Bound labels to 40 entries and 80 normalized characters, strip control characters, and expose only counts plus labels.

- [ ] **Step 8: Run focused Task 1 tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-customization-normalizer.test.js`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add api/_lib/amazon-import-diagnostics.js api/_lib/amazon-customization-normalizer.js tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-customization-normalizer.test.js
git commit -m "Add safe Amazon customization diagnostics"
```

### Task 2: Font-Enrichment Diagnostics

**Files:**
- Modify: `api/_lib/amazon-import-enrichment.js`
- Modify: `src/amazon-customer-fonts.js`
- Modify: `tests/unit/amazon-import-service.test.js`
- Modify: `tests/unit/amazon-customer-fonts.test.js`

**Interfaces:**
- Produces: `summarizeCustomerFontResolution(lines, selections, fontOptions)`, returning `{ selectionCount, recognizedCount, unknownCount, effectiveFontIds }` without customer-facing font names.
- Produces: enriched items with an internal non-persisted `diagnostics` summary removed before database row construction, or returns the summary through an injected `onEnriched(summary)` callback.
- Consumes: `resolveCustomerFontId`, `normalizeCustomerFontSelections`, and preset-derived lines.

- [ ] **Step 1: Write failing font-resolution summary tests**

Assert recognized and unknown counts plus effective internal IDs. Use `TOP SECRET FONT VALUE` as the unknown input and assert it is absent from serialized output.

```js
expect(summarizeCustomerFontResolution(
  [{ fontId: "candlepin" }, { fontId: "somekind" }],
  [{ lineIndex: 0, name: "Skywalk" }, { lineIndex: 1, name: "TOP SECRET FONT VALUE" }],
  fontOptions,
)).toEqual({
  selectionCount: 2,
  recognizedCount: 1,
  unknownCount: 1,
  effectiveFontIds: ["skywalk", "somekind"],
});
```

- [ ] **Step 2: Run the customer-font test and verify RED**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

Expected: FAIL because the summary export is missing.

- [ ] **Step 3: Implement font-resolution summary using existing resolvers**

Calculate counts through `normalizeCustomerFontSelections` and `resolveCustomerFontId`, then calculate effective IDs through `overlayCustomerFontsOnLines`. Return only counts and internal IDs.

- [ ] **Step 4: Run the customer-font test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

Expected: PASS.

- [ ] **Step 5: Add an enrichment callback test**

Update `createAmazonItemEnricher` to accept `{ presetSnapshot, fontOptions, onEnriched }`. Assert `onEnriched` receives preset ID, design-line count, and the safe font summary while the enriched item remains persistence-compatible.

- [ ] **Step 6: Run the enrichment/service test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because `onEnriched` is not called.

- [ ] **Step 7: Implement the enrichment callback**

Invoke `onEnriched(summary)` through a guarded helper after preset selection and overlay. Do not attach diagnostics to `item.source` or persisted rows.

- [ ] **Step 8: Run focused Task 2 tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js tests/unit/amazon-import-service.test.js`

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
git add api/_lib/amazon-import-enrichment.js src/amazon-customer-fonts.js tests/unit/amazon-import-service.test.js tests/unit/amazon-customer-fonts.test.js
git commit -m "Report safe Amazon font enrichment diagnostics"
```

### Task 3: Correlated Pipeline Events and Failure Stages

**Files:**
- Modify: `api/amazon-import.js`
- Modify: `api/_lib/amazon-import-service.js`
- Modify: `tests/unit/amazon-import-api.test.js`
- Modify: `tests/unit/amazon-import-service.test.js`

**Interfaces:**
- Consumes: `createAmazonImportDiagnostics`, `summarizeAmazonCustomization`, and enrichment summaries.
- Produces: `createAmazonImportService({ ..., diagnostics })`, where diagnostics provides non-throwing `info` and `error` methods.
- Produces: correlated run, shipment, item, normalization, enrichment, persistence, completion, and failure events.

- [ ] **Step 1: Write a failing successful-pipeline event test**

Inject recording diagnostics into the service. Process one customized item and assert ordered event names from `run.started` through `shipment.completed` and `run.completed`. Assert all events share the run ID and the serialized event list excludes raw customization values, buyer/address fields, and the customization URL.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because the service emits no diagnostic events.

- [ ] **Step 3: Implement correlated success events**

Track shipment and item context with only safe identifiers. Emit customization structural summaries after fetch, normalized counts after normalization, safe enrichment summaries, per-item persistence outcomes derived from returned imported/existing IDs, and shipment/run completion counters.

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing stage-specific error tests**

Parameterize failures at customization fetch, normalization, enrichment, notes update, persistence, and tag update. Assert `amazon_import.shipment.failed` contains the exact stage and safe error metadata but not `error.message` or `error.stack`. Add a logger-throws case and assert the import result is unchanged.

- [ ] **Step 6: Run the service test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: FAIL because per-shipment failures only increment a counter.

- [ ] **Step 7: Implement local stage tracking and safe failure events**

Set the stage immediately before each boundary. Emit the failure event inside the existing per-shipment catch before incrementing `failed`. Emit a run failure only for errors that escape the run.

- [ ] **Step 8: Write failing API wiring tests**

Assert the handler creates one diagnostics instance with the request run ID/workspace ID, passes it to the service and enrichment callback, and preserves existing public progress/error frames.

- [ ] **Step 9: Run the API test and verify RED**

Run: `npx vitest run tests/unit/amazon-import-api.test.js`

Expected: FAIL because diagnostics are not wired.

- [ ] **Step 10: Implement API diagnostics wiring**

Create diagnostics after auth and use the import lock token or a generated UUID as the run ID. Route safe enrichment summaries into the correlated item context without logging customer values. Keep the existing top-level `Amazon import API error` event for compatibility.

- [ ] **Step 11: Run focused Task 3 tests and verify GREEN**

Run: `npx vitest run tests/unit/amazon-import-api.test.js tests/unit/amazon-import-service.test.js`

Expected: PASS.

- [ ] **Step 12: Commit Task 3**

```powershell
git add api/amazon-import.js api/_lib/amazon-import-service.js tests/unit/amazon-import-api.test.js tests/unit/amazon-import-service.test.js
git commit -m "Trace Amazon imports through production logs"
```

### Task 4: Requirements and Full Verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: the completed diagnostics behavior.
- Produces: source-of-truth requirements for privacy exclusions and diagnostic coverage.

- [ ] **Step 1: Update requirements**

Add requirements stating that automated Amazon imports emit correlated structural diagnostics across customization retrieval, normalization, font enrichment, and persistence; per-shipment failures identify their safe stage; and logs exclude raw payloads plus customer-entered/contact values.

- [ ] **Step 2: Run focused diagnostics verification**

Run: `npx vitest run tests/unit/amazon-import-diagnostics.test.js tests/unit/amazon-customization-normalizer.test.js tests/unit/amazon-customer-fonts.test.js tests/unit/amazon-import-api.test.js tests/unit/amazon-import-service.test.js`

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run the complete unit suite**

Run: `npm run test:unit`

Expected: exit 0 with zero failed tests.

- [ ] **Step 4: Run formatting verification**

Run: `git diff --check`

Expected: exit 0 with no output.

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Review the privacy boundary directly**

Search production logging call sites and confirm that no event includes customization objects, field values, buyer/contact objects, URLs, arbitrary exception messages, or stacks.

Run: `rg -n "diagnostics\.(info|error)|Amazon import diagnostic" api`

Expected: every call passes an allowlisted summary or safe identifier context.

- [ ] **Step 7: Commit requirements and final verification state**

```powershell
git add docs/requirements.md
git commit -m "Document Amazon import diagnostic requirements"
```
