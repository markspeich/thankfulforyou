# Preserve Etsy Font Overrides Design

## Goal

Preserve every numbered Etsy font selection independently of the currently parsed design text so a selection for a future line remains available and is applied when that line exists.

## Import Contract

The Etsy normalizer continues classifying numbered font dropdowns by their explicit `Line N` labels. It stores every valid numbered selection in `source.customerFontSelections`, including selections whose zero-based `lineIndex` is beyond the current parsed design-line count.

Diagnostics distinguish selections that currently pair with text from selections stored for a line that does not yet exist. An absent text line does not discard or renumber a selection.

The importer must not synthesize blank design lines and must not interpret repeated spaces as line separators. Text-line parsing remains newline-based because repeated spaces can be legitimate customer text.

## Font Aliases

Customer-font resolution supports a small internal alias table in addition to existing exact, case-insensitive matching and `Laser` suffix handling. The initial alias maps Etsy value `Super Boy` to the registered workspace font display name `Super Boys`.

Alias resolution is isolated behind the existing font-name resolution boundary so a future Fonts UI can replace or augment the internal aliases without changing Etsy import normalization.

## Later Line Creation

Stored selections remain in order source metadata. Whenever preset synchronization, text editing, or another existing workflow materializes the corresponding text line, the existing customer-font overlay applies the resolved stored selection to that line.

Existing lines continue to receive overrides during initial enrichment. A stored selection for a missing line has no immediate geometry or persistence effect.

## UI Scope

The selected-order customer-font summary displays every stored selection, including selections for lines that do not yet exist. No font-alias editing UI is included in this change.

## Diagnostics

Each font selection records its explicit line number and one of these pairing outcomes:

- `paired`: the numbered design line existed during normalization.
- `stored_without_design_line`: the numbered line did not exist, but its selection was preserved.

Font-resolution diagnostics continue to report recognized and unknown selections against currently materialized design lines. Stored future-line selections remain inspectable in the private Etsy diagnostic envelope.

## Verification

Regression coverage uses the production-shaped payload:

- Personalization: `Kiara  MA` (two spaces, no newline).
- Line 1 font: `Quincy`.
- Line 2 font: `Super Boy`.

Tests prove both selections survive normalization, the second selection is marked as stored without a design line, `Super Boy` resolves to `Super Boys`, and adding a second text line later applies the stored line-2 font.
