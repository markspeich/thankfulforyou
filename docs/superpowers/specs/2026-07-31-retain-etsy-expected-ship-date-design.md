# Retain Etsy Expected Ship Date Design

## Goal

Retain the exact `expected_ship_date` value returned by Etsy for each imported transaction so production data can distinguish an absent Etsy value from an application conversion or persistence failure.

## Data Contract

The Etsy transaction normalizer will continue converting `transaction.expected_ship_date` into the calendar-date value stored as `order_items.ship_by_date`.

It will also copy the original API value into the order item's normalized source metadata using Etsy's exact field name:

```json
{
  "expected_ship_date": 1783400340,
  "shipByDate": "2026-07-06"
}
```

Because `source_json` already persists the normalizer's source metadata per order item, this requires no schema migration. The application will not retain the entire raw Etsy receipt or transaction response.

When Etsy returns `null` or omits `expected_ship_date`, `source_json.expected_ship_date` will be `null` and the normalized `shipByDate` will remain empty. This preserves the diagnostic distinction without inventing a value.

## Data Flow

1. The Etsy client retrieves receipt transactions.
2. The transaction normalizer reads `transaction.expected_ship_date`.
3. The normalizer emits both the raw `expected_ship_date` value and the normalized `shipByDate` value in source metadata.
4. The existing order import store copies that metadata into the order item's `source_json` and stores `shipByDate` in `ship_by_date`.

## Scope and Safety

Only the single Etsy field needed for diagnosis will be retained. Buyer data, OAuth credentials, and complete raw API payloads will not be added. Existing order items will not be modified automatically; newly imported or re-imported transactions will receive the retained value.

## Verification

A normalizer regression test will use Etsy's documented transaction response shape and assert that:

- `source.expected_ship_date` equals the original epoch value;
- `source.shipByDate` equals the expected calendar date; and
- an absent raw value is represented as `null` without producing a normalized date.

The focused Etsy import and order persistence tests will run after implementation.
