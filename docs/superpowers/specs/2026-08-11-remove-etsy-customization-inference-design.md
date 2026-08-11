# Remove Etsy Customization Inference

## Problem

The Etsy API importer currently sets `source.customizationNeeded` whenever it cannot extract text from Etsy personalization variation `property_id = 54`. This treats a valid non-personalized listing as incomplete, so the import completion dialog and Orders workspace incorrectly tell the operator to review it.

An empty Etsy personalization value is not sufficient evidence that customization was expected. The app must not manufacture a production warning from that absence.

## Approved Behavior

- Etsy API imports must preserve extracted personalization responses and design text exactly as they do today.
- Etsy API imports must not set `customizationNeeded` solely because extracted design text is empty.
- A valid Etsy item without personalization must import normally with empty design text and no customization warning.
- Amazon import behavior remains unchanged. Amazon may continue setting `customizationNeeded` from its own customization-document rules.
- The Etsy import completion result keeps its existing `customizationNeeded` numeric field for API/event compatibility, but new Etsy imports report `0` because the Etsy normalizer no longer produces that flag.
- The existing Etsy completion-dialog metric may remain. It will display `Needs review: 0`; removing the metric is outside this focused correction.

## Historical Data Cleanup

Existing `order_items.source_json` values may contain the inferred Etsy flag. Add an additive, checked-in Supabase migration that removes only the top-level `customizationNeeded` key when:

- the key's JSON value is `true`; and
- `source_json.marketplace` is absent or is not `amazon`.

Amazon metadata with `marketplace = 'amazon'` must retain the flag. The migration must preserve every other key in `source_json`, and must not delete or recreate orders, designs, lines, batches, or analysis data.

The missing-marketplace case is intentional: Etsy API records created by the current normalizer do not write a marketplace field, while the Amazon normalizer explicitly writes `marketplace: "amazon"`.

## Components

### Etsy normalizer

`api/_lib/etsy-import-normalizer.js` remains responsible for extracting property `54` responses, separating URL uploads from text, joining text responses into design lines, and returning imported source metadata. It stops emitting `customizationNeeded`.

### Etsy import service and UI

No interface changes are required. `api/_lib/etsy-import-service.js` continues counting truthy `item.source.customizationNeeded` values and emitting the existing completion shape. With the corrected Etsy normalizer, the count is zero. `src/app.js` and `src/orders-workspace.js` keep their existing summary/metric handling.

### Requirements

`docs/requirements.md` must explicitly state that Etsy listings may validly require no personalization, and lack of extracted Etsy personalization must not itself trigger customization review.

## Tests

- Update Etsy normalizer unit coverage so missing, blank, and URL-only personalization all produce empty design text without a `customizationNeeded` property.
- Preserve coverage proving normal personalized Etsy text still imports correctly.
- Add migration verification that the SQL removes the flag from legacy Etsy-shaped metadata, preserves all other JSON keys, and leaves Amazon flags intact. Use the repository's existing migration/database-test conventions.
- Run the focused Etsy normalizer and import-service unit tests, the migration/database test selected by repository convention, and the broader unit suite if practical.

## Migration Safety

The migration is additive in deployment terms and performs a narrowly scoped data correction. It is not destructive to order or design records. Applying it to production is a separate deployment action governed by the repository workflow; implementation alone checks in and locally verifies the migration.

## Non-goals

- Inferring whether an Etsy listing configuration requires personalization from listing schema or UI settings.
- Introducing a new manual-review state.
- Changing Amazon customization detection.
- Removing the general Orders-workspace customization warning component.
- Automatically applying the migration to production during ordinary implementation.
