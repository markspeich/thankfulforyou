# Amazon Import Diagnostics Design

## Goal

Make the production `Import Amazon` workflow diagnosable from application logs without recording raw Amazon customization documents or customer-entered customization values.

The diagnostics must identify where each shipment or item stopped progressing and must show how the customization document was structurally interpreted, how customer font selections were paired and resolved, which preset was applied, and whether the database imported or skipped the item.

## Scope

This work covers the server-side ShipStation/Amazon Custom import path triggered by `Import Amazon`. It does not change the Seller Central clipboard helper, the public progress stream, or import behavior. It does not add a database table or retain Amazon Custom archives.

## Privacy Boundary

Production diagnostics may include:

- A generated import-run correlation ID.
- Workspace ID, shipment ID, Amazon order number, and Amazon order-item ID.
- Pipeline stage and bounded counts.
- Customization document format/version and bounded field labels.
- Field classifications and rejection-reason counts.
- Preset IDs, internal effective font IDs, and recognized/unrecognized font-selection counts.
- Sanitized error type, error code, HTTP status, retryability, and safe upstream request ID.
- Persistence outcome (`imported` or `existing`).

Production diagnostics must never include:

- Customer-entered text or other customization values, including customer font-name values.
- Buyer names, addresses, email addresses, or shipment contact data.
- Raw Amazon Custom JSON, archive bytes, or rendered assets.
- Customization download URLs or query strings.
- ShipStation API credentials, authorization headers, or Supabase secrets.
- Unsanitized exception messages or stacks from per-shipment failures.

Labels are product-defined structural metadata. They will be normalized, stripped of control characters, length-limited, count-limited, and emitted without their associated values. Unknown labels remain visible within those bounds because they are necessary to diagnose schema drift.

## Architecture

Add a small diagnostics module that constructs immutable, JSON-safe event objects. The import service receives a logger dependency, defaulting to a production logger backed by `console.info` and `console.error`. Tests inject a recording logger.

Every event uses a stable envelope:

```json
{
  "event": "amazon_import.item.normalized",
  "runId": "uuid",
  "workspaceId": "uuid",
  "shipmentId": "shipment-id",
  "orderNumber": "113-0000000-0000000",
  "orderItemId": "item-id",
  "stage": "normalization",
  "details": {}
}
```

The diagnostics module owns all sanitization and bounds. Call sites pass only the minimum source objects necessary to derive safe summaries. Logger failures are swallowed so observability cannot change import results.

## Events and Data Flow

### Run boundaries

- `amazon_import.run.started`: emitted after the lock is acquired and configuration is ready.
- `amazon_import.shipments.fetched`: includes the shipment count.
- `amazon_import.run.completed`: includes the existing completion counters.
- `amazon_import.run.failed`: includes the safe global failure metadata and stage.

### Shipment boundaries

- `amazon_import.shipment.started`: includes item count and whether the processed tag is already present.
- `amazon_import.shipment.skipped`: records the processed-tag reason.
- `amazon_import.shipment.completed`: includes imported/existing item counts for that shipment and whether notes and the processed tag were updated.
- `amazon_import.shipment.failed`: records the safe failing stage and sanitized error metadata. This closes the current gap where the service only increments `failed`.

### Item boundaries

- `amazon_import.item.started`: includes whether a customization URL is present, never the URL.
- `amazon_import.item.customization_fetched`: summarizes the raw document without values:
  - detected format (`v3`, `legacy`, `empty`, or `unknown`);
  - surface, area, and candidate-node counts;
  - accepted text/configuration field counts;
  - bounded accepted field labels;
  - bounded rejected-field counts grouped by reason.
- `amazon_import.item.normalized`: includes design text-line count, response count, customer-font selection count, and `customizationNeeded`. It does not include text or response values.
- `amazon_import.item.enriched`: includes preset ID, design-line count, effective internal font IDs, selection count, and recognized/unrecognized counts. It does not include customer font-name values.
- `amazon_import.item.persisted`: includes only `imported` or `existing`.

Each shipment tracks a local safe stage (`item_start`, `customization_fetch`, `normalization`, `enrichment`, `notes_update`, `persistence`, or `tag_update`) so a caught item/shipment failure can be located precisely.

## Customization Summary

The existing Amazon customization normalizer will expose a diagnostic summarizer alongside its behavioral extraction API. The summarizer must inspect the same supported v3 and legacy containers as the parser so logs describe what the parser actually saw.

Rejected candidates are counted using stable categories such as `blank`, `internal`, `metadata_label`, `url`, `asset`, `markup`, and `unsupported`. Only counts and bounded labels are logged. No value-derived lengths, hashes, or excerpts are included because those can still disclose customer content.

## Font Resolution Summary

The enrichment boundary will report:

- Whether a preset was found and its ID.
- The number of supplied customer selections.
- How many resolved to a known workspace font.
- How many remained unknown.
- The effective internal `fontId` for each persisted design line.

The diagnostic calculation must use the same font-resolution helper as the actual overlay so it cannot disagree with application behavior.

## Error Handling

Per-shipment errors remain non-global and continue processing subsequent shipments. Before incrementing the failure count, the service emits `amazon_import.shipment.failed` with the current safe stage.

Global failures continue to abort the import. The existing API-level error log remains, and the correlated run-level event adds the run ID and safe import stage. Error metadata must use allowlisted codes and properties; arbitrary messages and stacks are excluded.

If diagnostics construction or output throws, the import continues unchanged.

## Testing

Unit tests will be written before implementation and will verify:

- V3, legacy, empty, and unknown documents produce bounded structural summaries.
- Field labels and rejection counts are useful while field values are absent.
- Font enrichment summaries distinguish recognized and unknown selections without logging customer font-name values.
- A successful shipment produces ordered correlated events through persistence and tagging.
- A failure at each important asynchronous boundary emits the correct shipment stage.
- Logger failures do not alter import results.
- Fixtures contain distinctive customer names, personalization, URLs, addresses, and credentials; serialized diagnostic events must contain none of them.
- Existing Amazon import behavior and progress responses remain unchanged.

Focused Amazon import tests, the complete unit suite, `git diff --check`, and the production build are required before completion.

## Operational Use

After deployment, an operator supplies the approximate import time and Amazon order number. Production logs can then be filtered by order number to obtain the run ID, and all related events can be followed by that run ID through archive parsing, normalization, enrichment, and persistence.

This first version relies on Vercel application-log retention. If retention proves insufficient, a later design may add a durable diagnostic-event store with an explicit retention policy. Raw customization retention remains out of scope.
