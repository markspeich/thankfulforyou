# Retain Etsy Expected Ship Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Etsy's original `expected_ship_date` transaction value in each imported order item's `source_json` alongside the normalized `ship_by_date` calendar date.

**Architecture:** Extend the existing pure Etsy transaction normalizer to emit the raw API field under its original `expected_ship_date` key. The existing order store already persists the complete normalized `source` object to `order_items.source_json`, so no database migration or store-layer change is needed.

**Tech Stack:** JavaScript ES modules, Vitest, Supabase Postgres JSONB through the existing order import store.

## Global Constraints

- Retain only the single Etsy field needed for diagnosis; do not retain complete receipt or transaction payloads.
- Store the exact API key `expected_ship_date` in `source_json`.
- Preserve a missing or null Etsy value as `null`.
- Continue storing the converted `YYYY-MM-DD` value through the existing `shipByDate` mapping.
- Do not modify existing production order items automatically.
- No schema migration is required because `source_json` already stores normalized source metadata.

---

### Task 1: Retain the Raw Etsy Expected Ship Date

**Files:**
- Modify: `tests/unit/etsy-import-normalizer.test.js`
- Modify: `api/_lib/etsy-import-normalizer.js`
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: `normalizeEtsyTransaction({ receipt, transaction, listing, image, getPresetIdForListingId })` and `transaction.expected_ship_date: number | null | undefined`.
- Produces: `result.source.expected_ship_date: number | null` while preserving `result.source.shipByDate: string`.

- [ ] **Step 1: Extend the normalizer contract test with the raw value**

In the existing `creates the imported item contract with text and file personalization` test, retain the transaction fixture's `expected_ship_date: 1783400340` and add the raw field to the existing `source` expectation:

```js
expect(result).toMatchObject({
  id: "transaction:987",
  text: "Jamie\nRN",
  presetId: "preset-456",
  source: {
    orderNumber: "1234567890",
    transactionId: "987",
    listingId: "456",
    colorName: "Teal",
    quantity: "2",
    expected_ship_date: 1783400340,
    shipByDate: "2026-07-06",
    listingImageUrl75x75: "https://image.test/75",
    customizationNeeded: false,
  },
});
```

Add a separate test proving omission is represented explicitly:

```js
it("retains a missing Etsy expected ship date as null", () => {
  const result = normalizeEtsyTransaction({
    receipt: { receipt_id: 123 },
    transaction: { transaction_id: 456, listing_id: 789, variations: [] },
  });

  expect(result.source.expected_ship_date).toBeNull();
  expect(result.source.shipByDate).toBe("");
});
```

- [ ] **Step 2: Run the focused test and verify the new assertions fail**

Run:

```bash
npx vitest run tests/unit/etsy-import-normalizer.test.js
```

Expected: FAIL because `source.expected_ship_date` is currently absent.

- [ ] **Step 3: Emit the raw Etsy field from the normalizer**

In the returned `source` object in `api/_lib/etsy-import-normalizer.js`, place the raw field beside the normalized value:

```js
expected_ship_date: transaction.expected_ship_date ?? null,
shipByDate: dateFromTimestamp(transaction.expected_ship_date),
```

Do not copy any other raw Etsy transaction fields beyond those already normalized.

- [ ] **Step 4: Record the production data requirement**

Immediately after the existing requirement that Etsy API imports retrieve Ship By Date from `expected_ship_date`, add:

```markdown
- Etsy API imports must retain the transaction's original nullable `expected_ship_date` epoch value as `source_json.expected_ship_date` on each order item alongside the normalized `ship_by_date` calendar date, without retaining the complete raw Etsy transaction payload.
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npx vitest run tests/unit/etsy-import-normalizer.test.js tests/unit/etsy-import-service.test.js tests/unit/etsy-import-api.test.js tests/unit/orders-store.test.js
```

Expected: 4 test files pass with no failures.

Run:

```bash
git diff --check
```

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 6: Review scope and commit the implementation**

Confirm the implementation diff contains only the normalizer, its regression test, and the requirement update. Then run:

```bash
git add api/_lib/etsy-import-normalizer.js tests/unit/etsy-import-normalizer.test.js docs/requirements.md
git commit -m "fix: retain Etsy expected ship date"
```
