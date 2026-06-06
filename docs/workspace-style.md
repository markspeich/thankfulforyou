# Workspace Style Guide

## Overall Direction

The application should feel like a calm production workspace for repeat Etsy order work. The layout should prioritize scanning, editing, previewing, saving, exporting, and production confidence over decorative presentation.

Use compact, practical controls and quiet surfaces. Avoid marketing-page composition, large hero treatments, decorative illustrations, and explanatory cards that compete with production tasks.

## App Shell

The app uses a persistent left workspace navigation and a right workspace stage.

- The workspace nav is a dark blue vertical rail with compact icon-plus-label buttons.
- The nav supports a collapsed state on desktop; collapsed nav items keep the icon and hide the text label.
- Active nav items use a subtle light overlay, border, and inset highlight. Hover and focus states should stay quiet and readable.
- The current top-level workspaces are `Production Batch`, `Presets`, `Fonts`, and `Size Guides`, with `Logout` anchored at the bottom when available.
- On narrow screens, the nav becomes a horizontal top bar. The collapsed state should not hide labels on narrow screens.

## Workspace Layout

Primary workspaces use a master-detail layout on desktop:

- A left selector/navigation column chooses the item to edit.
- A right editor column shows the selected item's header, actions, and editable body.
- The shared desktop grid is `clamp(320px, 27vw, 520px)` for the left panel and `minmax(0, 1fr)` for the editor.
- The left panel uses the production batch panel language: light `#fbfcfd` background, right border, compact header, optional primary action, short helper text when useful, and a scrollable item list.
- The right panel uses `.editor-panel`: white background, fixed header row, scrollable body when needed, and primary actions in the header.
- On narrow screens, workspace columns stack with the selector above the editor.

The current workspace implementations are:

- `Production Batch`: order queue on the left, selected design editor on the right.
- `Presets`: preset selection on the left, preset editor on the right.
- `Fonts`: font selection on the left, font upload/replacement editor on the right.
- `Size Guides`: saved guide selection on the left, size guide editor on the right.

## Selector Rows

Presets, Fonts, Size Guides, and similar future workspace libraries should use the shared selector-row pattern.

Use these current implementation classes unless the shared pattern is intentionally revised:

- Row container: `.size-preset-row`
- Title: `.size-preset-name`
- Metadata: `.size-preset-meta`
- Selection state: `.is-selected`

Shared selector rows should have:

- White surface.
- `1px` `--line` border.
- `4px` transparent left accent.
- `12px` border radius.
- Compact title using the app body font at the inherited size and `700` weight.
- Muted metadata at `0.86rem`.
- Teal left accent and quiet teal-tinted background on hover and selection.
- Pointer cursor.
- Keyboard activation with Enter or Space.
- Visible focus outline using `--button-focus`.

Do not introduce workspace-specific hover colors, title typography, or card treatments for selector rows unless the shared selector pattern is intentionally changed for every relevant workspace.

## Production Batch Workspace

The `Production Batch` workspace is the primary operating surface.

- The left `orders-panel` contains the batch title, paste/import action, batch tools menu, status counts, search, and order rows.
- The editor is hidden until a design is selected.
- The selected-design header contains `Save`, `Save & Next`, `Cancel`, and a compact tools menu for secondary design actions such as copy/export.
- The editor body is split into a main preview column and a right controls rail.
- The preview column starts with order-level information and then the badge reel preview.
- The preview should remain practical for inspection: visible guide geometry, clear layer distinction, and connection status directly below.
- The controls rail starts with the `Preset` card and then the `Global Settings` card followed by per-line controls.
- `Copy Layout`, `Paste Layout`, `Save as New Preset`, `Overwrite`, `Assign Preset to Listing`, and `Reload preset` live in the `Preset` card menu.

## Editor Structure

Editor headers should carry the page eyebrow where applicable, title, short metadata, and primary actions. Primary actions such as `Save`, `Save & Next`, `Cancel`, `Save Guide`, `Delete Guide`, `Save Preset`, `Delete Preset`, `Upload New Version`, and `Delete Font` belong in the editor header rather than buried inside the form.

Editor bodies should keep fields aligned to a readable max width:

- Preset editor body width: `min(860px, 100%)`.
- Font editor body width: `min(860px, 100%)`.
- Size guide editor body width: `min(760px, 100%)`.

Reusable layout settings should use the same `global-control-card`, `global-controls-panel`, and `line-control-card` language already used in the design editor.

Editor-specific notes:

- Presets use `Preset Library` as the eyebrow and `Preset Editor` as the title.
- Fonts use `Workspace Fonts` as the eyebrow and the selected font name as the title.
- Size Guides use `Production Sizes` as the eyebrow and `Size Guide Editor` as the title.
- Font previews use a framed sample panel. The current preview sample is intentionally large because it shows the selected font, not because it is a marketing hero.
- Size Guide previews use a framed SVG preview panel with max/min boxes, optional circle, and dimension labels.

## Visual Language

Use the existing system tokens:

- Ink: `--ink`
- Muted copy: `--muted`
- Panel borders: `--line`
- General control border: `--border`
- Light panel fill: `#fbfcfd`
- White editor fill: `#fff`
- Shared command button colors from the `--button-*` tokens
- Shared focus ring: `--button-focus`
- Selector accent: `#00807c`

Cards and panels should be restrained. Use cards for actual repeated items, controls, and dialogs. Do not wrap a whole page section in a decorative card when a panel or editor column is the real structure.

## Controls

Use native form controls where they support production speed: selects for option sets, checkboxes for binary settings, range sliders for continuous numeric adjustments, and text or number inputs for explicit values.

Use compact action buttons in headers for primary actions. Use menu popovers for secondary or less frequent actions, especially when a workspace already has several related commands.

## Ellipsis Menus

Workspace ellipsis menus should use the shared `workspace-tools-*` class family so header menus, preset menus, and item-card menus keep one visual language.

- Menu container: `.workspace-tools-menu`
- Toggle: `.workspace-tools-toggle`
- Popover: `.workspace-tools-popover`
- Popover action wrapper: `.workspace-tools-actions`
- Section group: `.workspace-tools-group`
- Section heading: `.workspace-tools-heading`
- Optional helper copy: `.workspace-tools-note`

Menu actions should use the shared command button style with `.batch-tool-button` and a `.batch-tool-label` child. Keep related commands grouped under a concise heading such as `Orders`, `Order Item`, `Layout`, or `Preset`. Avoid one-off menu button, popover, or hover treatments unless the shared ellipsis pattern is intentionally revised for every menu.

Ellipsis menu popovers should be only as wide as their contents require, with enough minimum width to keep the group readable and enough viewport max-width to avoid clipping on narrow screens. Menu action labels should stay on one line when possible; do not make every ellipsis menu a fixed, wide panel when the available commands are short.

Use icon-plus-label buttons for production commands where an icon helps scanning. Existing hand-drawn SVG icons are acceptable in the current app, but new icon work should stay visually consistent with the existing button system.

Preserve the same terminology across workspaces:

- `Preset Library` for choosing reusable layout presets.
- `Preset Name` for the editable preset label.
- `Size Guide` for named bounding-size choices.
- `Guide Name` for the read-only derived size-guide label in the Size Guides editor.
- `Backing Border` for the global backing offset.
- `Global Defaults` for preset-level defaults.
- `Global Settings` for order/design-level settings.
- `Workspace Fonts` for the font editor header context.

## Data And Status Surfaces

Keep production status visible without creating layout noise.

- Batch status counts live in the left production panel.
- Design connectedness status lives below the preview.
- Preset, Font, and Size Guide save/delete/upload feedback uses compact `.note` status text in the editor body.
- Long-running or cross-workspace workflow feedback can use the existing floating batch alert pattern.
- Confirmation dialogs are appropriate for destructive actions, preset assignment confirmation, and batch summaries.

## Feedback

Keep feedback compact and non-disruptive. Use existing notes, status text, confirmation dialogs, and floating toast patterns rather than inserting large new cards into editor layouts.

Status color should remain semantic and restrained:

- Success: green text and pale green background.
- Error: red text and pale red background.
- Pending/neutral: muted text on the surrounding panel background unless a stronger status card is needed.
