# Remove Etsy Customization Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop treating Etsy orders without personalization text as needing customization review, and clear the inferred flag from historical non-Amazon order metadata.

**Architecture:** Correct the inference at the Etsy normalization boundary while preserving the existing import completion contract. Apply a narrowly filtered JSONB data migration to historical records, retaining Amazon flags and every unrelated metadata field.

**Tech Stack:** Node.js ES modules, Vitest, PostgreSQL JSONB, Supabase migrations.

## Global Constraints

- Etsy API imports must not set `customizationNeeded` solely because extracted design text is empty.
- Amazon customization detection and warnings must remain unchanged.
- The Etsy completion event keeps the `customizationNeeded` numeric field and reports `0` for newly normalized Etsy items.
- Historical cleanup removes only the top-level `customizationNeeded` key from non-Amazon `source_json`; it must preserve all other metadata and all order/design records.
- The migration is checked in and verified locally, but is not applied to production during this implementation.
- Product requirements remain in `docs/requirements.md`.

---

### Task 1: Correct Etsy normalization and document the requirement

**Files:**
- Modify: `tests/unit/etsy-import-normalizer.test.js`
- Modify: `api/_lib/etsy-import-normalizer.js`
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: `normalizeEtsyTransaction({ receipt, transaction, listing, image, getPresetIdForListingId })`.
- Produces: the same normalized item shape, except Etsy `source` omits `customizationNeeded`; extracted text and `personalizationResponses` remain unchanged.

- [ ] **Step 1: Change the missing-personalization test to specify valid empty Etsy designs**

Replace the current test named `marks missing, blank, or URL-only personalization for customization` with:

```js
it("allows missing, blank, or URL-only Etsy personalization without requesting review", () => {
  for (const variations of [
    [],
    [{ property_id: 54, formatted_name: "Name", formatted_value: " " }],
    [{ property_id: 54, formatted_name: "Upload", formatted_value: "https://x.test/a" }],
  ]) {
    const result = normalizeEtsyTransaction({
      receipt: {},
      transaction: { transaction_id: 1, variations },
    });
    expect(result.text).toBe("");
    expect(result.source).not.toHaveProperty("customizationNeeded");
  }
});
```

Also change the personalized-item expectation so it no longer expects `customizationNeeded: false` and explicitly asserts:

```js
expect(result.source).not.toHaveProperty("customizationNeeded");
```

- [ ] **Step 2: Run the focused test and confirm it fails for the old inference**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js`

Expected: FAIL because normalized Etsy source still has `customizationNeeded`.

- [ ] **Step 3: Remove the inferred flag at the normalization boundary**

In `api/_lib/etsy-import-normalizer.js`, remove this property from the returned `source` object:

```js
customizationNeeded: !textValue,
```

Do not change text extraction, URL classification, response preservation, or Amazon code.

- [ ] **Step 4: Record the product rule**

Add this requirement in the Etsy import section of `docs/requirements.md`:

```markdown
- Etsy listings may validly require no personalization. Missing, blank, or file-only Etsy personalization must not by itself mark an imported item as needing customization review.
```

- [ ] **Step 5: Run focused normalization and service tests**

Run: `npx vitest run tests/unit/etsy-import-normalizer.test.js tests/unit/etsy-import-service.test.js`

Expected: PASS. The service contract still includes `customizationNeeded`; its fixture-driven counting behavior remains covered.

- [ ] **Step 6: Commit the focused behavior correction**

```powershell
git add tests/unit/etsy-import-normalizer.test.js api/_lib/etsy-import-normalizer.js docs/requirements.md
git commit -m "fix: allow Etsy orders without personalization"
```

### Task 2: Clean historical non-Amazon warning metadata

**Files:**
- Modify: `supabase/migrations/20260811184614_remove_etsy_customization_inference.sql`
- Create: `tests/unit/etsy-customization-migration.test.js`

**Interfaces:**
- Consumes: `public.order_items.source_json jsonb` and the Amazon discriminator `source_json ->> 'marketplace' = 'amazon'`.
- Produces: historical non-Amazon source JSON without the top-level `customizationNeeded` key; Amazon JSON and all other keys remain intact.

- [ ] **Step 1: Add a failing migration-contract test**

Create `tests/unit/etsy-customization-migration.test.js`:

```js
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260811184614_remove_etsy_customization_inference.sql",
  import.meta.url,
);

describe("remove Etsy customization inference migration", () => {
  it("removes only the inferred non-Amazon customization flag", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/update\s+public\.order_items/i);
    expect(sql).toMatch(/source_json\s*=\s*source_json\s*-\s*'customizationNeeded'/i);
    expect(sql).toMatch(/source_json\s*->\s*'customizationNeeded'\s*=\s*'true'::jsonb/i);
    expect(sql).toMatch(/lower\s*\(\s*coalesce\s*\(\s*source_json\s*->>\s*'marketplace'\s*,\s*''\s*\)\s*\)\s*<>\s*'amazon'/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.order_items/i);
  });
});
```

- [ ] **Step 2: Run the migration-contract test and confirm it fails on the empty stub**

Run: `npx vitest run tests/unit/etsy-customization-migration.test.js`

Expected: FAIL because the generated migration is empty.

- [ ] **Step 3: Implement the narrow JSONB cleanup**

Write exactly this operation in `supabase/migrations/20260811184614_remove_etsy_customization_inference.sql`:

```sql
update public.order_items
set source_json = source_json - 'customizationNeeded'
where source_json -> 'customizationNeeded' = 'true'::jsonb
  and lower(coalesce(source_json ->> 'marketplace', '')) <> 'amazon';
```

- [ ] **Step 4: Run migration and focused unit verification**

Run: `npx vitest run tests/unit/etsy-customization-migration.test.js tests/unit/etsy-import-normalizer.test.js tests/unit/etsy-import-service.test.js`

Expected: PASS.

Run: `npm run test:db:local`

Expected: the local database resets through all checked-in migrations and all database tests pass. If the isolated local Supabase stack is not available, report that environment blocker rather than substituting a remote database.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`

Expected: PASS.

- [ ] **Step 6: Commit the historical cleanup**

```powershell
git add supabase/migrations/20260811184614_remove_etsy_customization_inference.sql tests/unit/etsy-customization-migration.test.js
git commit -m "fix: clear inferred Etsy review flags"
```

## Final Review

Review the complete diff against `docs/superpowers/specs/2026-08-11-remove-etsy-customization-inference-design.md`. Confirm that Etsy no longer emits the flag, Amazon behavior is untouched, the migration cannot delete records, the production migration was not applied, and verification evidence is recorded.
