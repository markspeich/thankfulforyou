# Orders Cursor Pagination Design

## Scope

Implement Task 3 from `docs/scalable-orders-restart-recommendations.md` only. Add bounded, cursor-based compact Orders list reads and simple server-side search. Preserve the existing full-detail contract, Orders mutations, and all Production Batch behavior. Do not add Task 4 browser loading behavior, specialized search infrastructure, or production deployment work.

## Database contract

Add one additive SQL function through a Supabase CLI-created migration. The function is security-invoker and accepts workspace id, lifecycle status, search text, active batch id, page size, and an optional cursor boundary. It returns compact order-item rows for no more than 50 complete order groups plus the boundary values needed to construct the next cursor.

An imported order is grouped by its non-empty `order_number`. An item with a null or empty order number is a manual group identified by that item's stable id. The deterministic ordering tuple is:

1. imported-order rank before manual/null-order rank;
2. normalized order number for imported orders, or an empty normalized value for manual orders;
3. stable group id as the final tie-breaker.

The cursor represents that complete tuple. The next page uses a strict row-wise greater-than boundary, so equal normalized order keys cannot skip or repeat groups.

The query first identifies matching group ids, orders and limits those groups, and then returns every compact item in the selected groups. Search is case-insensitive and workspace-wide across order number, buyer, listing, transaction, imported color, and design text. It remains a direct query over existing tables: no extensions, projections, triggers, or search-maintenance state.

Lifecycle filtering preserves the existing Orders contract. The database query applies the requested item status rules consistently before deriving eligible groups, and all eligible items for a selected group remain together on one page.

## API and store contract

The compact list store method calls the new database function and continues to normalize rows into the existing compact grouped-order shape. It additionally returns an opaque next cursor when another group exists. The cursor is encoded and decoded at the server boundary and is rejected safely when malformed.

The compact `GET /api/orders` contract accepts optional `search` and `cursor` parameters and returns `{ orders, nextCursor }`. It caps page size at 50 groups. The legacy full-list and bounded detail paths remain available and unchanged, as do all POST mutation responses. Task 3 does not change browser state, append behavior, selection, bookmarks, or checked orders.

## Index evidence

Create no speculative indexes. Load a representative large local fixture, capture `EXPLAIN (ANALYZE, BUFFERS)` for empty-search first and deep pages and representative search separately, and inspect existing join and foreign-key access. Test candidate indexes locally and retain only those that measurably improve a concrete predicate, ordering, join, or foreign-key operation. Record before/after plans and remove candidates without demonstrated value.

## Testing and verification

Follow red-green-refactor. Focused database tests exercise the real SQL function and prove:

- multi-item orders are never split;
- equal normalized sort keys cross deterministic cursor boundaries correctly;
- manual orders and null order numbers are stable independent groups;
- search covers the entire workspace and all required searchable fields;
- traversing all pages produces no skipped or duplicated groups;
- first and deep empty-search pages remain limited to at most 50 groups.

Focused store and route tests cover cursor encoding, malformed cursors, search forwarding, the 50-group limit, and the unchanged compact payload shape. Existing Orders and Production Batch unit/database tests run as regression coverage. The Supabase migration is created with `npx supabase migration new`, then verified by `npm run prepare:local` so a fresh local database applies it successfully. No migration is applied to production.

## Status and handoff

While implementation or focused verification is active, Task 3 remains `In progress`. It changes to `In review` only after implementation and required local verification succeed. It changes to `Complete` only after its acceptance criteria pass and the work is committed. Task 4 remains `Not started`.
