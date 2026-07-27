# Amazon Import Failure Logging Design

## Goal

Make production Amazon import failures diagnosable from Vercel runtime logs without exposing credentials, customer data, shipment data, or upstream response bodies.

## Design

The `/api/amazon-import` handler will emit one structured `console.error` event for each failed request. The event name will be `Amazon import API error`, followed by a plain metadata object.

The metadata will contain only:

- `stage`: `auth`, `prepare`, `run`, or `release`
- `errorName`: the JavaScript error class name
- `errorCode`: the application's or ShipStation client's internal error code
- `statusCode`: the safe numeric upstream or application status, when available
- `retryable`: the boolean retry classification, when available
- `requestId`: the ShipStation response request ID, when available
- `streaming`: whether the response stream had started

The log will never include API keys, authorization headers, upstream response bodies, error messages, stack traces, order or shipment identifiers, customization data, or customer data.

## Data Flow

The ShipStation client will read the upstream `request_id` only from error responses and attach it to `ShipStationError`. It will not retain or log the response body.

The API handler will track its current lifecycle stage. Its outer error boundary will convert the caught error into the approved metadata shape and emit the event before returning the existing safe HTTP or NDJSON error response. Public response behavior will remain unchanged.

If releasing an acquired import lease fails while another error is already being handled, the original failure remains primary. A release failure will be logged only when it is the request's primary failure.

## Testing

Unit tests will verify:

- a pre-stream ShipStation failure emits the exact sanitized metadata
- a streamed failure records `run` and `streaming: true`
- secrets, messages, response bodies, shipment identifiers, and stack traces are absent
- successful imports do not emit error logs
- the ShipStation client captures a safe upstream request ID on non-success responses

Existing public error response tests will continue to prove that logging does not change client-visible behavior.

## Scope

This change affects application logging only. It requires no database migration and no product requirements update.
