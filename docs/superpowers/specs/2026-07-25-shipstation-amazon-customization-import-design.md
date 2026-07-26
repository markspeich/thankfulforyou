# ShipStation Amazon Customization Import Design

## Goal

Add an operator-initiated `Import Amazon` workflow to the Orders workspace. It reads pending Amazon shipments through ShipStation API V2, downloads Amazon Custom archives from each line item's `CustomizedURL`, appends a production-friendly customization summary to ShipStation `Notes to Buyer`, and creates idempotent Amazon order items in the app's Orders workspace. It does not add items to Production Batch.

## Confirmed External Behavior

- ShipStation API V2 at `https://api.shipstation.com/v2` is the integration target and authenticates with a server-side `API-Key` header.
- The current Amazon ShipStation store ID is `se-4461867`; configure it server-side as `SHIPSTATION_AMAZON_STORE_ID` rather than embedding it in browser code.
- Pending Amazon shipments expose a line-item option named `CustomizedURL`.
- The observed URL returns `application/zip`. Its archive contains JSON, XML, JPG, and SVG entries, and the JSON contains `customizationData`.
- `PUT /v2/shipments/{shipment_id}` supports partial updates to `notes_to_buyer`.
- A ShipStation tag named `Amazon Customization Imported` is the durable processed marker.

## User Interface

Place `Import Amazon` in the Orders header beside the Etsy import action, not in an ellipsis menu. While running, disable it, use the Etsy action's accessible busy treatment, show order-level progress in the existing operation dialog, and prevent a concurrent Amazon import in the workspace.

After completion, refresh Orders while preserving selection when practical. Report these counts separately:

- Amazon shipments processed;
- app order items imported;
- existing app items skipped;
- ShipStation shipments already processed;
- items needing customization review; and
- failures.

Do not expose credentials, signed URLs, archive contents, customer values, or raw upstream errors in the browser.

## Eligibility and Idempotency

List every `pending` shipment for the configured Amazon store, following all pages. Skip shipments tagged `Amazon Customization Imported`.

Import every line item, including items without `CustomizedURL`. Amazon order-item ID is the durable app identity. Preserve existing app items without reopening or overwriting them.

Apply the processed tag only after both conditions are true:

1. The ShipStation notes update succeeded, or the exact desired item blocks already exist.
2. Every shipment line item was newly persisted or recognized as an existing durable app item.

If either destination fails, leave the shipment untagged and retryable.

## Archive Handling

For each non-empty `CustomizedURL`:

1. Require HTTPS and the exact observed Amazon Custom host `zme-caps.amazon.com`.
2. Validate every redirect target against the same policy.
3. Download server-side with timeout and compressed-size limits.
4. Validate ZIP content and structure instead of relying on a filename suffix.
5. Enforce entry-count and total-uncompressed-size limits.
6. Locate and parse the supported JSON entry's `customizationData`.
7. Ignore XML, JPG, SVG, and other assets for text import.

Malformed, oversized, expired, untrusted, or unsupported archives are isolated failures. Never log the signed URL or body.

## Customization Normalization

Preserve source order. Exclude a field when its name starts with `^`, its name or value is blank, or it represents internal identifiers, preview metadata, filenames, or generated placement data.

Classify remaining fields as:

- **free text:** customer-entered text inputs that become ordered editable design lines and remain in source metadata;
- **configuration:** dropdown, color, style, clip, surface, and similar choices that remain in source metadata but do not become design lines.

Both classes appear in ShipStation notes. Only free text initializes app design text. An item without usable free text still imports with `Customization needed`.

## ShipStation Notes

Preserve existing notes and append one block per customized item in ShipStation item order:

```text
Amazon Customization -- Badge Reel
Text Line 1: Jane
Text Line 2: RN
Color: Teal
Amazon Order Item: 123456789
```

Use the ShipStation item `name`, which contains the operator's simplified product title, not the title inside the Amazon archive.

The `Amazon Order Item` line is the retry marker. Do not append a block when that exact item ID is already present.

The initial maximum combined `notes_to_buyer` length is 1,000 characters. Keep the limit as a named server constant so it can be revised if ShipStation publishes or returns a stricter limit. Fail the shipment without truncation if the combined notes exceed it.

## App Order Mapping

Reuse the existing Orders normalization and persistence boundaries. Map:

- Amazon order ID or ShipStation external order ID to app order number;
- Amazon order-item ID to durable imported item ID;
- ShipStation item `name` to imported listing title;
- ASIN, SKU, image, quantity, Ship By Date, price metadata, and source IDs where available;
- normalized free text to ordered design lines; and
- allowed free-text and configuration fields to source metadata.

Missing usable free text sets `Customization needed`. Import to Orders only, never Production Batch.

## Server Architecture

Use one authenticated server endpoint, following the Etsy streaming-import pattern where applicable. Keep responsibilities isolated:

- **ShipStation client:** pagination, updates, tags, timeouts, and bounded retries.
- **Archive fetcher:** trusted-host and redirect validation, download limits, ZIP limits, and extraction.
- **Normalizer:** pure conversion from Amazon JSON to ordered free text, configuration, notes lines, and warnings.
- **Import service:** eligibility, per-shipment orchestration, app persistence, note deduplication, tagging, progress, and summary.
- **API handler:** app authorization, no-cache streaming, disconnect handling, and sanitized errors.
- **Browser client/UI:** invocation, progress, completion, and Orders refresh.

`SHIPSTATION_API_KEY` and `SHIPSTATION_AMAZON_STORE_ID` are server-only.

## Failure and Retry Behavior

Isolate work per shipment and continue after individual failures. Retry transient ShipStation `429` and `5xx` responses with bounded exponential backoff and usable retry guidance. Do not retry authentication, validation, untrusted URL, malformed archive, or deterministic parsing failures.

Retries recognize existing app items and existing item-ID note blocks, complete missing work, then tag only after both destinations are satisfied. Diagnostics may include stable internal error codes and ShipStation/Amazon IDs, but never PII, personalization, signed URLs, credentials, or raw bodies.

## Testing and Live Rollout

ShipStation platform V2 has no sandbox, so automated tests use mocked ShipStation responses and synthetic ZIP fixtures. Cover pagination, store/status filtering, tag skipping, every-item import, URL/redirect security, archive limits, JSON parsing, order preservation, `^` exclusion, text/configuration classification, ShipStation title use, multi-item note formatting, existing-note preservation, retry deduplication, note limits, durable app idempotency, customization-needed behavior, update-before-tag ordering, no-tag failures, bounded retries, continued partial processing, authorization, secret non-disclosure, progress, summaries, refresh, and button placement/busy state.

Before enabling unrestricted live writes, perform a read-only production smoke test and then a deliberately selected pending-shipment test. Confirm ShipStation notes and the app item before a full-account import.

## Out of Scope

- Scheduled or webhook-driven imports.
- Label purchase, void, fulfillment, or shipment status changes.
- Non-pending shipments.
- Turning customization JPG/SVG assets into editable artwork.
- Automatic Production Batch membership.
- Replacing the Seller Central clipboard helper.
