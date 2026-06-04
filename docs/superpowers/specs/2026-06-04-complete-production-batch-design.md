# Complete Production Batch Design

## Goal

Replace production-batch archive behavior with a clean order lifecycle where orders are either `open` or `complete`.

## Decisions

- `order_items.status` is the single durable order lifecycle field.
- New order items are `open`.
- Completing a production batch marks every order item currently in that batch as `complete`.
- Completing a production batch removes those batch memberships from the active production-batch view.
- The app stops writing `archived` status values for order items or batch memberships.
- Existing legacy archived data may be purged or reset outside the feature implementation.

## Production Batch Behavior

The existing `Archive Batch` action becomes `Complete Production Batch`.

Before completion, the app checks whether every current batch item is ready. A row is ready when its visible batch status is `captured` or `exported`, and when export-ready saved geometry is present where the saved-build data can be checked. If any items are not ready, the operator sees a confirmation warning with the incomplete count. Confirming still completes the batch.

After completion succeeds, the active batch view is cleared and the editor returns to the empty state.

## Orders Behavior

The Orders page defaults to open orders. It should provide:

- Search by order number, buyer, listing, transaction, color, and design text.
- Status filter: `Open`, `Complete`, `All`.
- Batch filter: `All`, `In Batch`, `Not In Batch`.

The Orders API defaults to `status=open` and supports `status=complete` and `status=all`.

## Testing

Tests should prove that completion updates order items, removes active batch memberships, avoids new archived writes, warns for incomplete production-batch rows, and defaults Orders to hiding complete orders.
