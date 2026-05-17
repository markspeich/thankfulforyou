# Line Text Height Lock Design

## Summary

Add a per-line `Lock Text Height` setting so an operator can preserve a line's authored text height in millimeters even when the overall design is automatically resized to fit within the 2.2 inch by 1.5 inch text guide.

This change is intended for production cases where one line must remain at a fixed physical size for manufacturing or style reasons while other lines may flex to satisfy the guide box.

## Goals

- Preserve a locked line's authored `Text Height` during automatic boundary-fit resizing.
- Continue allowing unlocked lines to scale up or down to use the guide box well.
- Keep `Vertical Stretch`, overlap analysis, preview, connectedness checks, and SVG export aligned with the same final geometry.
- Persist the lock state in saved orders and reusable presets.

## Non-Goals

- Locking the final rendered height after `Vertical Stretch`.
- Adding per-character or per-glyph scaling rules.
- Preventing manual edits to `Text Height` while a line is locked.
- Forcing guide-box compliance when locked content intentionally overflows.

## Approved Product Decisions

- `Lock Text Height` applies only to authored `Text Height`.
- `Vertical Stretch` remains editable and continues to change the final rendered geometry while locked.
- Manual edits to `Text Height` remain allowed while locked.
- If locked lines prevent a full fit, the design may overflow the text guide and should not silently break the lock.
- The lock state must be stored in both order data and preset definitions.

## Current Baseline

The current layout pipeline computes one global fit scale from the total text bounds and applies that scale to every line equally. That is simple, but it means one line cannot keep a fixed physical text height while neighboring lines continue to auto-fit.

## Recommended Approach

Use a per-line auto-fit policy in the geometry pipeline.

Each line keeps one authored `fontSizeMm` value and gains a boolean `lockTextHeight` flag. The fit step should no longer behave as a single all-or-nothing multiplier applied to every line. Instead, the pipeline should calculate final geometry using mixed scaling:

- Locked lines keep their authored `fontSizeMm`.
- Unlocked lines apply the shared fit scale.
- Shared placement, bounds, preview, connectedness analysis, and export continue using one final assembled geometry model.

This keeps the geometry-first model honest and avoids introducing a preview-only exception path.

## Behavior Design

Each text line gains a boolean `lockTextHeight` setting:

- `false`: the line behaves like current production behavior and participates in automatic fit scaling.
- `true`: the line preserves its authored `Text Height` in millimeters during automatic fit scaling.

The lock affects only automatic fit scaling. It does not freeze:

- `Vertical Stretch`
- `Horizontal Offset`
- `Letter Bridge`
- `Line Bridge`
- manual edits to `Text Height`

If a locked line makes the total composed design wider or taller than the text guide, the final layout may overflow that guide. The application should preserve the locked physical text height and surface a fit warning instead of silently shrinking the locked line.

## Geometry And Layout Design

### Stored Data

Per-line settings should include:

- `fontId`
- `bridgeMm`
- `lineBridgeMm`
- `offsetXMm`
- `fontSizeMm`
- `verticalScale`
- `lockTextHeight`

`fontSizeMm` remains the authored physical size for the line. The lock state controls how that authored size is transformed during fit.

### Fit Algorithm

The updated fit flow should be:

1. Build line geometry from authored settings.
2. Measure authored bounds and determine the best shared fit scale for unlocked lines.
3. Rebuild or re-measure final line geometry with mixed scaling:
   - locked lines use scale `1` for authored text height
   - unlocked lines use the computed fit scale
4. Measure the final assembled bounds used for preview, analysis, warning state, and export.

This produces one consistent final geometry instead of separate authored and preview-only models.

### Overflow Handling

Guide-box overflow is allowed when locked lines prevent a full fit. Overflow should be observable in both preview framing and status reporting. Export should preserve the actual mixed-scale geometry rather than attempting a last-second safety shrink.

## UI Design

Each per-line control group should gain a `Lock Text Height` toggle positioned with the existing size controls. The `Text Height` control remains active while locked because the lock protects against automatic fit scaling, not deliberate operator changes.

The editor should present fit overflow separately from connectedness status so an operator can distinguish:

- "The design overflows the text guide because of locked size choices"
- "The text geometry is not connected as one piece"

## Data And Preset Design

The lock state should be treated as a first-class per-line field across:

- runtime normalization defaults
- queue persistence
- imported/restored order settings
- preset schema
- preset JSON documents
- preset application logic

Preset ids must remain stable. The addition of `lockTextHeight` should be backward-compatible so existing saved data can default missing values to `false`.

## Testing Design

### Unit Tests

Add layout math coverage for:

- fully unlocked designs continuing to fit like current behavior
- locked lines preserving authored `fontSizeMm`
- mixed locked and unlocked layouts where only unlocked lines scale
- intentional overflow when locked lines alone exceed the guide
- bounds measurement based on final mixed-scale geometry

Add normalization and preset coverage for:

- missing `lockTextHeight` defaulting to `false`
- saved order round-trips preserving `lockTextHeight`
- preset loading and application preserving `lockTextHeight`

### UI And Integration Tests

Add focused editor coverage for:

- rendering one `Lock Text Height` control per editable line
- keeping `Text Height` editable while locked
- showing overflow feedback when locked content prevents fit
- preserving the lock state across save, restore, and preset application

## Risks

- The current layout code may assume one global fit scale in more places than the initial math helper suggests.
- Mixed-scale line measurement can affect centering and line-to-line placement if re-measurement is incomplete.
- Status UI may need a clearer distinction between connectedness warnings and fit warnings to avoid operator confusion.

## Implementation Notes For Planning

- Keep the geometry rule in shared layout logic rather than making the UI fake a lock visually.
- Favor small, well-tested helper extraction in layout math before threading the new flag through export and persistence.
- Preserve backward compatibility for existing queue data and preset files by defaulting absent lock values to `false`.
