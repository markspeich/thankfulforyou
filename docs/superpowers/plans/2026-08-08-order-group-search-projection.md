# Order-Group Search Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every empty-search Orders filter query page-bounded through a transactionally maintained compact order-group projection.

**Architecture:** Add one compact summary per workspace/order group plus one visibility row per workspace/batch/group combination, refresh both transactionally with deterministic group locks, and keyset page the applicable projection before hydration. Nonempty substring search remains source-table based.

**Tech Stack:** PostgreSQL/Supabase migrations and triggers, Node.js, Vitest database tests.

## Global Constraints

- Revise the existing unapplied migration `supabase/migrations/20260805172414_scalable_orders_search.sql`; do not apply it to `oezjskcygvfyezvoulzw`.
- Projection rows contain compact metadata only: no raw diagnostics, design lines, cached geometry, or prior builds.
- Every empty-search lifecycle and batch combination must page at `limit + 1` with bounded database work.
- Preserve group completeness, workspace isolation, opaque cursors, `SECURITY INVOKER`, and the existing nonempty substring branch.

---

### Task 1: Maintain compact order-group summaries

**Files:**
- Modify: `supabase/migrations/20260805172414_scalable_orders_search.sql`
- Test: `tests/db/orders-store.db.test.js`

**Interfaces:**
- Produces: `public.order_group_summaries` with `(workspace_id, group_id)` uniqueness, sort key, lifecycle status, and compact metadata.
- Produces: `public.order_group_batch_visibility` with `(workspace_id, batch_id, group_id)` uniqueness and explicit in-batch visibility.
- Produces: locked refresh functions and source-table triggers.

- [ ] **Step 1: Write failing database tests**

Seed an isolated multi-item group and two batches. Assert the summary initially reports `open`, becomes `complete` when each member completes, and each batch visibility row independently toggles as membership changes. Assert sort updates, deletion after its final member is removed, and concurrent member updates leave the final summary correct.

- [ ] **Step 2: Run RED**

Run `npm run test:db:local`; expect the projection relation or refresh behavior to be absent.

- [ ] **Step 3: Implement schema, refresh function, triggers, and backfill**

Create additive summary and visibility tables. Derive values from `order_items`, `production_batches`, and active `batch_items`; delete rows when their source group or batch disappears. Refresh functions take a deterministic advisory transaction lock per group before recomputing. Install `AFTER INSERT OR UPDATE OR DELETE` trigger functions that refresh old and new group keys as applicable, then backfill every existing group/batch pair.

- [ ] **Step 4: Run GREEN and commit**

Run `npm run test:db:local` and commit migration/tests as `feat: maintain order group search summaries`.

### Task 2: Page all empty-search filters from the projection

**Files:**
- Modify: `supabase/migrations/20260805172414_scalable_orders_search.sql`
- Test: `tests/db/orders-store.db.test.js`

**Interfaces:**
- Consumes: workspace id, lifecycle filter, batch filter, page limit, decoded cursor.
- Produces: at most `limit + 1` projection keys and compact hydration of just those complete groups.

- [ ] **Step 1: Write failing sparse-filter plan tests**

Seed thousands of newer nonmatching groups and two batches with opposite memberships. For each `complete`, `skipped`, `inBatch`, and `notInBatch` query assert correct result groups and JSON EXPLAIN shows the applicable summary or batch-visibility projection index scan, no pre-limit `order_items` scan, and at most `limit + 1` candidate rows.

- [ ] **Step 2: Run RED**

Run `npm run test:db:local`; expect the source-table fast path to scan sparse nonmatching history.

- [ ] **Step 3: Implement projection index and empty branch**

Create workspace/lifecycle/newest-first and workspace/batch/visibility/newest-first keyset indexes. Change only the empty-search CTE to filter and page `order_group_summaries` for `batch=all`, or `order_group_batch_visibility` for `inBatch` and `notInBatch`, before `limit + 1`; retain source hydration and leave nonempty substring search unchanged.

- [ ] **Step 4: Run GREEN and commit**

Run `npm run test:db:local` and commit migration/tests as `feat: page empty order filters from summaries`.

### Task 3: Measure and complete local verification

**Files:**
- Modify: `docs/performance/orders-search-query-plans.md`
- Modify: `docs/scalable-orders-restart-recommendations.md`

- [ ] **Step 1: Record local query plans**

Document dataset, parameters, timing, rows, buffers, and selected indexes for empty `all`, sparse `complete`, sparse `skipped`, sparse `inBatch`, sparse `notInBatch`, a common substring, rare order number, and deep cursor.

- [ ] **Step 2: Validate indexes**

Compare before/after plans for every projection index and remove any index not used for a documented predicate, ordering, or hydration join.

- [ ] **Step 3: Run checks**

Run `npx supabase --version`, `npm run supabase:status:local`, `npx supabase migration list --local`, `npx supabase db advisors --local`, `npm run test:unit`, `npm run test:db:local`, `npm run test:e2e`, `npm run build`, and `git diff --check`.

- [ ] **Step 4: Commit and hand off**

Commit documentation as `docs: record orders search projection verification`. Report `supabase/migrations/20260805172414_scalable_orders_search.sql` as additive and request explicit approval before production application.
