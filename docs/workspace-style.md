# Workspace Style Guide

## Overall Direction

The application should feel like a calm production workspace for repeat Etsy order work. The layout should prioritize scanning, editing, previewing, saving, and exporting over decorative presentation.

Use compact, practical controls and quiet surfaces. Avoid marketing-page composition, large hero treatments, decorative illustrations, and explanatory cards that compete with production tasks.

## Workspace Layout

Primary workspaces should use a master-detail layout on desktop:

- A left selection/navigation column for choosing the item to edit.
- A right editor column for viewing and editing the selected item.
- The left column should use the same panel language as the production batch order list: light background, right border, compact header, optional primary creation action, and scrollable item selection.
- The right column should use the editor-panel language: header at top, primary actions in the header, and editable fields below.
- Selection inside the left column should use row-based choices, not visible dropdowns. Rows should follow the size-guide row pattern: white surface, subtle border, 4px left accent that turns teal on hover and selection, compact title, muted metadata, pointer cursor, and keyboard activation with Enter or Space.

The current reference implementations are:

- `Production Batch`: order queue on the left, selected design editor on the right.
- `Size Guides`: saved guide selection on the left, size guide editor on the right.
- `Presets`: preset selection on the left, preset editor on the right.

On narrow screens, the columns may stack with the selector above the editor.

## Editor Structure

Editor headers should carry the page eyebrow, title, short metadata, and primary actions. Primary actions such as `Save`, `Save & Next`, `Export`, `Save Guide`, `Delete Guide`, `Save Preset`, and `Delete Preset` belong in the editor header rather than buried inside the form.

Editor bodies should keep fields aligned to a readable max width. Reusable settings should use the same global-control and line-control card language already used in the design editor.

## Visual Language

Use the existing system tokens:

- Ink: `--ink`
- Muted copy: `--muted`
- Panel borders: `--line`
- Light panel fill: `#fbfcfd`
- White editor fill: `#fff`
- Shared command button colors from the `--button-*` tokens

Cards and panels should be restrained. Use cards for actual repeated items, controls, and dialogs. Do not wrap a whole page section in a decorative card when a panel or editor column is the real structure.

## Controls

Use native form controls where they support production speed: selects for option sets, checkboxes for binary settings, range sliders for continuous numeric adjustments, and text or number inputs for explicit values.

Preserve the same terminology across workspaces:

- `Preset Library` for choosing reusable layout presets.
- `Preset Name` for the editable preset label.
- `Size Guide` for named bounding-size choices.
- `Backing Border` for the global backing offset.
- `Global Defaults` for preset-level defaults.

## Feedback

Keep feedback compact and non-disruptive. Use existing notes, status text, confirmation dialogs, and floating toast patterns rather than inserting large new cards into editor layouts.
