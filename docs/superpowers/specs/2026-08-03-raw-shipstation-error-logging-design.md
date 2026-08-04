# Raw ShipStation Error Logging Design

## Goal

Make failed Amazon imports diagnosable by recording the complete ShipStation error response body in server-side production logs.

## Scope

This change applies only to non-success responses returned by ShipStation during server-side API calls. It changes server logging and the server-only error object. It does not expose raw ShipStation responses through the Amazon import API, progress stream, browser dialog, client telemetry, or database.

## Design

The ShipStation client will read every terminal non-success response exactly once as text. It will retain that text on `ShipStationError` as server-only diagnostic data and continue extracting the existing request ID and friendly validation metadata when the body is valid JSON.

The Amazon shipment-failure diagnostic will log the raw body together with the existing run ID, workspace ID, shipment ID, Amazon order number, pipeline stage, HTTP status, retryability, and ShipStation request ID. No field-level filtering, message allowlist, or response-shape matching will govern whether the raw body is logged.

The body will have a generous size cap solely to prevent accidental runaway log volume. If the response exceeds the cap, the log will contain the leading portion and an explicit truncation marker. This is a transport limit, not content filtering.

## Data Boundaries

Raw ShipStation error content is permitted in trusted server-side application logs. It remains prohibited from:

- Amazon import API responses and NDJSON progress events.
- Browser dialogs, console output, and client telemetry.
- Database records and retained application diagnostics.
- Source control and test fixtures containing real production responses.

Existing public failure summaries remain application-authored and bounded. The raw body must not become enumerable through public failure serialization helpers.

## Error Handling

If reading the body fails, the error proceeds with a clear server-log fallback stating that the ShipStation response body could not be read. JSON parsing is best-effort and cannot prevent the raw text from being logged. Logging failure must not alter import counters or convert a shipment-level failure into a run-level failure.

## Testing

Tests will verify:

- A JSON error response is read once and retained verbatim.
- A plain-text error response is retained verbatim.
- An oversized response is truncated with an explicit marker.
- Existing request-ID and friendly validation extraction still work from JSON text.
- The shipment-failure server diagnostic includes the raw body.
- API completion events, browser parsing, and dialog descriptions never include the raw body.
- Logger failures remain non-throwing and do not change import results.

Focused ShipStation, diagnostics, import-service, API, and browser-boundary tests plus the complete unit suite, relevant Amazon browser tests, production build, and `git diff --check` are required before completion.

## Requirements Change

`docs/requirements.md` will be updated to replace the current prohibition on raw ShipStation responses in application logs. The new requirement will explicitly permit complete raw ShipStation error bodies in trusted server-side logs while preserving the prohibition everywhere else.
