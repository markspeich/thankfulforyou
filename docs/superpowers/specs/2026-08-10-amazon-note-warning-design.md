# Amazon Note Synchronization Warning Design

## Goal

Import valid Amazon orders into the app even when ShipStation cannot accept the corresponding Notes to Buyer update, and make that unsynchronized ShipStation work visible as a non-blocking warning.

## Context

The current Amazon importer performs each shipment in this order: normalize and enrich every item, build and update ShipStation Notes to Buyer, persist the app order items, then apply the `Amazon Customization Imported` tag. If the note payload exceeds ShipStation's 1,000-character limit, the note builder throws before the app database write. A six-item Amazon shipment therefore imports nothing even though its customization data is valid.

## Selected Approach

Move app persistence before ShipStation side effects. Treat persistence as the import's durable success boundary, then attempt note synchronization and processed tagging. A Notes to Buyer failure becomes a warning, leaves the shipment untagged for repair by a later retry, and does not erase the imported app records.

The importer retains shipment-level atomicity for the database write: all normalized items from one shipment are persisted in the existing transactional RPC or none are. It does not introduce per-item partial persistence.

## Result Contract

The public browser completion event includes the existing count fields plus:

- `warnings`: non-negative count of non-blocking ShipStation synchronization warnings.
- `warningDetails`: the complete list of safe per-shipment warning records, using only `{ orderNumber, stage, summary }` with no fixed count cap.

On the wire, warning details are sent before completion in bounded `warning_details` NDJSON frames. The terminal `complete` record carries counts and bounded failure details but no warning-detail array, so it remains below the browser's existing 256 KiB per-record safety limit. The browser validates and accumulates warning frames in stream order and exposes the complete `warningDetails` list only when a valid terminal completion record is followed by a successful end of stream. It must not expose partial warning data when the stream fails or ends without completion.

`stage` is initially `notes_update`. `summary` is selected from a fixed public vocabulary. For the known note-size error, it is `ShipStation Notes to Buyer is too long to update.` The public event must never contain existing note text, item text, buyer data, raw ShipStation responses, or error messages.

`failed` remains reserved for failures that prevent the app import for that shipment, such as normalization, enrichment, database persistence, or a pre-persistence prerequisite that cannot be made non-blocking. A tag failure after persistence is also a non-blocking ShipStation synchronization warning; the shipment stays untagged.

## Shipment Flow

1. Fetch, normalize, and enrich every item.
2. Persist all enriched items through `importAmazonOrderItemsTransactional`.
3. Increment `importedItems` and `existingItems` from the transactional result immediately after it succeeds.
4. Build and append ShipStation note blocks, then request the Notes to Buyer update if content changed.
5. If note building or updating fails, record a safe `notes_update` warning, write a correlated server-side diagnostic, increment `warnings`, and skip tagging this shipment. Continue importing later shipments.
6. If notes are synchronized, add the processed tag. If tagging fails, record a safe `tag_update` warning and continue. Do not mark this shipment processed in the result.
7. Count a shipment as `processedShipments` only after both required ShipStation side effects complete. A warning shipment is not processed, so a later import can repair notes/tag synchronization without duplicating app data.

Existing persisted order items remain eligible for this repair flow. A retry still reconstructs and appends missing note blocks from ShipStation customization data, then applies the tag; the transactional import reports those app records as existing rather than inserting duplicates.

## Operator Experience

When `failed` is zero, the completion dialog title remains `Amazon Import Complete`, even if `warnings` is nonzero. Its metrics include `Warnings` and `Failed`. The description states that app import completed with ShipStation synchronization warnings and uses every safe detail to identify each Amazon order and action, without a fixed detail-count cap, for example: `Order 114-7445306-8228220: Notes to Buyer could not be updated because the note is too long.`

When `failed` is nonzero, the current failure presentation remains, but imported/existing metrics and warning details remain visible. An overall request/stream failure remains `Amazon Import Failed` and does not present unverified completion metrics.

## Diagnostics And Safety

Diagnostics retain the exact server-side `RangeError` or ShipStation error metadata for diagnosis, correlated by run and shipment. Public API and browser data use only fixed stage and summary values. The raw ShipStation response remains restricted to its existing trusted log field.

## Test Coverage

- Unit-test the result parser for warning count/detail shape, preservation beyond ten entries, rejection of unsafe warning fields, and reconstruction of roughly 2,200 details without increasing the per-record safety limit.
- Unit-test the importer with an oversized Notes to Buyer payload: all shipment items persist, `warnings` is one at `notes_update`, `failed` is zero, no tag request occurs, and subsequent shipments continue.
- Unit-test tag failure after persistence as a `tag_update` warning.
- Verify a retry treats app items as existing and can write notes/tag without duplicate database rows.
- Update API handler tests for sanitized warning completion frames.
- Update the operation-dialog E2E test: a completion with warnings has the successful title, warnings metric, and safe order/action detail; a true terminal import failure remains unchanged.

## Non-Goals

- Automatically truncating or altering ShipStation Notes to Buyer content.
- Adding persistent warning tables or a new retry UI.
- Changing customer-facing ShipStation data outside the existing note/tag synchronization behavior.
