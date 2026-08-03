# Amazon Import Failure Details Design

## Goal

When an Amazon import cannot update a ShipStation shipment, give the operator a concise, actionable explanation in the existing operation dialog and retain enough sanitized detail in production logs to diagnose the rejected request. Raw upstream responses and customer data must remain private.

## Scope

This change covers non-success responses from the ShipStation API, per-shipment failure reporting in the Amazon import result/progress stream, structured Amazon import diagnostics, and the final Amazon import dialog. It does not change import ordering, retry policy, database schema, or the handling of successful shipments.

## Error Contract

`ShipStationError` will gain optional sanitized validation metadata derived from a non-success JSON response. The metadata will use a small internal shape containing a stable reason code, a bounded field name when ShipStation identifies one, and a bounded operator-safe summary.

The ShipStation client will recognize only documented structural error fields and known validation patterns. It will normalize control characters and whitespace, impose strict per-field and collection length limits, and discard unknown nested values. It will never retain the full response payload.

The safe summary must describe request validation rather than echo arbitrary upstream prose. Examples include:

- `Package weight is required.`
- `The selected shipping service is invalid.`
- `ShipStation rejected the shipment update.`

If the response cannot be confidently reduced to safe validation metadata, the generic fallback is used.

## Data Flow

1. ShipStation returns a terminal non-success response.
2. The client parses the response body once and extracts both the existing safe request ID and allowlisted validation metadata.
3. The client throws `ShipStationError` containing only safe metadata.
4. The Amazon import service converts a per-shipment failure into a bounded public failure record containing the order number, pipeline stage, and friendly summary.
5. The existing completion event includes a bounded `failures` array in addition to aggregate counters.
6. Structured diagnostics include the safe reason code, safe field name, and friendly summary so production logs remain searchable.
7. The Orders workspace renders failed Amazon imports as an `Operation Failed` dialog with the first failure in plain language. When multiple shipments fail, it reports the first failure and the number of additional failures while preserving the aggregate counts.

The preferred dialog sentence is:

`Amazon order 111-… failed while updating ShipStation notes: Package weight is required.`

The order number may be displayed because it is already an approved operational identifier in Amazon import diagnostics and is necessary for the operator to locate the order.

## Privacy and Safety Boundaries

Allowed output is limited to:

- Amazon order number.
- Stable pipeline-stage label.
- Stable internal reason code.
- An allowlisted, normalized ShipStation field name.
- A bounded friendly sentence assembled by application code.
- Existing status code, retryability, and safe request ID.

The implementation must not expose buyer names, addresses, email addresses, customization text, notes-to-buyer contents, URLs, credentials, arbitrary upstream messages, stacks, or raw response JSON. Values found in ShipStation validation responses are never included in logs or browser responses.

## UI Behavior

An Amazon import with zero failures keeps the existing completion summary. An import with one or more failures transitions the same modal from progress to a dismissible error state titled `Operation Failed`. The description identifies the first failed Amazon order, translates the internal stage to operator language, and shows the friendly reason. The existing count metrics may remain visible so successful work from a partially failed run is not hidden.

Missing or malformed failure details fall back to `One or more Amazon orders could not be imported. Please retry or check the production logs.` The UI treats all response fields as untrusted and normalizes them before rendering with `textContent`.

## Testing

Tests will be written before production changes and will cover:

- Extraction of a documented ShipStation field-validation response into safe metadata.
- Generic fallback for malformed, unknown, oversized, or value-bearing responses.
- Proof that distinctive customer data and arbitrary upstream text do not reach serialized errors, diagnostics, progress events, or dialog descriptions.
- Preservation of the existing safe request ID behavior.
- Per-shipment failure records for `notes_update` without changing successful import counters.
- Multiple failures with bounded output.
- API streaming of the completion event with safe failure records.
- Orders workspace formatting for one failure, multiple failures, and missing details.
- Browser verification that the dialog becomes dismissible, uses `Operation Failed`, and displays the friendly order-specific explanation.

Focused unit tests, the complete unit suite, relevant browser tests, `git diff --check`, and the production build are required before completion.

## Operational Outcome

For the observed production failure, a repeat attempt will either identify the rejected ShipStation field in the dialog or provide the generic safe fallback. The production log entry will carry the same safe reason together with the existing run ID, shipment ID, order number, stage, status code, and ShipStation request ID.
