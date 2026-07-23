# Skipped Orders Production Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators add skipped items to production, reopening them to `open`, while preventing stale batch rows from disabling eligible orders.

**Architecture:** Keep UI eligibility derived from normalized order data and enforce lifecycle changes in the existing transactional Postgres RPC. Treat only `active` batch rows as current membership and include `skipped` in group lookup and RPC eligibility.

**Tech Stack:** JavaScript, Vitest, Playwright, Supabase Postgres/PLpgSQL

## Global Constraints

- Update `docs/requirements.md` for the new workflow.
- Create the RPC migration with `npx supabase migration new`.
- Preserve `complete` when completed items are re-added.
- Reopen `skipped` items to `open` in the same transaction that adds them.

---

### Task 1: Correct Batch Membership Normalization

**Files:**
- Modify: `tests/unit/orders-store.test.js`
- Modify: `api/_lib/orders-store.js`

**Interfaces:**
- Consumes: `batch_items.status`
- Produces: `order.items[].isInActiveBatch: boolean`

- [ ] Add a unit fixture with a non-active, non-archived batch row and assert the corresponding complete item is not in the active batch.
- [ ] Run `npx vitest run tests/unit/orders-store.test.js` and confirm the assertion fails.
- [ ] Change active membership normalization to require `status === "active"`.
- [ ] Re-run the unit test and confirm it passes.

### Task 2: Add Skipped Items Transactionally

**Files:**
- Modify: `tests/unit/orders-store.test.js`
- Create: `supabase/migrations/<generated>_allow_skipped_items_in_production_batch.sql`
- Modify: `api/_lib/orders-store.js`

**Interfaces:**
- Consumes: `add_order_items_to_production_batch(uuid, uuid, uuid, text[])`
- Produces: added item ids, active batch memberships, and `skipped -> open` lifecycle transitions

- [ ] Update the RPC mock and unit assertions to require skipped items to be added and reopened.
- [ ] Add a group-add unit test proving skipped items are selected.
- [ ] Run the targeted unit tests and confirm they fail for the missing behavior.
- [ ] Create a migration with `npx supabase migration new allow_skipped_items_in_production_batch`.
- [ ] Replace the RPC with a version that accepts open, complete, and skipped items; updates eligible skipped rows to open; and upserts active memberships transactionally.
- [ ] Include skipped items in `queryOrderItemIdsForGroups`.
- [ ] Re-run the targeted unit tests and confirm they pass.

### Task 3: Enable Orders UI Actions

**Files:**
- Modify: `tests/e2e/orders-workspace.spec.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `item.id`, `item.isInActiveBatch`, `item.status`
- Produces: enabled item, selected-order, and checked-order batch-add controls

- [ ] Add a browser test with a skipped order under the `All` filter; assert its checkbox is enabled and the bulk add request is sent.
- [ ] Run the single Playwright test and confirm it fails because the checkbox is disabled.
- [ ] Remove skipped status from client-side batch ineligibility.
- [ ] Re-run the browser test and confirm it passes.

### Task 4: Requirements And Verification

**Files:**
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: approved lifecycle design
- Produces: durable workflow requirements

- [ ] Replace the skipped-ineligibility requirement with skipped-to-open production behavior.
- [ ] Update selected-order eligibility to include skipped items.
- [ ] Run `npm run test:unit`, `npm run test:e2e`, and `npm run build`.
- [ ] Review the diff for unrelated changes and migration safety.
