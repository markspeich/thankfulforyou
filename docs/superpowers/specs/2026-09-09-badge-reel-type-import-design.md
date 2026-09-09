# Badge Reel Type Import Design

## Goal

Import the badge-reel type selected by customers on Amazon and Etsy, normalize equivalent marketplace answers to stable business identifiers, store the result on each order item, backfill historical orders, and display the canonical label in Orders item details.

## Scope

This change covers Amazon and Etsy API import normalization, durable order-item storage, safe historical backfill, Orders API serialization, and the selected-order item cards on the Orders page.

This first version does not add badge-reel type editing, filtering, searching, Production Batch display, export behavior, or an operator-managed type catalog.

## Canonical Catalog

The application will own a small marketplace-neutral catalog in a focused JavaScript module. Each entry has a stable identifier, a display label, and recognized aliases.

The initial entry is:

| ID | Display label | Recognized aliases |
| --- | --- | --- |
| `swivel-alligator` | `Swivel Alligator` | `Swivel Alligator`, `Swivel Alligator Clip` |

Normalization trims surrounding whitespace, compares case-insensitively, and ignores punctuation and repeated whitespace. It does not use substring or fuzzy matching because those could silently assign the wrong physical product.

The catalog module exposes pure operations to resolve a marketplace value to a canonical ID and to resolve a canonical ID to its display label. Keeping IDs independent of marketplace wording allows aliases to grow without rewriting stored orders.

## Marketplace Extraction

Both importers recognize candidate field labels equivalent to `Badge Reel` or `Badge Reel Type`, using the same conservative normalization rules for case, whitespace, and punctuation.

For Amazon, the candidate comes from accepted configuration responses produced by the customization normalizer. The original response remains in `source.personalizationResponses`.

For Etsy, the candidate comes from transaction variations. The original variation remains in `source.variations` and the private Etsy diagnostic record.

When more than one recognized candidate exists, the first candidate in marketplace order wins. A missing or unrecognized value produces no canonical ID and does not fail or warn the whole import. Raw marketplace data remains intact for diagnostics and future alias additions.

Each normalized import item carries `source.badgeReelTypeId` only when a canonical value is recognized. This keeps the normalized item contract consistent with other imported metadata before persistence.

## Database Storage

Add a nullable `text` column named `badge_reel_type_id` to `public.order_items`. A text column is preferable to a PostgreSQL enum or a value-specific check constraint because the catalog will expand and adding a new physical type should not require relaxing a database constraint.

The imported order-item row builder maps `source.badgeReelTypeId` into this column. Browser-facing order mappers expose it as `badgeReelTypeId`. The raw marketplace wording is not duplicated into another column because it already remains in `source_json`.

The migration is additive and non-destructive. It also backfills null values from retained source JSON:

- Amazon: find a `personalizationResponses` entry whose name is `Badge Reel` or `Badge Reel Type`, then resolve known aliases.
- Etsy: find a `variations` entry whose `formatted_name` is `Badge Reel` or `Badge Reel Type`, then resolve known aliases.

The SQL backfill implements the same exact initial alias set as the application catalog and updates only rows whose `badge_reel_type_id` is null. It does not alter source JSON, order status, designs, or batch membership.

## Re-import Semantics

New imports persist the resolved canonical ID normally. For an existing imported order item, re-import may populate `badge_reel_type_id` only when the stored value is null and the new import resolves a known type. It must not replace a non-null stored value, reopen completed or skipped work, or overwrite saved design content.

The Amazon transactional import function and the Etsy/general order store must follow the same rule. This behavior lets newly added aliases repair previously unresolved orders without weakening import idempotency.

## API and Orders Display

Orders API projections include `badge_reel_type_id` and map it to `badgeReelTypeId`. The client obtains the display label from the shared catalog so persisted IDs remain stable and presentation wording remains centralized.

Each selected-order item card adds a metadata row between Color and Quantity:

- Recognized ID: `Badge reel: Swivel Alligator`
- Null with no retained candidate: `Badge reel: Not set`
- Null with a retained candidate that could not be resolved: `Badge reel: Unrecognized`

The normal Orders UI does not display the raw unrecognized marketplace answer. It remains available in stored source metadata for diagnostics. Compact grouped-order rows remain unchanged.

## Error Handling

Badge-reel type extraction is optional metadata processing. Missing arrays, malformed entries, blank strings, unknown labels, and unknown values resolve to null without failing the order import. Database errors continue through the importer's existing failure handling.

An unknown stored canonical ID is treated as unrecognized in the UI rather than rendered as an internal identifier.

## Testing

Unit tests will verify:

- Alias normalization, including case, whitespace, and punctuation.
- Exact label recognition without fuzzy matches.
- Amazon extraction from customization configuration responses.
- Etsy extraction from transaction variations.
- Missing and unknown values preserving raw source data while omitting the canonical ID.
- Imported row persistence and browser-facing mapping.
- Re-import filling only null values and preserving non-null values and design state.
- Migration shape and safe backfill predicates for both marketplaces.
- Orders item-card rendering for recognized, missing, and unrecognized values.

Focused importer, order-store, Orders workspace, and migration tests will run first, followed by the repository's appropriate unit and end-to-end verification.
