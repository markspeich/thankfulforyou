# Scalable Orders Search Design

## Problem

The Orders workspace currently loads every order allowed by the lifecycle filter and applies search in the browser. This makes search incomplete whenever the bulk request is truncated, times out, or otherwise fails. It also makes the `All` filter increasingly expensive as historical orders accumulate. Production order `4118855809` demonstrated the failure: the row exists in `Primary Workspace` with status `complete`, but the browser had no complete dataset to search.

## Decision

Move Orders search and filtering into PostgreSQL and return compact order groups through cursor pagination. Preserve the current case-insensitive substring semantics across order number, buyer, listing, transaction, color, and design text. Do not add fuzzy matching, PGroonga, a denormalized search projection, or search-maintenance triggers in this release.

## API Contract

`GET /api/orders?view=compact` accepts:

- `status`: `open`, `complete`, `skipped`, or `all`; default `open`.
- `batch`: `all`, `inBatch`, or `notInBatch`; default `all`.
- `search`: a trimmed case-insensitive substring; empty means no search predicate.
- `limit`: an integer from 1 through 50; default and maximum 50.
- `cursor`: an opaque cursor issued by the preceding response.

The response is:

```json
{
  "orders": [],
  "nextCursor": null,
  "hasMore": false
}
```

Invalid enum values, malformed cursors, and out-of-range limits receive HTTP 400. Cursors encode a version, normalized order sort key, and stable group id. Cursor decoding validates shape and types before querying.

## Query and Ordering

The database query scopes every operation to the authenticated workspace before applying other predicates. It filters lifecycle status and active-batch membership on the server, and searches all required fields with case-insensitive substring semantics. Search matches in any item cause the complete order group to be returned.

Pagination operates on groups, not order-item rows. A multi-item order must never be split across pages. Results use one deterministic newest-first ordering for every filter combination. The normalized order sort key explicitly handles imported numeric order numbers, nonnumeric order numbers, manual orders, and nulls; the stable group id is the final unique tie-breaker. The query requests 51 groups, returns 50, and derives `hasMore` and `nextCursor` from the extra group.

The compact response excludes design lines, cached builds, previous builds, export geometry, and raw Amazon customization diagnostics. Selecting an order continues to use the bounded detail endpoint to load its complete design and lines. A bookmarked order outside loaded pages is fetched directly through that endpoint.

## Browser Behavior

Search input is debounced by 250 milliseconds. Changing search, status, or batch filter resets pagination and issues a fresh first-page request. A request generation counter and `AbortController` prevent stale responses from replacing newer results.

The first-page loading state replaces the list with a practical loading message. Loading another page preserves existing rows and displays a working state on a visible `Load more` button. Appending pages preserves checked orders, the current selection, and scroll position. The button disappears when `hasMore` is false.

The workspace distinguishes:

- no orders exist for the selected filters;
- no orders match the entered search;
- a request failed and can be retried;
- another page is loading.

The browser no longer performs authoritative lifecycle, batch, or search filtering over the loaded array. Local filtering may remain only for transient mutation reconciliation and must not determine workspace-wide search results.

## Mutation Compatibility

Order-to-batch, skip, reopen, paste, and import mutations remain transactional server operations. Compact list rows must never be treated as complete Production Batch designs. Bulk actions operate only on explicitly checked group ids, and checked ids survive page appends.

After a mutation, the browser either applies a compact delta that is valid for the active query or reloads the first page. If a changed row no longer satisfies the active filter, it is removed. Production Batch state is refreshed only where existing correctness rules require it.

## Database and Security

Implementation uses a checked-in Supabase migration created with `npx supabase migration new <name>`. The migration may add a focused SQL function and supporting indexes. The function must use `SECURITY INVOKER` unless a reviewed need proves otherwise. It must not expose service-role credentials or relax existing RLS/access boundaries.

Initial indexes support workspace scoping, lifecycle predicates, deterministic ordering, joins to designs/design lines, and active-batch membership. Every index must correspond to a documented query operation and remain only if representative `EXPLAIN (ANALYZE, BUFFERS)` evidence shows benefit. General `%term%` search may scan the filtered workspace in this first release. Trigram indexes and a maintained search projection are deferred unless measured latency warrants a separate design.

## Performance and Observability

Empty-search requests must have page-bounded response size and query work as history grows. Nonempty search must cover the entire workspace and return a bounded response; its database work is measured separately. Existing server timing and slow-request diagnostics remain active.

Record representative plans and timings for empty search, a common short term, a rare order number, and a deep cursor. Do not claim an index improves the query without comparing plans.

## Verification

Automated coverage must include:

- more than 1,000 order items and a match outside the first 1,000;
- order `4118855809`-equivalent data found with `All` and `Complete`;
- every supported search field and case-insensitive substring behavior;
- all lifecycle and batch-filter combinations;
- multi-item groups kept intact at page boundaries;
- duplicate, nonnumeric, manual, and null order sort keys;
- invalid cursors and limits;
- workspace isolation and exclusion of diagnostic/geometry fields;
- stale search responses ignored;
- selection and checked ids preserved during append;
- bookmarked detail outside the loaded page;
- batch-add, skip, reopen, paste, and import regressions.

Run focused unit tests, local database tests, Orders end-to-end tests, the full unit suite, the full end-to-end suite, and the production build. Apply the migration to a fresh local database through `npm run prepare:local`. Production project `oezjskcygvfyezvoulzw` requires separate approval before migration application, followed by migration-history and representative-query verification.

## Acceptance Criteria

- Search results are workspace-wide rather than limited to browser-loaded records.
- Order `4118855809` is returned under `All` and `Complete` when searched by number.
- Each response contains no more than 50 complete order groups.
- Empty-search list loading remains page-bounded as order history grows.
- No stale response can overwrite newer filters.
- Existing Orders and Production Batch mutations remain correct.
- No fuzzy-search or search-projection maintenance system is introduced.

