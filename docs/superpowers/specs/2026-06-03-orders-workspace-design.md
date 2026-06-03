# Orders Workspace Design

## Goal

Add an `Orders` workspace where operators can browse non-archived database orders, inspect saved designs for each order item, import Etsy clipboard data without automatically batching it, and selectively add individual or checked orders to the active production batch.

## Scope

This design covers:

- a new `Orders` left-nav workspace
- listing non-archived workspace orders from Supabase
- grouping order items by Etsy order number for the orders column
- showing saved design cards for the selected order
- copying saved designs from order item cards
- adding one order item, or all checked order rows, to the active production batch
- separating Production Batch paste behavior from Orders paste behavior
- reusable import and order/design mapping helpers
- requirements updates

This design does not cover:

- editing designs directly from the Orders workspace
- advanced order filters beyond the default non-archived view
- marking orders shipped or produced
- customer-facing order status
- creating new production batches from the Orders page

## Product Intent

The current Production Batch page is good for the immediate work queue, but production also needs a broader order browser. Operators should be able to paste newly copied Etsy order data into the database, review order items and saved designs later, and decide which items belong in the current production batch.

The important workflow distinction is where the paste happens:

- `Production Batch` paste imports Etsy line items and adds them to the active batch.
- `Orders` paste imports Etsy line items into the order database only.

This lets the shop keep an order history without every imported order item immediately entering the active cutting queue.

## User-Facing Behavior

### Navigation

Add a left-nav item labeled `Orders`. The existing `Production Batch` item remains the active batch workspace. The nav order should keep production workflows easy to scan, with `Production Batch` and `Orders` near each other.

### Orders Workspace Layout

The workspace follows the existing production style: compact, practical, and built for repeated use. On desktop it uses two main columns:

- left column: non-archived orders
- right column: order item cards for the selected order

The first column shows one row per Etsy order. When multiple order items share the same `order_number`, they appear as one order row. Orders without an order number can be grouped by a stable fallback based on buyer/listing/transaction metadata.

Each order row includes:

- a checkbox for bulk selection
- order number when available
- buyer name when available
- item count
- concise status/count metadata

Clicking the row selects the order. Clicking the checkbox changes selection without losing the current row selection.

The orders column has an ellipsis menu. Its first implementation includes `Add Checked to Production Batch`, which adds every non-archived order item under the checked order rows to the active production batch.

### Selected Order Items

The second column shows one card per non-archived order item in the selected order.

Each card includes:

- order item identity and imported listing metadata
- buyer/order metadata where useful
- personalization/design text
- saved design status
- a compact saved-design preview when cached export-ready geometry is available
- an explicit empty/incomplete state when the design has not been completed
- an ellipsis menu

The ellipsis menu includes:

- `Copy Design`
- `Add to Production Batch`

`Copy Design` should copy the saved design SVG when export-ready cached geometry is available. If the design is not export-ready, the app should show a toast explaining that the design must be completed before it can be copied.

`Add to Production Batch` adds that order item to the active production batch. If the item is already in the active batch, the menu action should be disabled or report that it is already in the batch.

### Paste Behavior

Both the Production Batch and Orders workspaces use the same Etsy clipboard parser and import normalization.

When the operator clicks `Paste` in `Production Batch`:

1. read the Etsy clipboard payload
2. normalize imported line items
3. create or update workspace `order_items`, `designs`, and `design_lines`
4. add imported order items to the active production batch through `batch_items`
5. skip active-batch duplicates
6. show a floating toast summary

When the operator clicks `Paste` in `Orders`:

1. read the Etsy clipboard payload
2. normalize imported line items
3. create or update workspace `order_items`, `designs`, and `design_lines`
4. do not create `batch_items`
5. refresh the Orders list
6. show a floating toast summary

## Data Model

The existing schema already has the core entities:

- `order_items`
- `designs`
- `design_lines`
- `design_analysis_cache`
- `production_batches`
- `batch_items`

The Orders workspace should treat `order_items.status = 'archived'` as hidden by default. It should also avoid showing archived batch memberships as active production state.

No new table is required for the first implementation. Bulk checked state is UI-only and should not be persisted.

## API Design

Add an authenticated Orders API using the existing production-batch auth pattern.

### `GET /api/orders`

Returns non-archived workspace orders grouped for UI display. The response should include enough order item, design, design line, and cached build metadata to render item cards and copy export-ready designs.

The route should only return rows for the authenticated operator's workspace.

### `POST /api/orders`

Supports narrow actions:

- `importClipboardItems`
- `addOrderItemToProductionBatch`
- `addOrdersToProductionBatch`

`importClipboardItems` accepts normalized imported items from the client or raw clipboard payload parsed server-side if the implementation chooses that boundary. It creates order/design records and optionally adds batch memberships depending on a `target` value:

- `target: "orders"` stores only orders
- `target: "productionBatch"` stores orders and active batch memberships

`addOrderItemToProductionBatch` accepts one order item id and adds it to the active batch.

`addOrdersToProductionBatch` accepts order grouping ids or order item ids resolved from checked rows and adds all non-archived matching order items to the active batch.

All batch-add actions should be idempotent for items already in the active batch.

## Client Architecture

Extract reusable helpers from `src/app.js` into focused modules:

- clipboard import parsing and imported-entry normalization
- imported order identity/dedupe helpers
- batch item/order item creation from normalized imports
- order/design serialization helpers used by both Production Batch and Orders

Add an Orders client API module for:

- fetching grouped orders
- importing clipboard items to Orders
- adding one item to the production batch
- adding checked orders to the production batch

The existing Production Batch page should call the shared import helper with a `productionBatch` target. The new Orders page should call it with an `orders` target.

## Error Handling

- Missing auth: show the existing sign-in gate behavior.
- Clipboard unavailable: show a floating toast.
- Clipboard payload invalid: show a floating toast with the parser error.
- No importable Etsy designs: show a floating toast.
- Add-to-batch with no active production batch: show a floating toast and leave orders unchanged.
- Add-to-batch duplicate: do not create another batch membership; report that the item is already in the batch.
- Copy design without export-ready cached geometry: show a floating toast saying the design must be completed first.
- Server errors: show concise floating toast feedback and keep the current selection/check state when practical.

## Testing Strategy

Add unit tests for:

- clipboard parsing shared by both workspaces
- Orders import target not creating batch memberships
- Production Batch import target creating batch memberships
- non-archived order filtering
- grouped order row construction
- idempotent add-to-batch behavior
- checked-order bulk payload construction
- copy-design availability from cached export-ready geometry

Add API route tests for:

- `GET /api/orders` only returning the authenticated workspace's non-archived orders
- importing to Orders without `batch_items`
- importing to Production Batch with `batch_items`
- adding one order item to the active batch
- adding all order items for checked orders to the active batch
- rejecting unauthenticated requests

Add Playwright coverage for:

- `Orders` appears in the left navigation
- Orders paste adds rows to the Orders workspace but not the Production Batch queue
- Production Batch paste adds rows to the Production Batch queue
- selecting an order shows item cards
- item card ellipsis can add one item to Production Batch
- checked order rows can be bulk-added to Production Batch

## Implementation Notes

- Keep saved design preview lightweight. Prefer cached export-ready geometry when available, and show an incomplete state otherwise.
- Do not run connectedness analysis from the Orders browser just to render the list.
- Keep checkboxes visually compact and do not let checkbox clicks trigger row selection.
- Use existing row, card, menu, toast, and button styling rather than introducing a new visual language.
- Keep order-list queries paginatable in shape even if the first pass returns a practical default limit.

## Self-Review

- Placeholder scan: no placeholder text remains.
- Consistency check: the design consistently distinguishes `Orders` paste from `Production Batch` paste.
- Scope check: the design is one coherent workflow feature and does not include direct design editing or order lifecycle management.
- Ambiguity check: non-archived orders are the default visible set, and checked-order state is UI-only for this pass.
