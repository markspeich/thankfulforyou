# Scalable Orders Query Restart Recommendations

## Purpose

Restart the Orders query performance work with a deliberately smaller first release. The initial implementation should address unbounded list responses without introducing a search projection, database-maintenance triggers, or new Production Batch synchronization behavior.

## 3. Limit the first implementation

Implement only these changes:

- Return at most 50 complete order groups per request using cursor-based pagination.
- Keep every multi-item order together; never split an order group across pages.
- Use one deterministic ordering and cursor contract for every page. The cursor must include the normalized order sort key and stable group id as a final tie-breaker, with explicit handling for manual orders and null order numbers.
- Return compact list data without design lines, cached builds, previous builds, or export geometry.
- Load the selected order's complete design and design lines through a separate, bounded detail request.
- Add only indexes that support a concrete list filter, ordering, join, or foreign-key operation and that improve representative query plans.
- Add a visible `Load more` action or equivalent incremental-loading control.
- Reset pagination when search or lifecycle status changes.
- Preserve checked orders and the selected order when another page is appended.
- Load bookmarked orders outside the first page directly through the bounded detail request.
- Fall back to `/orders` when a bookmarked order no longer exists.
- Prevent stale detail responses from replacing a newer browser selection.

The first implementation is successful when empty-search list response size and query work remain page-bounded as historical order count grows, selected-order editing still receives complete data, browser selection and bookmark behavior remain correct, and existing order and batch workflows continue to work. Non-empty search performance has a separate acceptance criterion in the next section.

## 4. Defer search optimization

Move search filtering to the database when pagination is introduced so a search covers the entire workspace rather than only the pages currently loaded in the browser. Use the simplest query that preserves the existing matching behavior for order number, buyer, listing, transaction, color, and design text, even if that query remains slower than ordinary empty-search list loading.

Do not add PGroonga, a denormalized search projection, search-maintenance triggers, or custom concurrency controls in this phase. Correct workspace-wide results are required; specialized search optimization is deferred.

Measure search separately after bounded list loading is deployed. Capture representative production query timings and plans for:

- Empty search.
- Common short terms such as credentials.
- Rare order numbers or customer names.
- Deep result pages.

The first release should record representative non-empty search latency and plans but should not claim that search work is page-bounded. Treat search optimization as a separate project only when measurements show that it is a material operator problem. Its design should have its own requirements, migration, concurrency review, and rollout plan.

## 5. Isolate Production Batch behavior

Do not change Production Batch draft detection, autosave, analysis coordination, or authoritative refresh behavior as part of the first Orders pagination release.

Order-to-batch mutations should remain transactional server mutations. Never construct a Production Batch design locally from a compact order-list record.

For individual and bulk additions involving compact or unhydrated orders:

- Persist any pending Production Batch edits successfully before starting the mutation or authoritative refresh.
- Abort the mutation and refresh if those edits cannot be saved.
- Perform the batch-membership mutation transactionally on the server.
- Reload the authoritative Production Batch snapshot after the mutation so every added item has its complete design data.
- Preserve the existing selected order and draft state when the authoritative response is applied.

Loading one selected order's detail is sufficient only for operations on that selected order. Bulk checked-order additions must not assume that every checked order has already been hydrated.

Any required Production Batch behavior change should be handled as a separate task with focused regression coverage for:

- Unsaved edits on persisted designs.
- Pending geometry analysis.
- Autosave failures.
- Bulk additions and clipboard imports.
- Skip and reopen operations.
- Failed pre-refresh saves that must prevent the mutation from proceeding.

## 6. Use a staged migration and review process

Develop and validate the database migration locally first. The migration should be additive and limited to the pagination query and directly supporting indexes. Every new index must map to a documented query predicate, ordering, join, or foreign-key operation; retain it only when representative `EXPLAIN` evidence demonstrates value.

Before production deployment:

1. Apply the migration to a fresh local Supabase database.
2. Run focused database tests for whole-group pagination, cursor boundaries, compact payloads, and complete selected-order detail.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` against representative large local fixtures for empty-search first and deep pages, then record non-empty search plans separately without requiring them to be page-bounded in this release.
4. Run unit tests, the Orders browser tests, and the production build.
5. Review the final diff specifically for unbounded empty-search queries, accidental geometry hydration, cursor ordering mismatches, stale browser-route races, and Production Batch coupling.
6. Present the exact migration path and verification evidence for approval.
7. Apply the migration to production project `oezjskcygvfyezvoulzw` only after explicit approval.
8. Verify production migration history and representative query plans after deployment.

## Implementation order and status

Use these status values while implementing the recommendations:

- `Not started`: no implementation work has begun.
- `In progress`: implementation or focused verification is underway.
- `Blocked`: work cannot continue until a named issue or decision is resolved.
- `In review`: implementation is complete and awaiting review or verification.
- `Complete`: acceptance criteria passed and the task was committed.

Update the status in this document whenever a task changes state. Complete and review one task before beginning the next task unless a documented dependency requires otherwise.

### Task 1: Add compact-list and full-detail API contracts

**Status:** `Complete`

Add new read contracts without switching the browser to them yet:

- A compact Orders list response containing only metadata required to render and search the list, including a scalar design-text summary.
- A bounded detail response containing the selected order's complete designs, design lines, cached builds, and editor data.
- Existing API behavior remains available until the browser migration is complete.

**Complete when:** focused API and store tests prove compact responses exclude large geometry fields, detail responses remain complete, missing order ids are handled safely, and no existing browser workflow has changed.

### Task 2: Adopt compact list and detail hydration in the Orders browser

**Status:** `Not started`

Switch the Orders workspace to the new contracts while still loading all order groups:

- Render rows from compact records.
- Hydrate full detail when an order is selected or opened from a bookmark.
- Prevent stale detail responses from replacing a newer selection.
- Preserve existing search results using compact searchable fields.
- Keep individual and bulk Production Batch actions authoritative; never construct batch designs from compact records.
- Persist pending batch edits before any authoritative batch refresh and abort safely when that save fails.

**Complete when:** selected-order editing is functionally unchanged, list payload size is materially smaller, bookmarks and rapid selection changes are correct, bulk batch additions contain complete designs, and focused browser tests pass.

### Task 3: Add cursor pagination and simple server-side search

**Status:** `Not started`

Add the database and API paging behavior without specialized search infrastructure:

- Return at most 50 complete order groups per page.
- Use one deterministic cursor based on normalized order sort key and stable group id.
- Preserve manual-order and null-order-number behavior.
- Move search filtering to the database so results cover the entire workspace.
- Keep search as a simple query; do not add extensions, projections, or maintenance triggers.
- Add only plan-supported pagination, join, ordering, and foreign-key indexes.

**Complete when:** database tests prove no group splits, cursor pages have no skips or duplicates, server search is workspace-wide and correct, empty-search first and deep pages are bounded, and a fresh local migration succeeds.

### Task 4: Add incremental browser loading

**Status:** `Not started`

Connect the Orders workspace to the paginated API:

- Load the first page on workspace entry.
- Append subsequent pages through `Load more`.
- Reset pagination after search or lifecycle-status changes.
- Preserve checked and selected orders while appending.
- Load bookmarked orders outside the current pages through the detail endpoint.
- Keep the URL, selected editor, and latest asynchronous request synchronized.

**Complete when:** browser tests cover append, reset, bookmark, missing-order, search, selection-race, and checked-order behavior without regressing Production Batch actions.

### Task 5: Verify and review the complete local implementation

**Status:** `Not started`

Run the full pre-deployment verification sequence:

- Fresh local Supabase reset and migration application.
- Focused pagination and selected-detail database tests.
- Representative `EXPLAIN (ANALYZE, BUFFERS)` evidence.
- Unit tests, Orders browser tests, and production build.
- Review for unbounded empty-search work, geometry leakage, cursor mismatches, browser races, unnecessary indexes, and Production Batch coupling.

**Complete when:** all relevant checks pass, every retained index has plan evidence, the exact migration path is documented, and no unresolved high-risk review findings remain.

### Task 6: Apply and verify the production migration

**Status:** `Not started`

This task requires separate explicit approval:

- Apply the reviewed additive migration to production project `oezjskcygvfyezvoulzw`.
- Verify production migration history.
- Confirm representative production list and search query plans.
- Monitor response sizes, latency, and errors after deployment.

**Complete when:** production schema verification and post-deployment checks pass. Do not start this task without explicit approval.

## Explicit non-goals for the first release

- Search projections or search-maintenance triggers.
- PGroonga or another new search extension.
- Production Batch autosave or draft-state changes.
- Order archival, deletion, or table partitioning.
- Applying any database migration to production without a separate approval step.
