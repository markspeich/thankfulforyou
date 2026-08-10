# Amazon Buy Shipping Items Update Design

## Goal

Allow the Amazon import notes update to succeed for Amazon Buy Shipping shipments by including the shipment's existing `items` array in the ShipStation update request.

## Scope

This is a narrow request-shape fix. The import service will pass `shipment.items` to `updateNotesToBuyer()`, and the ShipStation client will include that array in `PUT /v2/shipments/{shipment_id}`. No item reconstruction, new filtering layer, retry change, database change, or UI change is included.

## Data Flow

1. The ShipStation pending-shipment response already contains `shipment.items`.
2. The Amazon import service passes that exact array to the notes-update client call.
3. The client includes `items` alongside the existing notes, addresses, carrier, service, rule, and package fields.
4. Existing persistence and processed-tag behavior remains unchanged.

If `items` is not an array, the client omits it rather than inventing item data. Amazon Buy Shipping will then return its upstream validation error, which remains visible in the raw server logs.

## Testing

Tests will be written first and will verify:

- The service passes the original shipment items to `updateNotesToBuyer()`.
- The client sends those items unchanged in the update request body.
- The existing package and shipping-preservation fields remain present.
- Existing ShipStation and Amazon import tests continue to pass.

The complete unit suite, relevant Amazon browser tests, production build, and `git diff --check` are required before completion.

## Requirements

`docs/requirements.md` will record that Amazon Buy Shipping notes updates must preserve and resend the shipment's existing items because ShipStation requires them for this update.
