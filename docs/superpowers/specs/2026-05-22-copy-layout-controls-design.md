# Copy Layout Controls Design

## Summary

Add a layout-controls-only copy/paste workflow so operators can reuse one design's layout settings on another queued design without copying the order text or Etsy order metadata.

This is aimed at duplicate-order production work where several queue items share the same visual treatment but still need to preserve their own personalization text and order identity.

## Goals

- Make it fast to reuse one design's layout settings on another queued design.
- Keep copied state limited to layout controls rather than order content.
- Reuse the existing floating bottom-center alert pattern for copy/paste feedback.
- Preserve the current queue model where pasted designs must be completed again before export-ready analysis is trusted.

## Non-Goals

- Copying order text.
- Copying buyer, listing, quantity, or import metadata.
- Copying completion state, cached analysis, or saved export output.
- Introducing a new notification style for lightweight workflow feedback.

## Approved Product Decisions

- The workflow uses explicit `Copy Layout Controls` and `Paste Layout Controls` actions.
- The source design is the currently selected design when `Copy Layout Controls` is clicked.
- The target design is the currently selected design when `Paste Layout Controls` is clicked.
- `Paste Layout Controls` is available only when a copied source exists and the target is not the same design.
- When source and target have different line counts, settings apply only to matching line indexes and unmatched target lines remain unchanged.
- Copy/paste feedback and similar future short workflow alerts should reuse the same floating bottom-center alert technique used by the import status toast.

## Current Baseline

The queue/editor already supports copying exported SVG output, queue-wide actions, and production presets, but it does not yet support copying a design's live layout settings from one queue item to another.

The app also already has a floating alert pattern via `updateImportStatus(...)` and the `.queue-alert` presentation, which provides a clean precedent for short operator-facing feedback.

## Recommended Approach

Store one in-memory copied-layout snapshot in the browser app state. That snapshot should hold only the normalized layout settings needed to reapply operator adjustments to another design. The selected-order header exposes `Copy Layout Controls` to populate that snapshot and `Paste Layout Controls` to apply it to another selected order.

This approach is intentionally session-scoped and lightweight. It avoids queue-row button clutter, avoids introducing a file-backed preset concept for one-off duplicates, and keeps the interaction aligned with familiar copy/paste behavior.

## Behavior Design

### Copy

When the operator clicks `Copy Layout Controls`:

- Read the active order's normalized layout settings.
- Save a copied-layout snapshot in app state.
- Record enough source context for feedback, such as the source order id or displayed order number.
- Show a floating success alert such as `Layout controls copied from Order 1042.`

### Paste

When the operator clicks `Paste Layout Controls` on another selected design:

- Verify a copied-layout snapshot exists.
- Verify the target design is different from the copied source design.
- Apply copied layout settings to the current target design according to the field rules below.
- Clear any completed/export-ready cached state for the target design.
- Mark the target design as changed so it must be completed again.
- Show a floating success alert.

If source and target line counts differ, the success alert should mention the partial application clearly, for example `Applied layout controls to 2 matching lines.`

### Copied Fields

The copied snapshot should include:

- `presetId`
- `backingMm`
- `weldExportedDesign`
- global horizontal stretch
- global vertical stretch
- per-line `fontId`
- per-line `bridgeMm`
- per-line `lineBridgeMm`
- per-line `offsetXMm`
- per-line `fontSizeMm`
- per-line horizontal stretch
- per-line vertical stretch
- per-line `lockTextHeight`

### Excluded Fields

The copied snapshot must not include:

- order text
- quantity
- buyer metadata
- listing metadata
- source/import metadata
- completion state
- cached analysis results
- saved export payloads

### Line Count Mismatch Rules

- Source line 1 applies to target line 1, source line 2 to target line 2, and so on.
- If the target has fewer lines than the source, extra source lines are ignored.
- If the target has more lines than the source, unmatched target lines keep their existing settings.

This keeps paste behavior predictable and avoids silently changing lines the operator did not explicitly map.

## UI Design

### Action Placement

Place `Copy Layout Controls` and `Paste Layout Controls` in the selected-order header action area, alongside the existing order-level actions. The copy action should be available whenever a selected design has layout settings. The paste action should be disabled when no copied snapshot exists or when the selected design is the copied source.

### Alert Pattern

Use the same bottom-center floating alert technique currently used for clipboard import status:

- same positioning
- same auto-hide behavior
- same state styling model for success, pending, or error

This alert path should become the shared lightweight workflow-feedback pattern for similar future actions rather than a one-off import-only helper.

## Data Design

The copied-layout snapshot should live only in browser session state for now. It does not need to persist to saved queue snapshots, remote queue storage, or preset files.

The snapshot should be built from normalized settings so paste applies a clean canonical shape instead of replaying raw DOM values.

## Error Handling

- If the operator tries to paste without a copied snapshot, keep the action disabled where possible rather than surfacing an avoidable error.
- If a paste fails unexpectedly, show an error alert using the same floating alert pattern.
- If the target order is deleted after copy, the copied snapshot can still remain valid because only the normalized copied settings are needed for paste.

## Testing Design

### UI And Interaction Tests

Add coverage for:

- copying layout controls from the active design
- enabling paste only after a copy exists
- preventing paste onto the same design
- pasting layout controls onto a different selected design
- preserving target order text and metadata after paste
- clearing completed/export-ready state after paste
- showing the shared floating alert on copy and paste success
- showing partial-application messaging when line counts differ

### State And Normalization Tests

Add focused coverage for:

- snapshot contents including only allowed fields
- line-by-line application behavior with differing line counts
- excluded fields remaining unchanged on the target order

## Risks

- The current settings model may mix global and per-line stretch values in ways that need careful normalization before snapshotting.
- Paste must invalidate any saved completed/export state thoroughly so stale analysis cannot be mistaken for the pasted layout.
- Reusing `updateImportStatus(...)` directly may create naming pressure if the helper becomes the shared alert path; a small rename or extraction may be warranted during implementation.

## Implementation Notes For Planning

- Favor extracting the current import alert helper into a more general shared workflow-alert helper rather than duplicating toast logic.
- Keep the copied snapshot logic separate from preset storage because this feature is order-to-order reuse, not reusable preset authoring.
- Apply pasted settings through the same normalization/update path used by other editor mutations so dirty-state and re-render behavior stay consistent.
