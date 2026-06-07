# Fixed Designs Design

## Overview

Operators need reusable fixed SVG artwork that can be managed once and inserted into badge reel designs alongside normal text lines. The approved design adds a top-level `Fixed Designs` workspace, an `Insert Fixed Design` action in the Production Batch editor's preset ellipsis menu, and fixed SVG control cards inside the design editor.

The core implementation direction is to treat text lines and fixed SVG art as ordered design items. Text items keep the existing font, bridge, stretch, and text-height controls. Fixed SVG items use a different control surface: `SVG Size`, `Horizontal Offset`, and `Vertical Offset From Center`.

## Approved Mockups

- `.superpowers/brainstorm/codex-fixed-designs-1780757273/content/fixed-designs-mockup.html`
- `.superpowers/brainstorm/codex-fixed-designs-1780757273/content/production-batch-fixed-design-mockup.html`
- `.superpowers/brainstorm/codex-fixed-designs-1780757273/content/insert-fixed-design-popup-mockup.html`

## Product Behavior

### Fixed Designs Workspace

The top-level navigation gains `Fixed Designs` after `Size Guides`. The workspace follows the existing production master-detail pattern:

- Left panel: `Upload SVG`, search, and selectable fixed design rows.
- Right panel: selected design preview, details, stored SVG metadata, and an ellipsis menu.
- Selected design ellipsis menu: `Save Design`, `Load New Version`, `Download SVG`, and `Delete`.

`Load New Version` opens a modal. The modal contains explanatory text, a drag/drop upload zone, a `Choose SVG File` button that opens a file selector, `Cancel`, and `Load Version`. Replacement keeps the same fixed design identity but writes a new stored object version.

`Download SVG` downloads the selected stored SVG. `Delete` uses an explicit in-app confirmation and must not silently break saved designs that reference the fixed design.

### Insert Fixed Design Flow

The Production Batch design editor's `Preset` card remains compact: preset selector plus ellipsis button. `Insert Fixed Design` lives in that ellipsis menu with existing layout actions.

Clicking `Insert Fixed Design` opens a modal picker:

- Search/filter controls.
- Left-side fixed design rows using the shared selector-row pattern.
- Right-side selected SVG preview and metadata.
- `Cancel` and `Insert Fixed Design` actions.

Inserting adds a fixed SVG item to the active design's ordered item list. The item appears in the right control rail as `Fixed Design: <NAME>`.

### Fixed SVG Controls

Fixed SVG item cards expose only:

- `SVG Size`
- `Horizontal Offset`
- `Vertical Offset From Center`

They do not expose text controls: Font, Letter Bridge, Line Bridge, Text Height, Horizontal Stretch, Vertical Stretch, or Lock Text Height.

The size guide remains independent of fixed SVGs. Text fitting continues to use the active guide. Fixed SVG art may extend beyond the guide, and operators adjust it manually through size and offsets. Offsets are physical millimeters from the design center.

## Data Model

Use the workspace font implementation as the pattern for fixed SVG storage.

Add a public Supabase table named `fixed_designs`:

- `id text primary key`
- `workspace_id uuid not null references workspaces(id) on delete cascade`
- `display_name text not null`
- `storage_bucket text not null default 'workspace-fixed-designs'`
- `storage_path text not null`
- `public_url text`
- `file_name text not null`
- `version integer not null default 1 check (version > 0)`
- `metadata_json jsonb not null default '{}'::jsonb`
- `deleted_at timestamptz`
- timestamps
- unique workspace/display-name constraint

Create a Supabase Storage bucket named `workspace-fixed-designs`. Store files under:

`workspaces/<workspace-id>/fixed-designs/<fixed-design-id>/v<version>/<file-name>`

Replacement uploads increment `version` and changes `storage_path`/`public_url`.

### Design Items

The existing `design_lines` table is the right persistence boundary because Production Batch saves already delete and rewrite line rows for each changed design. Extend it to support mixed item kinds instead of adding a parallel SVG-only table:

- Add `item_kind text not null default 'text' check (item_kind in ('text', 'fixed_svg'))`.
- Keep `line_index` as the ordered design item index.
- Text rows use existing text/font/bridge/stretch fields.
- Fixed SVG rows set text fields to harmless defaults and populate SVG-specific fields:
  - `fixed_design_id text references fixed_designs(id) on delete set null`
  - `fixed_design_version integer`
  - `svg_size_mm numeric(8, 3) not null default 32 check (svg_size_mm > 0)`
  - `offset_y_mm numeric(8, 3) not null default 0`
  - existing `offset_x_mm` stores horizontal offset in millimeters

Saved designs should retain enough version information to reproduce the inserted design. The initial implementation should use the selected/current fixed design version at insert time. Loading a newer fixed design version updates the library record; a later implementation can add an explicit "update inserted art to latest" workflow if production needs it.

## API

Add `/api/fixed-designs` mirroring `/api/fonts`:

- `GET`: list fixed designs for the authenticated workspace, excluding deleted by default.
- `POST`: create a fixed design from an SVG upload.
- `PUT ?fixedDesignId=`: load a new SVG version for an existing fixed design.
- `DELETE ?fixedDesignId=`: soft-delete the fixed design.

The first implementation should use the stored `public_url` for `Download SVG`, setting the anchor `download` filename from the fixed design display name. If fixed design storage later becomes private, add an authenticated download endpoint as a follow-up.

The store module should validate:

- file is present
- file extension/content type is SVG
- SVG text is parseable enough to confirm it contains an `<svg>` root
- display name is non-empty or derived from file name
- workspace membership is enforced through the existing auth path

## Preview And Export

The live preview renders fixed SVG items together with text lines. Fixed SVG items are positioned from the design center using `offset_x_mm` and `offset_y_mm`, and scaled by `svg_size_mm`.

Geometry/export work should keep SVG paths as vector data. Fixed SVG artwork should be included in final export output and layer preview. The fixed SVG does not participate in text sizing-guide fitting, but it must be included in exported design geometry so laser-cut output matches the operator preview.

Connectedness analysis should continue to focus on text geometry and exported face/backing layers. The implementation should make clear whether fixed SVG artwork contributes to the face layer, backing layer, or both based on the SVG's stored colors/paths. The first production version can preserve the SVG's paths/colors in export rather than trying to infer text bridge behavior from them.

## UI Details

- Add `Fixed Designs` to top navigation and route `/fixed-designs`.
- Selecting a fixed design row updates the URL with its stable id.
- Missing fixed design ids fall back to `/fixed-designs`.
- Fixed design rows use the shared production selector row style.
- Fixed Designs action buttons live behind an ellipsis menu.
- Production Batch preset ellipsis menu includes `Insert Fixed Design`; the menu actions are not permanently visible inside the Preset card.
- Fixed SVG item control cards are visually distinct but restrained, using the same card language as text line controls.

## Error Handling

- Uploading a non-SVG file shows a toast or modal error without changing the selected fixed design.
- Loading a new version fails without changing the old version if upload or database update fails.
- Deleting a fixed design asks for confirmation. If the design is referenced by saved designs, warn that those saved designs retain their existing reference and may need review.
- If an inserted fixed design is missing or deleted, the design editor shows a compact warning in that fixed item card and keeps the saved size/offset controls visible.

## Testing

Unit tests should cover:

- fixed design storage-path generation
- SVG upload validation
- version increment behavior
- mapping fixed SVG design item rows to/from production batch snapshots
- copy/paste layout behavior with mixed text and fixed SVG items

Database tests should cover:

- RLS access by workspace membership
- fixed design create/list/update/delete
- `design_lines` mixed item persistence

E2E tests should cover:

- Fixed Designs page upload/list/select flow
- Load New Version modal shape and replacement behavior
- Insert Fixed Design picker adds `Fixed Design: <NAME>` to the Production Batch editor
- Saved/reloaded production batch retains fixed SVG size and offsets

## Open Decisions

The approved first pass assumes inserted fixed SVGs use the selected library version at insert time. A later workflow may be needed for updating already-inserted SVG items to the newest library version.

The first pass also assumes fixed SVG export preserves stored vector paths/colors. If production requires automatic color-to-layer mapping, that should become a follow-up geometry/export requirement.
