# Skipped Orders Production Batch Design

## Goal

Allow operators to move skipped order items into the active production batch while correcting false batch-membership signals that disable eligible completed orders.

## Lifecycle

`skipped` means intentionally excluded from production. Adding a skipped item to production reverses that decision, so the same transactional database operation must change the item to `open` and create or reactivate its active `batch_items` membership. Completed items remain `complete` when re-added.

## Eligibility

An order item with an id is eligible when it does not already have an active membership in the current production batch. Open, complete, and skipped items are eligible. Only a `batch_items.status` value of `active` counts as active membership; historical or stale non-active rows must not disable the item.

The same rules apply to item actions, selected-order actions, and checked-order bulk actions.

## Data Flow

The Orders client uses the normalized `isInActiveBatch` flag to enable controls. The orders store derives that flag from active `batch_items` rows. Batch-add requests continue through `add_order_items_to_production_batch`; the RPC validates workspace and batch ownership, filters eligible lifecycle states, reopens skipped items, and upserts active memberships in one transaction.

## Verification

Unit tests cover active-membership normalization, direct skipped-item additions, group additions, and the skipped-to-open transition. Browser tests cover enabled skipped-order selection and adding a skipped order through the existing bulk action.
