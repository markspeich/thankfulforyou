# Order-Group Search Projection Design

## Goal

Make every empty-search Orders query page-bounded, including sparse lifecycle and active-batch filters, while preserving workspace-wide substring search for nonempty terms.

## Decision

Add a maintained `order_group_summaries` projection with one row per workspace/order group. A group is `order:<order_number>` when an order number exists, otherwise `item:<order_item_id>`.

The projection stores only compact-list metadata: workspace and group identity, deterministic newest-first key, lifecycle aggregate, active-batch membership, compact display metadata, and an updated timestamp. It does not store design lines, cached geometry, prior builds, or raw customization diagnostics.

Database triggers transactionally refresh the affected group after changes to `order_items`, `designs`, `batch_items`, or production-batch membership state. The refresh derives its state from source tables, so the projection remains a query optimization rather than a second editable source of truth.

## Query Behavior

For an empty search term, `list_workspace_order_summaries` reads the projection through a workspace/filter/newest-first keyset index and requests `limit + 1` groups. It hydrates only those selected groups from source tables, preserving complete multi-item groups.

For a nonempty term, the existing source-table substring branch remains authoritative and workspace-wide. It retains literal LIKE escaping and both listing-title representations. Compact selection and detail hydration contracts remain unchanged.

## Consistency and Security

Projection maintenance occurs in the same transaction as source mutations. The lookup function remains `SECURITY INVOKER`; no service credentials, RLS relaxation, or browser access to the projection is introduced.

The migration is additive. It creates the projection, supporting indexes, refresh routine, triggers, and an initial backfill. Existing mutations continue using their normal transactional routes.

## Verification

Database tests cover create/update/delete and batch/lifecycle mutations, group completeness, workspace isolation, and sparse `complete`, `skipped`, `inBatch`, and `notInBatch` filters. EXPLAIN evidence must demonstrate keyset scans bounded at `limit + 1` for every empty-search filter path. Browser and import regressions remain covered by the existing Task 6 suite.

## Superseded Constraint

The previous scalable-search design deferred maintained search projections. That constraint is superseded for compact empty-search group metadata only, because measurement showed it is required to meet the explicit page-bounded query-work acceptance criterion for sparse filters.
