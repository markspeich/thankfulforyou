# Amazon V3 Font and Raw Customization Storage Design

## Problem

Amazon's version 3 customization document stores a text area's selected font in the area's `fontFamily` property. The current normalizer reads the area's label and text but discards `fontFamily`. Its later font-matching stage only recognizes separate fields such as `Name Font`, so version 3 imports can silently fall back to a preset or default font even though Amazon supplied the customer's selection.

The current privacy-safe diagnostics record parser summaries rather than the complete Amazon customization document. That limits exposure in logs, but it also means an unrecognized property cannot be inspected after an import unless the original archive is downloaded separately before its URL expires.

## Goals

- Preserve recognized `fontFamily` values from Amazon version 3 text areas as line-level customer font selections.
- Retain the existing separate `Name Font` and `Title Font` matching behavior as a fallback for legacy documents.
- Store the complete JSON document downloaded from the ShipStation `CustomizationURL` with its order item.
- Keep that raw document out of ordinary browser/API order-item responses and diagnostic logs.
- Cover normalization, persistence, and non-exposure behavior with automated tests.

## Normalization Design

The version 3 candidate extraction will retain each accepted text area's `fontFamily` alongside its normalized text response. Font-selection construction will prefer a non-empty font attached directly to the corresponding version 3 text candidate. The line index will be based on the accepted text-candidate order, matching the order used to build the imported design text.

If a text area has no `fontFamily`, the existing label-based lookup for separate fields ending in ` Font` remains available. This supports legacy Amazon customization structures and avoids changing existing clipboard/import behavior.

Unknown font names remain visible as customer selections but do not override a design line with an unrecognized application font, matching current requirements.

## Persistence and Security Design

An additive Supabase migration will add a nullable `amazon_customization_json jsonb` column to `order_items`. The import persistence layer will write the downloaded document to this column for Amazon items that have customization data.

The dedicated column will not be added to the normalized `source_json` object and will not be selected by ordinary frontend-facing order queries. Existing row-level workspace authorization continues to protect the containing order-item row. Trusted server/database diagnostic access can select the column explicitly when investigation requires the raw document.

The raw document will not be copied into ShipStation notes, application logs, or client telemetry. Existing privacy-safe structural logging remains unchanged except where tests or code need to distinguish successful raw-document persistence without logging its contents.

Existing rows remain valid because the column is nullable. This migration is additive and does not backfill historical imports.

## Data Flow

1. The ShipStation importer downloads and parses the customization JSON.
2. The normalizer extracts text, configuration values, and direct version 3 `fontFamily` selections.
3. The normalized source data drives preset enrichment and saved design-line fonts.
4. The unmodified parsed customization document is carried separately to the persistence boundary.
5. The order-item upsert stores it in `amazon_customization_json` while continuing to store normalized metadata in `source_json`.
6. Ordinary order and batch API responses omit `amazon_customization_json`.

## Error Handling

Raw-document persistence is part of the order-item database write. A database failure must surface through the existing import failure path rather than reporting a successful import whose diagnostic record was silently lost. Items without customization data store `null`.

## Testing

- A normalizer regression fixture shaped like the supplied Amazon document proves that `Name` receives `Skywalk` and `Title` receives `Somekind` from version 3 `fontFamily` properties.
- Existing legacy font-field tests continue to pass and demonstrate fallback compatibility.
- Store tests prove the complete raw object is sent to `amazon_customization_json` during persistence.
- API/store serialization tests prove ordinary client-facing order items do not include the raw column.
- Local database verification proves a fresh schema contains the nullable JSONB column and accepts a representative document.

## Deployment

The schema migration must be applied to production project `oezjskcygvfyezvoulzw` before deploying code that writes the new column. Production application is a separate, explicitly approved step because it changes the live database, even though the migration is additive and non-destructive.
