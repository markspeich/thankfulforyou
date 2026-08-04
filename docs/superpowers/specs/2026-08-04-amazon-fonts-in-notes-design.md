# Amazon Fonts in Notes Design

## Problem

Amazon v3 customization documents attach a `fontFamily` to each text area. The importer correctly stores those values in `customerFontSelections`, but Notes to Buyer is built only from `personalizationResponses`, so the font selections are omitted.

## Design

At the note-generation boundary, pair each imported text line with its parsed font selection and append a note field named `<text label> Font`. For the current order, the generated fields are `Name Font: Skywalk` and `Title Font: Somekind`. Keep `customerFontSelections` and design enrichment unchanged, do not modify raw customization parsing, and do not synthesize a font field when either the line label or selection is missing.

## Verification

Add a service regression test using the live Amazon v3 shape: text areas named `Name` and `Title` with `fontFamily` values. Prove the generated ShipStation note contains both font lines. Then run focused and full unit tests, build, and a live local check that retrieves the single pending Amazon shipment, generates the note through the production normalizer and note builder, updates ShipStation with its existing items, and re-fetches it to verify both font lines persisted.

