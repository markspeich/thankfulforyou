# Tag Batch in ShipStation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Identify current production batch orders in ShipStation for whole-order packing slip printing.
**Architecture:** Authenticated POST action in production-batch API loads saved membership and calls a focused reconciliation service. UI invokes the action after pending edits are saved, using existing operation feedback.
**Tech Stack:** JavaScript, Vercel API, ShipStation V2, Vitest, Playwright.
**Spec:** ../specs/2026-11-14-tag-production-batch-design.md

## Global Constraints
- Tag is `Current Production Batch`; preserve unrelated tags.
- Include whole batch, deduplicate orders, never guess ambiguous matches.
- No live external mutation during verification.

## Review Focus
- Etsy orders lack stored ShipStation IDs; exact order matching needs all stores.
- Multiple items or split shipments must not hide missing orders.
- Stale tags and partial failures must be visible before printing.
- Empty batches must not trigger destructive reconciliation.
- Authentication, working feedback, duplicate protection, focus, and unsaved edits remain intact.

### Task 1: Server reconciliation
- [x] Write and run failing service and route tests for matching, deduplication, tag reconciliation, partial errors, and authenticated batch ownership.
- [x] Extend client shipment enumeration as needed, implement focused service, wire POST `action: "tag-shipstation"` with `batchId`.
- [x] Return `{ tagName, taggedOrders, removedTags, unmatchedOrders, failures }`, arrays of readable order identifiers and sanitized errors.
- [x] Run service, route, and client tests.

### Task 2: Batch Output action
- [x] Write failing browser/API client coverage for the action and pending/success/failure outcomes.
- [x] Add button, authenticated API wrapper, and handler preserving edits and session-refresh behavior.
- [x] Show reconciliation counts, unmatched orders, failures, and printing instructions; restore focus.
- [x] Run focused browser and client tests.

### Task 3: Verification
- [x] Review changes against spec, update requirements and continuity, run unit tests and build.

## Verification and review

- Full unit suite: 109 files, 1,073 tests passed. Used a workspace TEMP/TMP path to avoid a pre-existing Windows sandbox temporary-URL import problem.
- Production-batch browser suite: 39 tests passed, including empty, working, success, unmatched/partial, failure, and focus behavior. ShipStation requests were mocked.
- Final server/client regression run after status-discovery correction: 152 tests passed across five files.
- Static build and git diff whitespace checks passed.
- Review correction: discover processing and label-purchased orders when current batch orders cannot be resolved from pending/already-tagged shipments; never newly tag cancelled shipments. Exact-ID-only batches can stop once their IDs are found. Number-only batches fully scan processing and label-purchased statuses to detect ambiguous order numbers. Extremely large fallback result sets can hit ShipStation pagination limits; discovery then fails before any tag changes.
- No production deployment or live ShipStation mutation performed; no migration required.

## Finish integration — November 14, 2026

- Integrated origin/main at bbe2db5 without conflicts on feat/tag-production-batch-shipstation.
- Merged-code unit suite: 1,080 tests passed; build and whitespace checks passed.
- Production migration history verified through connected Supabase tools: all 52 local versions match project oezjskcygvfyezvoulzw; none pending.
- Full browser run exposed one stale expectation introduced by main changing Order Items to Pieces to produce. Corrected the selector while retaining expected quantity total 4; no product behavior change required.
- Browser coverage after integration: 285 tests passed before the stale-selector failure; the corrected test passed and all 19 skipped tests passed on targeted rerun (all 305 test cases verified). Browser executable path was set to the installed host Playwright cache for this sandbox.
