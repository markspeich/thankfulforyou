# Bounding Border Size Presets Design

## Goal

Support multiple badge reel bounding-border size presets instead of treating the current 2.2 inch by 1.5 inch guide as the only layout target. Each size preset defines a maximum rectangle for text fitting and a minimum rectangle for visual design checking. The selected size is a global layout setting, saved in reusable presets and restored with queued designs.

## Scope

This design covers:

- a reusable bounding-border size preset model
- default backwards-compatible 2.2 inch by 1.5 inch behavior
- preset schema and runtime registry changes
- order settings, shared queue, layout-copy, and signature persistence
- size-aware layout fitting and locked-line overflow behavior
- preview rendering for maximum and minimum rectangles
- a `Global Settings` size preset control
- a dedicated size-preset section in the existing `Presets` workspace

This design does not cover:

- enforcing a maximum finished backing silhouette size
- changing the SVG export layout format
- per-listing size-preset overrides outside normal preset selection
- automatic selection of size from Etsy listing metadata

## Product Intent

The current guide is doing two jobs: it gives operators a visual badge reel target, and it acts as the hard text-fitting envelope for automatic scaling. Production needs more than one envelope, but those envelopes should stay operator-friendly and preset-driven. Operators should choose a named size preset in `Global Settings`; layout presets should remember that choice so a listing or reusable layout comes back with the right production target.

The maximum rectangle remains the fit target for the text layer. The backing border can extend beyond it, as it does today. The minimum rectangle is initially a visual guide that tells the operator whether the design is using enough of the intended production area. The app should not block export for being smaller than the minimum until the shop confirms whether that should be a warning or a hard rule.

## User-Facing Behavior

### Order Editor

The `Global Settings` card gains a `Size` or `Bounding Size` select control near the top, before stretch and backing-border controls. It defaults to the current production size:

- label: `2.2 x 1.5 in`
- maximum rectangle: 2.2 inches wide by 1.5 inches tall
- minimum rectangle: initially the same as the current inner reference rectangle, 1.6 inches wide by 1.1 inches tall

Changing the size preset immediately:

- recomputes the preview layout
- updates the preview guide labels and rectangles
- invalidates completed/export-ready cached geometry for the active design
- saves as part of the design's global layout settings

### Preview

The preview shows:

- the active maximum rectangle in the existing blue guide style
- the active minimum rectangle in the same guide family, centered inside the maximum rectangle
- the existing 1.25 inch center circle, centered in the maximum rectangle
- dimension labels derived from the active maximum rectangle

The design remains centered within the maximum rectangle by visible text bounds, not backing bounds.

### Preset Editor

Layout presets save the selected size by id in `globalDefaults`. The existing preset editor should expose the selected size as part of preset global defaults.

The `Presets` workspace also gets a dedicated `Size Presets` section or page. This is separate from ordinary layout preset editing because size presets are reusable production definitions, not one-off per-layout controls. The first implementation can keep size definitions bundled in code or JSON, but the UI shape should make room for later add/edit flows.

## Data Model

Create a size preset definition shape:

```javascript
{
  id: "size-2-2x1-5",
  name: "2.2 x 1.5 in",
  max: {
    widthIn: 2.2,
    heightIn: 1.5
  },
  min: {
    widthIn: 1.6,
    heightIn: 1.1
  }
}
```

Runtime code should resolve this into millimeters:

```javascript
{
  id: "size-2-2x1-5",
  name: "2.2 x 1.5 in",
  maxWidthMm: 55.88,
  maxHeightMm: 38.1,
  minWidthMm: 40.64,
  minHeightMm: 27.94
}
```

Add `boundingSizePresetId` to global layout settings:

```javascript
{
  presetId: "preset-a1f4c8e2b601",
  boundingSizePresetId: "size-2-2x1-5",
  backingMm: 3.1,
  weldExportedDesign: true,
  lines: []
}
```

Add `boundingSizePresetId` to preset `globalDefaults`:

```json
{
  "globalDefaults": {
    "boundingSizePresetId": "size-2-2x1-5",
    "backingMm": 3.1,
    "weldExportedDesign": true
  }
}
```

Missing or invalid `boundingSizePresetId` values must fall back to `size-2-2x1-5` so old queued designs and existing preset files keep their current behavior.

## Architecture

### Size Preset Module

Add a focused module, `src/bounding-size-presets.js`, responsible for:

- defining bundled size presets
- exposing the default size preset id
- validating size preset ids
- resolving a size preset to millimeter dimensions
- exposing options for UI selects

This keeps size definitions out of layout math and avoids scattering magic inch values through `src/app.js`.

### Layout Math

Update layout math functions to accept a guide context instead of using fixed constants internally. The default guide context should resolve to the current 2.2 inch by 1.5 inch behavior so existing callers and tests can migrate incrementally.

Primary changes:

- `computeTextFitScale(textWidthMm, textHeightMm, guide = DEFAULT_GUIDE)`
- `computeMixedFitScale(lines, guide = DEFAULT_GUIDE)`
- `computeMixedScaleBounds(lines, lineScaleFactors, guide = DEFAULT_GUIDE)`
- `computeGuideOverflow(lines, textWidthMm, textHeightMm, guide = DEFAULT_GUIDE)`
- `computePreviewFrame(layout, textBoundsMm, guide = layout.guide)`

Layout objects should carry the resolved guide data used to build them:

```javascript
{
  guide: {
    sizePresetId: "size-2-2x1-5",
    maxWidthMm: 55.88,
    maxHeightMm: 38.1,
    minWidthMm: 40.64,
    minHeightMm: 27.94
  }
}
```

### App State And Persistence

`normalizeSettings` should populate `boundingSizePresetId` from the order settings, then from the selected layout preset's `globalDefaults`, then from the default size preset.

The field must participate in:

- settings signatures
- layout-control copy/paste
- saved queue snapshots
- shared queue snapshots
- preset inference
- preset editor global defaults

Completed/export-ready cached builds should be invalidated when the size changes because the fit scale and final letter positions may change.

### Preview Rendering

Replace fixed preview-guide constants in `src/app.js` with values from the layout guide. The guide-only empty state should resolve the active order's current size when an order is selected and fall back to the default size when no order is active.

The existing inner reference lines should be replaced by the active minimum rectangle. To preserve the current look for the default size, the default minimum rectangle should produce the same 1.6 inch by 1.1 inch inset guide.

### Preset Workspace

The first pass should add a visible `Size Presets` area in the existing `Presets` workspace. It can list bundled definitions and show each preset's min/max rectangles in text. Editing custom size presets can be a follow-up unless the implementation effort is small, because the immediate production need is choosing among known shop sizes and saving that choice in layout presets.

## Error Handling

- Unknown size ids fall back to the default size.
- Invalid size definitions are ignored by the registry and should not appear in UI options.
- If a layout preset references an unknown size id, the UI should display the default size and saving that preset should write the resolved default id.
- If the selected size makes locked lines overflow, preserve locked text height and show the existing overflow warning with dynamic dimensions.
- The minimum rectangle is advisory in this pass. It should not block save, complete, analysis, or export.

## Testing Strategy

Add unit tests for:

- size preset option and default resolution
- invalid size id fallback
- preset schema acceptance of `boundingSizePresetId`
- preset global defaults carrying `boundingSizePresetId`
- preset inference from current settings
- layout-control copy/paste preserving the size id
- settings signatures changing when size id changes
- layout fitting against a smaller and larger guide
- mixed locked-line overflow against custom guide dimensions
- preview-frame centering against custom guide dimensions

Add Playwright coverage for:

- `Global Settings` exposes a size preset control
- changing size updates preview dimension labels
- changing size changes the geometry fit envelope
- saving a layout preset preserves selected size
- reloading a preset restores selected size
- the `Presets` workspace exposes a `Size Presets` section

## Implementation Notes

- Keep inches at the size-preset boundary and millimeters inside layout/math/rendering.
- Use `boundingSizePresetId` rather than storing dimensions directly on each order. This keeps saved data stable if the shop later refines the display name or adds metadata.
- Keep default constants exported during migration if tests or callers still import them, but derive them from the default size preset rather than hand-entered numbers.
- Do not send guide dimensions to the Python export path unless export begins enforcing guide metadata. The current SVG export operates from already fitted letter positions and physical layout dimensions.

## Open Decisions

- Confirm the first non-default production size presets and their min/max dimensions.
- Decide whether future minimum rectangle behavior should warn, block completion, or remain visual-only.
- Decide whether custom size-preset authoring should ship with this pass or follow after bundled definitions prove the workflow.

## Self-Review

- Placeholder scan: no placeholder text remains.
- Consistency check: `boundingSizePresetId` is the single persisted global setting name throughout the design.
- Scope check: this is one coherent feature spanning model, math, preview, and preset persistence. Custom size authoring is intentionally left as a later option.
- Ambiguity check: the minimum rectangle is explicitly advisory-only for this pass.
