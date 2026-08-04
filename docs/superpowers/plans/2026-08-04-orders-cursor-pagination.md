# Orders Cursor Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Task 3's bounded whole-order cursor pagination and simple workspace-wide server search without changing browser pagination or Production Batch behavior.

**Architecture:** A CLI-created additive migration defines a security-invoker SQL RPC that selects at most 50 deterministic group keys, then returns every compact item for those groups. The existing compact store maps RPC rows to grouped summaries and the API validates an opaque cursor/search contract; legacy full-list, detail, and mutation paths stay unchanged.

**Tech Stack:** PostgreSQL 15+, Supabase CLI and local stack, Supabase JavaScript client, Node.js 20+, Vitest.

## Global Constraints

- Implement only Task 3; Task 4 remains `Not started`.
- Follow strict red-green-refactor: every behavior test must fail for the expected missing behavior before production code is written.
- Return at most 50 complete order groups per compact-list request.
- Use imported/manual rank, normalized order key, and stable group id as the complete cursor tuple.
- Search the entire workspace for order number, buyer, listing, transaction, color, and design text with no extensions, projections, or triggers.
- Preserve existing Orders detail/mutation contracts and every Production Batch behavior.
- Create the migration with `npx supabase migration new paginate_workspace_orders`; never invent its timestamped filename.
- Retain an index only when representative `EXPLAIN (ANALYZE, BUFFERS)` evidence demonstrates improvement.
- Verify the migration with `npm run prepare:local`; do not apply it to production.

---

### Task 1: Whole-group pagination database contract

**Files:**
- Modify: `tests/db/orders-store.db.test.js`
- Create via CLI: `supabase/migrations/*_paginate_workspace_orders.sql`

**Interfaces:**
- Consumes: existing `order_items`, `designs`, and `batch_items` tables.
- Produces: `public.list_workspace_order_summaries_page(p_workspace_id uuid, p_status text, p_search text, p_active_batch_id uuid, p_limit integer, p_after_group_rank integer, p_after_order_key text, p_after_group_id text)` returning compact item rows plus `group_rank`, `order_key`, `group_id`, and `has_more`.

- [ ] **Step 1: Add failing database tests for grouping and the page cap**

Add fixtures containing 51 imported groups, including one multi-item order straddling the item-row boundary. Call the wished-for RPC with `p_limit: 50` and assert exactly 50 distinct groups, every item from the multi-item group, and `has_more = true`.

- [ ] **Step 2: Run the focused database test and verify RED**

Run: `npm run test:db:local`

Expected: FAIL because `list_workspace_order_summaries_page` does not exist.

- [ ] **Step 3: Add failing boundary, manual, null, search, and traversal assertions**

In the same real-database suite, use literal fixtures to assert:

```js
expect(groupIds).toEqual(["order:A100", "order:a100", "item:manual-a"]);
expect(new Set(allTraversedGroupIds).size).toBe(allTraversedGroupIds.length);
expect(allTraversedGroupIds).toEqual(expectedGroupIds);
```

Cover equal normalized keys resolved by group id; two null-order-number items as independent stable groups; each required search field; a match beyond the first 50 groups; and repeated cursor calls producing no skips or duplicates.

- [ ] **Step 4: Discover the CLI migration command and create the migration file**

Run: `npx supabase migration new --help`

Run: `npx supabase migration new paginate_workspace_orders`

Expected: one new empty timestamped migration path printed by the CLI.

- [ ] **Step 5: Implement the minimal security-invoker RPC**

Implement a stable SQL function with:

```sql
language sql
stable
security invoker
set search_path = ''
```

Build eligible item rows inside `public.order_items` scoped by `p_workspace_id` and existing lifecycle rules; join `public.designs` only for compact design text/status and search. Derive imported groups as `order:<order_number>` and manual/null groups as `item:<id>`. Rank imported groups before manual groups, normalize imported order numbers with `lower(btrim(order_number))`, compare the complete `(group_rank, order_key, group_id)` tuple against the optional cursor, select `least(greatest(p_limit, 1), 50) + 1` group keys, and return all eligible compact items for the first `p_limit` groups with a page-level `has_more` flag.

Revoke default execution and grant only the role used by the server-side administrative client if required by the existing schema conventions.

- [ ] **Step 6: Run database tests and verify GREEN**

Run: `npm run test:db:local`

Expected: all focused grouping, cursor, manual/null, workspace-search, and traversal tests PASS.

---

### Task 2: Store and API cursor contract

**Files:**
- Modify: `tests/unit/orders-store.test.js`
- Modify: `tests/unit/orders-api-route.test.js`
- Modify: `api/_lib/orders-store.js`
- Modify: `api/orders.js`

**Interfaces:**
- Consumes: `list_workspace_order_summaries_page` RPC rows.
- Produces: `listWorkspaceOrderSummaries({ workspaceId, activeBatchId, statusFilter, search, cursor, limit }) -> { orders, nextCursor }` and compact `GET /api/orders?...&search=<text>&cursor=<opaque>`.

- [ ] **Step 1: Write failing store tests**

Assert that the compact store calls `.rpc("list_workspace_order_summaries_page", ...)` with trimmed search, a maximum limit of 50, and decoded cursor tuple values. Use literal RPC rows for a multi-item group and assert the existing compact item shape plus an opaque `nextCursor`. Add malformed-cursor coverage that rejects before calling Supabase.

- [ ] **Step 2: Run store tests and verify RED**

Run: `npx vitest run tests/unit/orders-store.test.js`

Expected: FAIL because the compact store still uses unbounded table reads and has no cursor contract.

- [ ] **Step 3: Implement minimal cursor helpers and RPC mapping**

Add server-only helpers that JSON/base64url encode and decode exactly:

```js
{ groupRank: 0, orderKey: "a100", groupId: "order:A100" }
```

Validate types and rank values, cap limit at 50, map returned compact rows through existing normalizers/grouping, and derive `nextCursor` from the last returned group's tuple only when `has_more` is true.

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `npx vitest run tests/unit/orders-store.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Assert compact GET forwards trimmed `search`, opaque `cursor`, and limit 50 to the store and returns `nextCursor`. Assert legacy/full and detail requests keep their current calls, and malformed cursor errors produce a safe 400 response without loading orders.

- [ ] **Step 6: Run route tests and verify RED**

Run: `npx vitest run tests/unit/orders-api-route.test.js`

Expected: FAIL because the route does not forward pagination/search inputs.

- [ ] **Step 7: Implement minimal compact-route parameter handling**

Read only `search` and `cursor` for `view=compact`, pass a fixed `limit: 50`, preserve existing status and batch parsing, and translate cursor validation errors to HTTP 400. Do not modify POST handlers, full-list calls, or detail calls.

- [ ] **Step 8: Run focused unit tests and verify GREEN**

Run: `npx vitest run tests/unit/orders-store.test.js tests/unit/orders-api-route.test.js`

Expected: PASS.

---

### Task 3: Representative plans and evidence-supported indexes

**Files:**
- Modify only if supported: `supabase/migrations/*_paginate_workspace_orders.sql`
- Create: `docs/performance/orders-cursor-pagination-explain.md`

**Interfaces:**
- Consumes: the Task 1 RPC and representative local fixtures.
- Produces: reproducible first-page, deep-page, and search `EXPLAIN (ANALYZE, BUFFERS)` evidence; migration indexes only when supported.

- [ ] **Step 1: Prepare a representative local database**

Run: `npm run prepare:local`

Insert deterministic large local-only fixtures from the focused database test setup, then run `analyze public.order_items; analyze public.designs; analyze public.batch_items;`.

- [ ] **Step 2: Capture baseline plans**

Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` for empty-search first page, an empty-search deep cursor, one common design-text search, one rare order/customer search, the designs join, and active-batch membership lookup. Record exact SQL, row counts, scan types, buffers, planning time, and execution time.

- [ ] **Step 3: Test candidate indexes one at a time**

Candidate shapes may cover workspace plus normalized group ordering, `designs(workspace_id, order_item_id)`, or `batch_items(workspace_id, batch_id, order_item_id)`, but create each only in the local database first. Re-run identical plans and retain a candidate in the CLI-created migration only if it reduces representative work or enables the intended bounded index path. Drop unsupported candidates locally.

- [ ] **Step 4: Record evidence and re-run fresh migration tests**

Write before/after evidence and the retain/remove decision for every candidate to `docs/performance/orders-cursor-pagination-explain.md`.

Run: `npm run prepare:local`

Run: `npm run test:db:local`

Expected: fresh migration application and focused database tests PASS.

---

### Task 4: Task 3 regression verification and status

**Files:**
- Modify: `docs/scalable-orders-restart-recommendations.md`
- Modify: `docs/superpowers/plans/2026-08-04-orders-cursor-pagination.md`

**Interfaces:**
- Consumes: all Task 3 changes.
- Produces: verified Task 3 implementation marked `In review`; Task 4 remains untouched.

- [ ] **Step 1: Run database and unit verification**

Run: `npm run test:db:local`

Run: `npm run test:unit`

Expected: PASS with no new warnings or failures.

- [ ] **Step 2: Run focused Orders browser regression and build**

Resolve the worktree URL with `node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl())"`, then run `npm run test:e2e -- tests/e2e/orders-workspace.spec.js` and `npm run build`. The safe e2e runner assigns the adjacent test-role port.

Expected: existing Orders and Production Batch interactions remain green and the production build succeeds.

- [ ] **Step 3: Review the diff against non-goals**

Confirm no Task 4 incremental-loading UI, no browser pagination state, no Production Batch behavior changes, no geometry hydration in compact rows, no unbounded empty-search item read, no unsupported indexes, and no production commands.

- [ ] **Step 4: Mark Task 3 in review and commit**

Change only Task 3 status from `In progress` to `In review`; keep Task 4 `Not started`. Check off completed plan steps, stage the scoped changes, and commit with `feat: add orders cursor pagination`.

- [ ] **Step 5: Report migration handoff**

Report the exact migration path, state that it is additive, summarize local verification and EXPLAIN evidence, name production ref `oezjskcygvfyezvoulzw`, and explicitly state that production was not changed and requires separate approval.

## Execution notes

- Database RED confirmed with `PGRST202` before the RPC migration existed.
- Search/traversal RED confirmed while `p_search` was intentionally unimplemented.
- Store RED confirmed before the compact store called the RPC.
- Route RED confirmed before search, cursor, and the fixed limit were forwarded.
- Fresh `npm run prepare:local` applied migration `20260804121938` successfully.
- All new Orders database tests pass; the full DB command retains an unrelated pre-existing Production Batch failure, and one run also encountered a local Amazon Auth 502.
- `npm run test:unit`: 673 passed.
- Focused Orders Playwright: 35 passed.
- `npm run build`: passed.
- Local migration history includes `20260804121938`; `supabase db lint` reported no public-schema errors.
- Task 3 is `Complete`; Task 4 remains `Not started`.
