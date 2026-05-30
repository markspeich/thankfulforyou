# Supabase Batch Storage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production data out of browser/local JSON snapshots and into relational Supabase Postgres tables for production batches, order items, designs, presets, and size guides.

**Architecture:** Keep the current browser snapshot contract temporarily while replacing the server-side source of truth with normalized Supabase tables. The app will stop reading/writing production data from `localStorage`; all batch/order/design/preset/size-guide data comes from authenticated Supabase routes.

**Tech Stack:** Supabase Auth, Supabase Postgres, Supabase JS admin client, Vercel API routes, Vitest, Playwright.

---

### Task 1: Requirements And Migration Skeleton

**Files:**
- Modify: `docs/requirements.md`
- Create: `supabase/migrations/20260530152826_production_batch_storage.sql`

- [ ] **Step 1: Update requirements**

Record that production data uses Supabase Postgres only; browser local storage is not a production-data source of truth. Rename queue concepts to production batches, and introduce `order_items`, `batch_items`, `designs`, and `design_lines`.

- [ ] **Step 2: Add migration**

Create relational tables:

```sql
production_batches
batch_items
order_items
designs
design_lines
design_analysis_cache
size_guides
presets
preset_line_rules
preset_listing_assignments
```

Enable RLS on all public tables and grant explicit authenticated/service-role access.

### Task 2: Batch Snapshot Store

**Files:**
- Create: `api/_lib/production-batch-store.js`
- Create: `tests/unit/production-batch-store.test.js`
- Modify: `api/_lib/shared-queue-store.js`

- [ ] **Step 1: Write failing mapper tests**

Test that a legacy snapshot order becomes:

```js
{
  orderItem: { id, workspace_id, order_number, buyer_name, listing_id, transaction_id, imported_color, quantity, source_json },
  design: { order_item_id, design_text, preset_id, size_guide_id, backing_border_mm },
  designLines: [{ line_index, text, font_id, letter_bridge_mm }]
}
```

- [ ] **Step 2: Implement mappers**

Implement pure mappers between current snapshot orders and relational rows. Keep `order.id` as the `order_items.id` compatibility id during this migration.

- [ ] **Step 3: Implement Supabase reads/writes**

Load a production batch by reading `production_batches`, `batch_items`, `order_items`, `designs`, and `design_lines`, then compose the current API snapshot shape. Save by upserting the same table set inside the API store layer.

### Task 3: Presets And Size Guides From Supabase

**Files:**
- Create: `api/_lib/preset-relational-store.js`
- Modify: `api/preset-snapshot.js`
- Modify: `src/presets.js`
- Modify: `tests/unit/presets.test.js`
- Modify: `tests/unit/preset-snapshot-api.test.js`

- [ ] **Step 1: Write failing tests**

Tests should prove `loadPresetRegistry()` fetches remote presets before bundled defaults and does not call `localStorage.getItem` or `localStorage.setItem` for presets or size guides.

- [ ] **Step 2: Implement relational preset snapshot route**

Keep `/api/preset-snapshot` returning the current snapshot shape while storing data in `presets`, `preset_line_rules`, `preset_listing_assignments`, and `size_guides`.

- [ ] **Step 3: Remove local preset persistence**

Delete `readPersistedPresetSnapshot()` and `persistPresetSnapshot()` behavior. Local preset edits remain in memory until the API save succeeds or reports an error.

### Task 4: Remove Browser Local Storage For Production Data

**Files:**
- Modify: `src/app.js`
- Modify: `src/queue-sync.js`
- Modify: `src/queue-sync-status.js`
- Modify: affected Playwright tests

- [ ] **Step 1: Remove design batch local cache**

`persistQueueState()` should no longer call `localStorage`. It should keep in-memory state and trigger authenticated remote saves when appropriate.

- [ ] **Step 2: Remove local startup recovery**

`restoreInitialQueueState()` should use remote batch data only. If Supabase is unavailable, show a blocked or unavailable state rather than loading stale browser data.

- [ ] **Step 3: Keep non-production preferences separate**

If nav-collapse preference remains, isolate it from production storage and document it as a UI preference only. If "no local storage" remains absolute, remove that preference too.

### Task 5: Verification

**Files:**
- Modify tests as needed.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm run test:unit -- tests/unit/production-batch-store.test.js tests/unit/presets.test.js tests/unit/preset-snapshot-api.test.js tests/unit/shared-queue-api-route.test.js
```

- [ ] **Step 2: Run focused E2E tests**

Run:

```bash
npx playwright test tests/e2e/shared-queue-auth.spec.js tests/e2e/shared-queue-sync.spec.js
```

- [ ] **Step 3: Run full verification if focused tests pass**

Run:

```bash
npm test
```
