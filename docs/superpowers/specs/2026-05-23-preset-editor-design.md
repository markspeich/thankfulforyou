# Preset Editor Design

## Goal

Add a top-level left navigation bar that switches between the current order-editing workspace and a new preset-authoring workspace, while allowing operators to create reusable presets from the current layout, edit existing presets in place, and manage preset-to-listing assignments without leaving the app.

## Scope

This design covers:

- the new collapsible app-level left navigation
- the `Order Items` workspace shell around the current design queue and design editor
- the new `Presets` workspace
- preset creation from the current design editor state
- in-place editing of existing preset JSON definitions
- listing assignment creation from the design editor
- listing assignment visibility and removal from the preset editor

This design does not cover:

- freeform raw JSON editing in the UI
- bulk listing-assignment editing beyond unassigning existing rows
- new geometry behavior
- new export behavior

## Product Intent

The app is moving from a fixed set of production presets toward operator-maintained preset definitions. Presets should still behave like reusable production templates rather than one-off saved designs. That means the editor needs to work in terms of preset defaults and reusable line rules, not copied order text or frozen per-order snapshots.

The new navigation should make preset work feel like a parallel production activity rather than an advanced submenu hidden inside the order editor. Operators should be able to move between active order work and preset maintenance without losing the calm, practical workspace feel of the current app.

## User-Facing Behavior

### Left Navigation

The app gains a left navigation bar that sits outside the current production queue layout. It has:

- an `Order Items` destination with an order/work icon
- a `Presets` destination with a sliders/template icon
- a collapse toggle

Expanded mode shows icon plus label. Collapsed mode shows icon only, while keeping accessible names and hover titles. Navigation switches the active workspace in place without leaving the page.

### Order Items Workspace

`Order Items` continues to show the existing production queue and selected-order editor. This workspace remains the default landing view for the current production workflow.

The design editor adds two preset-related actions:

- `Save as New Preset` above the existing `Presets` control card
- `Assign Preset to Listing` when the active order has an imported Etsy listing id

`Save as New Preset` captures the active layout controls, infers reusable preset structure, and opens the `Presets` workspace with a new draft ready for naming and saving.

`Assign Preset to Listing` adds or updates a listing assignment on the currently selected preset definition using the active order's Etsy listing id and listing title when available.

### Presets Workspace

`Presets` opens a dedicated preset editor that lets the operator:

- choose an existing preset
- start a new preset
- edit preset name, id, and optional description
- edit preset global defaults
- edit reusable rule-based line settings
- review assigned Etsy listings
- unassign listings one at a time
- save changes back to the selected preset definition in place

The editor should use the same practical cards, sliders, toggles, and dropdowns as the order editor wherever possible so preset authoring feels familiar and production-oriented.

## Preset Modeling

Preset definitions remain schema-driven JSON files referenced by `public/presets/manifest.json`.

The preset editor should operate on the existing schema concepts:

- `globalDefaults`
- `lineDefaults`
- `lineRules`
- `listingAssignments`

The UI should not expose raw schema terminology everywhere, but the data model should round-trip cleanly to that structure.

### Save As New Preset Inference

Creating a new preset from the order editor should infer reusable rules from the current line settings.

Inference rules:

1. Start from the current editor's global settings and per-line settings.
2. Derive `globalDefaults` from current backing border and weld-export settings.
3. For line settings, calculate which fields are identical across all lines.
   Those become `lineDefaults`.
4. If the first line differs from `lineDefaults`, place those differences in a `first` rule.
5. If every line after the first shares the same override relative to `lineDefaults`, place those differences in a `remaining` rule.
6. Any remaining line-specific differences become `index` rules.
7. Do not include order text, buyer data, listing quantity, completed status, cached analysis, or export artifacts.

This keeps saved presets reusable across future designs with different text lengths and line counts.

## Workspace Architecture

### App Shell

The app shell becomes:

- left nav rail
- active workspace region

The active workspace region renders either:

- the existing production queue/editor workspace for `Order Items`
- the new preset-authoring workspace for `Presets`

The current orders panel and editor panel stay together inside the `Order Items` workspace so existing behavior and layout can be preserved with minimal disruption.

### Preset Store Layer

Preset data should move behind a dedicated store/module responsible for:

- loading manifest and preset files
- exposing preset options and resolved preset definitions
- creating new preset drafts
- updating existing preset definitions
- adding manifest entries for new presets
- assigning listings to presets
- unassigning listings from presets
- serializing schema-valid output

The existing read-oriented preset utilities can either be expanded into that store or wrapped by a new authoring-focused module, but the result should give the UI a single place to manage runtime preset state and authored changes.

## Preset Editor UI Structure

The preset editor should mirror the rhythm of the current order editor rather than inventing a separate design language.

Suggested structure:

- header with workspace title, selected preset label, `New Preset`, and `Save`
- main content area with two columns on desktop
- left column for preset metadata, assigned listings, and a small reusable preview summary
- right column for global controls and line-rule control cards

The reusable line settings should be rendered through cards for:

- `Line Defaults`
- `First Line`
- `Remaining Lines`
- exact `Line N` override cards for any `index` rules

Each card should use the same kinds of fields already present in the design editor:

- Font
- Letter Bridge
- Line Bridge where relevant
- Horizontal Offset
- Text Height
- Horizontal Stretch
- Vertical Stretch
- Lock Text Height

For `Line Defaults`, `Line Bridge` can remain available in the underlying model but should be presented carefully because it only matters on non-first lines. The UI should avoid confusing operators into thinking every field affects every line in the same way.

## Listing Assignment Behavior

### Assignment Creation

The order editor owns assignment creation because it has the active Etsy listing context.

When `Assign Preset to Listing` is clicked:

- the current order must have an imported listing id
- the currently selected preset id is used as the destination preset
- an assignment row is created or updated on that preset definition
- the assignment should store the listing id and listing title when available

The action should also mark the selected order as manually aligned with that preset so future preset reloads remain predictable.

### Assignment Removal

The preset editor shows all listing assignments for the selected preset and allows removing them one at a time. Unassigning a listing removes only that mapping row. It should not delete the preset or change any other preset settings.

## Error Handling

- Creating a new preset requires a non-empty name and a unique stable preset id.
- Saving an edited preset should fail gracefully if the id is empty or collides with another preset.
- Assigning a listing should fail gracefully when there is no imported listing id on the active order.
- If preset persistence cannot complete, the UI should keep the draft changes in memory and show a practical error state instead of silently discarding edits.
- If a preset referenced by a queue item is deleted or invalid, the runtime should continue to fall back to the default preset as it does today.

## Testing Strategy

Add automated coverage for:

- workspace navigation state switching
- nav collapse and expanded rendering state
- preset inference from current editor settings
- creation of new preset definitions and manifest registration
- in-place update of existing preset definitions
- assignment of the current listing to the selected preset
- removal of a listing assignment from a preset
- round-trip generation of line defaults, `first`, `remaining`, and `index` rules
- preservation of existing preset runtime behavior for queue items and listing-based auto-selection

UI tests should confirm that the `Order Items` workspace still behaves like the current screen and that the preset editor exposes the expected controls and assignment list.

## Files Likely To Change

- `index.html`
- `src/app.js`
- `src/styles.css`
- `src/presets.js` or a new preset authoring module beside it
- `tests/unit/presets.test.js`
- new unit tests for preset inference and authoring behaviors
- `docs/requirements.md`

If persistence needs a separate API or filesystem-backed path later, that can be added in a follow-up. For this pass, the UI and preset-authoring model should be designed so persistence concerns stay isolated from layout rendering logic.

## Assumptions

- Preset editing in this phase targets the app's schema-based preset definitions rather than raw text files edited manually by the operator.
- The first preset-editor version supports unassigning listings but not editing arbitrary per-listing line overrides in the UI.
- The current preset selection model remains compatible with queue items and imported Etsy listing auto-selection.
- The left nav uses only two items for now, but the shell should not block future workspace additions.
