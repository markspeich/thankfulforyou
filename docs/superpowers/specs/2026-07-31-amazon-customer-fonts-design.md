# Amazon Customer Font Selection Design

## Goal

Preserve Amazon customers' per-line font selections during import, apply recognized selections to the saved design and Production Batch editor, and display the original selections beside the imported design text.

## Supported inputs

Both Amazon import paths must use the same customer-font behavior:

- The Seller Central clipboard helper reads customization fields from the order page.
- The ShipStation import reads customization fields from the Amazon Custom archive.

Amazon customization labels are paired by semantic line. `Name` pairs with `Name Font`, `Title` pairs with `Title Font`, and numbered text labels pair with their corresponding numbered font labels when such labels are present. The pairing result retains the customer-facing font name as source metadata.

## Font resolution

Customer font names are normalized by trimming whitespace and comparing case-insensitively against the workspace font registry. A recognized selection resolves to the font's stable internal id. The three production fonts therefore resolve to `candlepin`, `skywalk`, and `somekind`, while uploaded workspace fonts can resolve by their current display names.

An empty or unrecognized customer font does not change design settings. Its original non-empty name remains in source metadata so the Production Batch page can show what the customer selected without inventing an internal font id.

## Preset precedence and persistence

The listing/ASIN preset is applied first and remains the source of all line settings. A recognized customer font is then overlaid on the corresponding text line only when its resolved `fontId` differs from the preset-produced `fontId`.

The overlay changes only `fontId`. It must preserve the preset's text height, letter bridge, line bridge, offsets, horizontal and vertical scale, text-height lock, fixed-design settings, backing settings, and all other line or design settings.

The final overlaid line settings are persisted in `design_lines`. Consequently, the Production Batch editor, preview, analysis, saved design, and export all use the customer's recognized font selection without needing a load-time UI correction. No database schema migration is required because `design_lines.font_id` and JSON source metadata already exist.

## Production Batch presentation

The selected design's `Design Text` section shows a compact read-only customer-font list directly beneath the text field. It uses one row per non-empty imported font selection in this exact format:

```text
Line 1 Font: Skywalk
Line 2 Font: Somekind
```

The displayed value is the original normalized customer-facing name, including an unrecognized name. Lines without a customer font selection are omitted. The list is absent for orders with no imported customer-font metadata.

This display reports the customer's input; the existing per-line Font controls continue to report and edit the effective saved design font.

## Shared boundaries

A focused Amazon customer-font module owns:

- Normalizing ordered customer text/font pairs.
- Resolving customer-facing names against workspace fonts.
- Overlaying resolved font ids onto preset-derived line settings without changing other settings.

Both import paths produce the same source metadata shape and use the same overlay behavior. The UI consumes only the sanitized source metadata and does not reparse Amazon customization labels.

## Error and fallback behavior

- Missing font selection: retain the preset font and show no row for that line.
- Unknown font selection: retain the preset font and display the original selection.
- Fewer font selections than text lines: affect only explicitly paired lines.
- Matching customer and preset fonts: retain the existing preset line unchanged while still displaying the customer's selection.
- Additional malformed values: normalize strings safely and ignore non-string or empty values.

## Testing

Unit tests cover:

- Seller Central extraction of `Name Font` and `Title Font` into ordered line metadata.
- ShipStation/Amazon Custom extraction into the same metadata shape.
- Case-insensitive resolution of built-in and workspace font display names.
- Recognized differing fonts overriding only `fontId` after preset application.
- Matching, missing, and unknown fonts retaining preset settings.
- Persistence of the effective font id into design-line rows.
- Rendering the exact `Line N Font: value` UI copy and omitting absent metadata.

An integration-oriented editor test verifies that imported persisted line fonts are selected in the Production Batch line controls while all non-font preset settings remain intact.
