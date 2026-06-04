# Complete Production Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace archive-based batch closing with complete-batch order lifecycle behavior.

**Architecture:** Store order lifecycle in `order_items.status` as `open` or `complete`; use `batch_items` only as active batch membership. The browser warns about incomplete rows before calling a new complete-batch API action, then clears the active batch view from the returned empty snapshot.

**Tech Stack:** Vanilla browser JavaScript, Vercel API routes, Supabase Postgres access helpers, Vitest, Playwright.

---

### Task 1: Document Requirements

**Files:**
- Modify: `docs/requirements.md`
- Create: `docs/superpowers/specs/2026-06-04-complete-production-batch-design.md`

- [ ] Add requirements for `open` and `complete` order statuses, default Orders filtering, and `Complete Production Batch` replacing archive behavior.

### Task 2: Complete Batch Store And API

**Files:**
- Modify: `api/_lib/production-batch-store.js`
- Modify: `api/production-batch.js`
- Modify: `src/production-batch-api.js`
- Test: `tests/unit/production-batch-store.test.js`
- Test: `tests/unit/production-batch-api-route.test.js`
- Test: `tests/unit/production-batch-api.test.js`

- [ ] Write failing tests proving complete batch updates `order_items.status` to `complete`, deletes matching `batch_items`, and does not write `archived`.
- [ ] Implement `completeProductionBatch`.
- [ ] Rename client API helper from archive to complete while keeping single-item removal as batch membership deletion.

### Task 3: Orders Status Filtering

**Files:**
- Modify: `api/_lib/orders-store.js`
- Modify: `api/orders.js`
- Modify: `src/orders-api.js`
- Modify: `src/orders-workspace.js`
- Test: `tests/unit/orders-store.test.js`
- Test: `tests/unit/orders-api-route.test.js`
- Test: `tests/unit/orders-api.test.js`
- Test: `tests/unit/orders-workspace.test.js`

- [ ] Write failing tests for `status=open|complete|all` and client-side search/batch/status filtering.
- [ ] Implement status query handling and Orders workspace filtering helpers.

### Task 4: Browser UI

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/e2e/orders-workspace.spec.js`
- Test: `tests/e2e/preview-layout.spec.js`

- [ ] Rename the menu action and confirmation copy.
- [ ] Add incomplete-batch warning confirmation before completion.
- [ ] Add Orders search, status, and batch filters.
- [ ] Update e2e expectations from archive to complete-batch behavior.

### Task 5: Verify

**Commands:**
- `npx vitest tests/unit/production-batch-store.test.js tests/unit/production-batch-api-route.test.js tests/unit/production-batch-api.test.js tests/unit/orders-store.test.js tests/unit/orders-api-route.test.js tests/unit/orders-api.test.js tests/unit/orders-workspace.test.js`
- `npx playwright test tests/e2e/orders-workspace.spec.js tests/e2e/preview-layout.spec.js`
