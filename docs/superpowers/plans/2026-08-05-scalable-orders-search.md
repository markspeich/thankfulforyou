# Scalable Orders Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Orders search workspace-wide and reliable by moving substring matching and filters into PostgreSQL and returning at most 50 complete order groups through cursor pagination.

**Architecture:** Extend the existing compact-list/detail split with a migrated PostgreSQL pagination query, an opaque cursor API contract, and browser state that replaces or appends server-filtered pages. Keep mutations transactional and hydrate full order detail separately.

**Tech Stack:** Node.js 20+, vanilla JavaScript, Vercel Functions, Supabase/PostgreSQL, Vitest, Playwright.

## Global Constraints

- Preserve case-insensitive substring matching across order number, buyer, listing, transaction, color, and design text.
- Do not add fuzzy matching, PGroonga, a denormalized search projection, or maintenance triggers.
- Return at most 50 complete order groups and never split a multi-item order.
- Keep raw Amazon customization JSON, cached geometry, prior builds, and design lines out of compact responses.
- Scope every query to the authenticated workspace.
- Create the migration with `npx supabase migration new scalable_orders_search`; do not invent the filename.
- Apply and verify locally; do not apply to production project `oezjskcygvfyezvoulzw` without explicit user approval.

---

### Task 1: Define and test the pagination contract

**Files:**
- Modify: `src/orders-api.js`
- Modify: `api/orders.js`
- Test: `tests/unit/orders-api.test.js`
- Test: `tests/unit/orders-api-route.test.js`

**Interfaces:**
- Produces: `fetchWorkspaceOrderSummaries({ batchId, statusFilter, batchFilter, searchTerm, limit, cursor, accessToken, signal })`.
- Produces: compact response `{ orders, nextCursor, hasMore }`.
- Consumes: existing authenticated Orders route and `listWorkspaceOrderSummaries` store boundary.

- [ ] **Step 1: Add failing client URL and cancellation tests**

Add cases proving normalized parameters produce:

```js
/api/orders?batchId=batch-1&status=all&view=compact&batch=notInBatch&search=4118855809&limit=50&cursor=cursor-1
```

Assert `signal` is forwarded to `fetch`, empty optional values are omitted, and the returned response includes `nextCursor` and `hasMore`.

- [ ] **Step 2: Run the focused client test and confirm failure**

Run: `npx vitest run tests/unit/orders-api.test.js`

Expected: FAIL because the new parameters and signal are not supported.

- [ ] **Step 3: Implement the client contract minimally**

Extend `buildOrdersUrl` and `fetchWorkspaceOrderSummaries` without changing the detail endpoint. Preserve existing auth headers and response error handling.

- [ ] **Step 4: Add failing route validation tests**

Cover defaults and valid values plus HTTP 400 for malformed cursor, `limit=0`, `limit=51`, unknown status, and unknown batch filter. Assert the store receives:

```js
{
  workspaceId: "workspace-1",
  activeBatchId: "batch-1",
  statusFilter: "all",
  batchFilter: "notInBatch",
  searchTerm: "4118855809",
  limit: 50,
  cursor: decodedCursorOrNull,
}
```

- [ ] **Step 5: Run the focused route test and confirm failure**

Run: `npx vitest run tests/unit/orders-api-route.test.js`

Expected: FAIL on missing parsing/validation.

- [ ] **Step 6: Implement strict route parsing and opaque cursor helpers**

Create small route-local helpers that encode/decode versioned base64url JSON. Validate the cursor object contains only the expected version, sort key, and group id types. Return HTTP 400 without calling the store when invalid.

- [ ] **Step 7: Run both focused suites**

Run: `npx vitest run tests/unit/orders-api.test.js tests/unit/orders-api-route.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/orders-api.js api/orders.js tests/unit/orders-api.test.js tests/unit/orders-api-route.test.js
git commit -m "feat: define paginated orders query contract"
```

### Task 2: Create the database migration and paginated store query

**Files:**
- Create: `supabase/migrations/<generated>_scalable_orders_search.sql`
- Modify: `api/_lib/orders-store.js`
- Test: `tests/db/orders-store.db.test.js`
- Test: `tests/unit/orders-store.test.js`

**Interfaces:**
- Consumes: validated `workspaceId`, `activeBatchId`, `statusFilter`, `batchFilter`, `searchTerm`, `limit`, and decoded cursor.
- Produces: `listWorkspaceOrderSummaries(...) -> { orders, nextCursorValues, hasMore }` where cursor values contain the last returned group sort key and group id.

- [ ] **Step 1: Create the migration through the required CLI command**

Run from the repository root:

```powershell
npx supabase migration new scalable_orders_search
```

Expected: one new timestamped migration under `supabase/migrations/`. Stop and ask the user if the command is unavailable or fails.

- [ ] **Step 2: Add failing database fixtures and assertions**

Seed more than 1,000 items across open, complete, and skipped statuses, including multi-item orders and matches found only in buyer, listing id/title, transaction id, color, design text, and design-line text. Include numeric, nonnumeric, manual, and null order numbers. Assert:

```js
expect(page.orders).toHaveLength(50);
expect(page.hasMore).toBe(true);
expect(new Set(page.orders.map((order) => order.id)).size).toBe(50);
```

Also assert an old complete order equivalent to `4118855809` is found under `all` and `complete`, and no group is split at a cursor boundary.

- [ ] **Step 3: Run the focused database test and confirm failure**

Run: `npm run test:db:local -- tests/db/orders-store.db.test.js`

Expected: FAIL because pagination/search SQL is absent.

- [ ] **Step 4: Implement the migrated query**

Implement one focused `SECURITY INVOKER` SQL function or equivalent migrated database primitive that:

```sql
-- Required logical order:
-- 1. workspace predicate
-- 2. lifecycle and active-batch predicates
-- 3. EXISTS-based substring search across item/design/line fields
-- 4. group aggregation
-- 5. deterministic keyset cursor predicate
-- 6. ORDER BY stable sort key, group id
-- 7. LIMIT requested_limit + 1
```

Normalize with `lower(coalesce(value, '')) LIKE '%' || lower(search_term) || '%'`. Escape or bind the term as data; never interpolate SQL. Return compact columns only. Use the existing marketplace/listing-title representation without selecting raw customization diagnostics.

- [ ] **Step 5: Add only plan-supported indexes**

Start with indexes supporting workspace/status/order grouping, `designs.order_item_id`, `design_lines.design_id`, and active `batch_items` membership. Do not add trigram indexes. Record each index's target predicate/join in SQL comments.

- [ ] **Step 6: Adapt the store to the migrated primitive**

Map compact rows through existing normalization/grouping helpers where useful. Fetch 51 groups, discard the extra group, and return cursor values from the 50th group. Avoid `.in(...)` requests containing every workspace order id.

- [ ] **Step 7: Add unit-level store contract tests**

Mock the RPC/query boundary and verify parameter normalization, compact mapping, `hasMore`, and cursor extraction. Verify no design-line or cached-build query is issued by the compact path.

- [ ] **Step 8: Apply fresh local schema and run focused tests**

Run:

```powershell
npm run prepare:local
npm run test:db:local
npx vitest run tests/unit/orders-store.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add supabase/migrations api/_lib/orders-store.js tests/db/orders-store.db.test.js tests/unit/orders-store.test.js
git commit -m "feat: query paginated orders in postgres"
```

### Task 3: Connect API cursors to database results

**Files:**
- Modify: `api/orders.js`
- Test: `tests/unit/orders-api-route.test.js`

**Interfaces:**
- Consumes: Task 2 `{ orders, nextCursorValues, hasMore }`.
- Produces: public `{ orders, nextCursor, hasMore }` with no raw cursor tuple.

- [ ] **Step 1: Add a failing route serialization test**

Mock store output with 50 orders and `nextCursorValues`. Assert the response exposes an opaque `nextCursor`, does not expose `nextCursorValues`, and passing that cursor into the next request reproduces the decoded store cursor.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/unit/orders-api-route.test.js`

Expected: FAIL until serialization is connected.

- [ ] **Step 3: Implement response cursor encoding**

Encode only when `hasMore` is true. Return `nextCursor: null` otherwise. Keep timing diagnostics around the complete request.

- [ ] **Step 4: Run the route suite**

Run: `npx vitest run tests/unit/orders-api-route.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add api/orders.js tests/unit/orders-api-route.test.js
git commit -m "feat: serialize orders pagination cursors"
```

### Task 4: Implement browser query state, debounce, and stale-request protection

**Files:**
- Modify: `src/app.js`
- Modify: `src/orders-workspace.js`
- Test: `tests/unit/orders-workspace.test.js`
- Test: `tests/e2e/orders-workspace.spec.js`

**Interfaces:**
- Consumes: `fetchWorkspaceOrderSummaries` from Task 1.
- Produces: browser state `{ orders, nextCursor, hasMore, loadingMode, requestGeneration }` and `loadDatabaseOrders({ reset, append })` behavior.

- [ ] **Step 1: Add failing unit tests for page-state merging**

Extract or extend focused pure helpers to prove that reset replaces rows and clears stale checked ids, while append deduplicates by group id and preserves selected/checked ids already present.

- [ ] **Step 2: Run the unit test and confirm failure**

Run: `npx vitest run tests/unit/orders-workspace.test.js`

Expected: FAIL until paginated state helpers exist.

- [ ] **Step 3: Implement minimal page-state helpers**

Keep authoritative search/filter decisions server-side. Remove `filterGroupedOrders` from the normal rendering path; retain only narrowly documented transient reconciliation if mutations require it.

- [ ] **Step 4: Add failing browser tests for debounce and stale responses**

Intercept compact requests. Type two terms rapidly, resolve the second response first, then resolve the first response. Assert only the second result is rendered. Assert one request fires after approximately 250 ms of settled input and filter changes reset the cursor.

- [ ] **Step 5: Run the focused browser tests and confirm failure**

Resolve the worktree test URL first:

```powershell
node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl({ role: 'test' }))"
npm run test:e2e -- tests/e2e/orders-workspace.spec.js
```

Expected: FAIL on local-only filtering/stale request behavior.

- [ ] **Step 6: Implement debounced resets and request cancellation**

Use `AbortController` plus a generation counter. Search, lifecycle, and batch changes call a shared reset function. Aborted requests must not display errors; genuine failures must settle loading state and expose retry.

- [ ] **Step 7: Run focused unit and browser tests**

Run:

```powershell
npx vitest run tests/unit/orders-workspace.test.js
npm run test:e2e -- tests/e2e/orders-workspace.spec.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/app.js src/orders-workspace.js tests/unit/orders-workspace.test.js tests/e2e/orders-workspace.spec.js
git commit -m "feat: load server-filtered orders pages"
```

### Task 5: Add Load More and explicit list states

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Test: `tests/e2e/orders-workspace.spec.js`

**Interfaces:**
- Consumes: Task 4 `hasMore`, `nextCursor`, and loading mode.
- Produces: accessible `Load more`, retry, empty-search, empty-filter, and append-loading UI.

- [ ] **Step 1: Add failing end-to-end UI assertions**

Assert the first page renders 50 groups, `Load more` appends the next page without replacing rows, checked orders and selection persist, the button disappears at the end, and append failure offers retry without clearing existing rows.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:e2e -- tests/e2e/orders-workspace.spec.js`

Expected: FAIL because the controls/states do not exist.

- [ ] **Step 3: Add accessible markup and restrained workspace styling**

Add button/status elements near the list footer. Reuse shared command-button styling and existing pending/error visual language. Use `aria-live="polite"` for result/loading messages.

- [ ] **Step 4: Implement append and retry interactions**

Disable `Load more` only while appending. Preserve rows and scroll position. First-page failures show retry in the empty list; append failures show retry below existing rows.

- [ ] **Step 5: Run focused browser tests**

Run: `npm run test:e2e -- tests/e2e/orders-workspace.spec.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add index.html src/styles.css src/app.js tests/e2e/orders-workspace.spec.js
git commit -m "feat: add paginated orders list controls"
```

### Task 6: Preserve detail routes and mutation workflows

**Files:**
- Modify: `src/app.js`
- Modify: `tests/e2e/orders-workspace.spec.js`
- Modify: `tests/e2e/etsy-import.spec.js`
- Modify: `tests/e2e/amazon-import.spec.js`

**Interfaces:**
- Consumes: compact paginated rows and existing `fetchWorkspaceOrderDetail`.
- Produces: correct bookmark/detail hydration and mutation reconciliation under active server filters.

- [ ] **Step 1: Add failing regression cases**

Cover bookmarked order outside page one, rapid selection with out-of-order detail responses, checked additions across appended pages, skip/reopen removing or retaining rows according to active filters, and import/paste resetting to the first page.

- [ ] **Step 2: Run focused regressions and confirm failures**

Run:

```powershell
npm run test:e2e -- tests/e2e/orders-workspace.spec.js tests/e2e/etsy-import.spec.js tests/e2e/amazon-import.spec.js
```

Expected: FAIL where old full-list assumptions remain.

- [ ] **Step 3: Implement bounded detail and mutation reconciliation**

Fetch route-selected detail independently when absent from loaded pages. Guard detail responses with selection generation. After mutations, apply a compact delta only when its membership in the active query is known; otherwise reset the current list query. Never hydrate Production Batch designs from compact rows.

- [ ] **Step 4: Run focused regressions**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app.js tests/e2e/orders-workspace.spec.js tests/e2e/etsy-import.spec.js tests/e2e/amazon-import.spec.js
git commit -m "fix: preserve orders workflows across pagination"
```

### Task 7: Measure, document, and complete verification

**Files:**
- Modify: `docs/scalable-orders-restart-recommendations.md`
- Modify: `docs/requirements.md` if implementation discoveries refine an operator-visible requirement
- Create: `docs/performance/orders-search-query-plans.md`

**Interfaces:**
- Consumes: completed migrated query and browser workflow.
- Produces: recorded plans, verification evidence, and production migration handoff.

- [ ] **Step 1: Generate representative local data and record query plans**

Use `EXPLAIN (ANALYZE, BUFFERS)` for empty search, common short text, rare order number, and a deep cursor. Record dataset size, parameters, execution time, rows examined/returned, buffers, and chosen indexes in `docs/performance/orders-search-query-plans.md`.

- [ ] **Step 2: Remove unjustified indexes**

Compare plans before/after each new index. Remove any index that does not materially support a documented predicate, ordering, or join. Do not add trigram indexes in this task.

- [ ] **Step 3: Run Supabase checks**

Run:

```powershell
npx supabase --version
npm run supabase:status:local
npx supabase migration list --local
npx supabase db advisors --local
```

Expected: migration applied locally and no new relevant security/performance advisor findings. If the installed CLI lacks `db advisors`, record that and use the available project-supported alternative rather than guessing flags.

- [ ] **Step 4: Run all verification**

Run:

```powershell
npm run test:unit
npm run test:db:local
npm run test:e2e
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Update implementation status and migration handoff**

Mark completed items in `docs/scalable-orders-restart-recommendations.md`. Record the exact generated migration path, state that it is additive, and explicitly note that production project `oezjskcygvfyezvoulzw` has not been changed.

- [ ] **Step 6: Commit**

```powershell
git add docs/scalable-orders-restart-recommendations.md docs/performance/orders-search-query-plans.md docs/requirements.md
git commit -m "docs: record scalable orders search verification"
```

- [ ] **Step 7: Request production migration approval**

Report local verification and ask the user to authorize applying the exact migration to `oezjskcygvfyezvoulzw`. Do not deploy or apply it in the same step without that approval. After approval, apply it through the repository's production migration workflow, run `npm run db:prod:migrations:check`, and verify representative production queries and order `4118855809`.

