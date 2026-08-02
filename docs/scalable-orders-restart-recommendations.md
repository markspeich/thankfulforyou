# Scalable Orders Query Restart Recommendations

## Purpose

Restart the Orders query performance work with a deliberately smaller first release. The initial implementation should address unbounded list responses without introducing a search projection, database-maintenance triggers, or new Production Batch synchronization behavior.

## 3. Limit the first implementation

Implement only these changes:

- Return at most 50 complete order groups per request using cursor-based pagination.
- Keep every multi-item order together; never split an order group across pages.
- Return compact list data without design lines, cached builds, previous builds, or export geometry.
- Load the selected order's complete design and design lines through a separate, bounded detail request.
- Add straightforward indexes that match the list filters, ordering, joins, and foreign keys.
- Add a visible `Load more` action or equivalent incremental-loading control.

The first implementation is successful when list response size and database work remain bounded as historical order count grows, selected-order editing still receives complete data, and existing order and batch workflows continue to work.

## 4. Defer search optimization

Retain the existing server-side search behavior for the first release, even if search remains slower than normal list loading. Do not add PGroonga, a denormalized search projection, search-maintenance triggers, or custom concurrency controls in this phase.

Measure search separately after bounded list loading is deployed. Capture representative production query timings and plans for:

- Empty search.
- Common short terms such as credentials.
- Rare order numbers or customer names.
- Deep result pages.

Treat search optimization as a separate project only when measurements show that it is a material operator problem. Its design should have its own requirements, migration, concurrency review, and rollout plan.

## 5. Isolate Production Batch behavior

Do not change Production Batch draft detection, autosave, analysis coordination, or authoritative refresh behavior as part of the first Orders pagination release.

Order-to-batch mutations should continue using the existing authoritative batch workflow. If compact list records lack the full design data required by a batch operation, the operation must load the selected order detail or reload the authoritative batch snapshot rather than constructing a partial batch design locally.

Any required Production Batch behavior change should be handled as a separate task with focused regression coverage for:

- Unsaved edits on persisted designs.
- Pending geometry analysis.
- Autosave failures.
- Bulk additions and clipboard imports.
- Skip and reopen operations.

## 6. Use a staged migration and review process

Develop and validate the database migration locally first. The migration should be additive and limited to the pagination query and directly supporting indexes.

Before production deployment:

1. Apply the migration to a fresh local Supabase database.
2. Run focused database tests for whole-group pagination, cursor boundaries, compact payloads, and complete selected-order detail.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` against representative large local fixtures.
4. Run unit tests, the Orders browser tests, and the production build.
5. Review the final diff specifically for unbounded queries, accidental geometry hydration, and Production Batch coupling.
6. Present the exact migration path and verification evidence for approval.
7. Apply the migration to production project `oezjskcygvfyezvoulzw` only after explicit approval.
8. Verify production migration history and representative query plans after deployment.

## Explicit non-goals for the first release

- Search projections or search-maintenance triggers.
- PGroonga or another new search extension.
- Production Batch autosave or draft-state changes.
- Order archival, deletion, or table partitioning.
- Applying any database migration to production without a separate approval step.
