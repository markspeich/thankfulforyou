# Etsy Customer Font Selection Design

## Goal

Import Etsy font-selection dropdown responses as per-line layout settings instead of design text while preserving legitimate personalization dropdown text.

## Observed API Contract

Order `4142168158`, transaction `5174720728`, returned two `property_id: 54` variations:

- `Personalization` with `formatted_value: "CPL EDWARDS"`, `value_id: null`, and its own `question_id`.
- `Font Choice` with `formatted_value: "Candlepin"`, a non-null numeric `value_id`, and a different `question_id`.

The current normalizer treats every non-file `property_id: 54` value as design text, producing an erroneous second line.

## Classification

A variation is a customer font selection only when all of these conditions hold:

- `property_id` normalizes to `54`.
- `formatted_name` contains the standalone word `font`, case-insensitively.
- `value_id` is non-null and non-empty, identifying a dropdown selection.
- `formatted_value` is non-empty and is not a URL.

This deliberately does not classify free-text questions containing `font`, and it does not classify unrelated dropdown questions such as `Badge Choice`.

## Line Association

Font selections use the existing `customerFontSelections` contract: `{ lineIndex, name }`.

Selections are paired ordinally with accepted non-font text responses. The first font selection applies to line 0, the second to line 1, and so on. Selections without a corresponding text line are ignored rather than creating empty lines.

## Import and Persistence

The Etsy normalizer will:

- Exclude classified font selections from `design.text`.
- Add classified selections to `source.customerFontSelections`.
- Retain every raw normalized variation in `source.variations` for diagnosis.
- Retain non-font personalization dropdown values as design text.

The Etsy import route/service will enrich normalized items using the existing preset and workspace-font enrichment behavior already used for Amazon. Recognized customer-facing font names override the corresponding preset line's `fontId` before `design_lines` are persisted. Unknown names remain in source metadata and leave preset fonts unchanged.

No schema migration is required because `source_json`, imported settings, and `design_lines.font_id` already support this data.

## Error Handling

Malformed, empty, URL-valued, or unmatched font responses do not override layout settings. Import continues using the listing preset and records raw variations. Existing idempotent-import rules continue to protect saved designs from overwrite.

## Verification

Automated coverage will include:

- The captured `CPL EDWARDS` plus `Font Choice: Candlepin` payload.
- An unrelated property-54 dropdown retained as design text.
- A free-text question containing `font` retained as design text.
- URL and empty values ignored as font selections.
- Multiple text/font pairs mapped by line index.
- Unknown font names preserved without overriding preset fonts.
- Etsy service enrichment occurring before persistence.
- Etsy API route loading workspace fonts and preset data for enrichment.

The temporary raw-transaction diagnostic will be removed after the behavior is verified.
