# Workspace Font Alias Management Design

## Goal

Allow an operator to map an imported marketplace font name to an existing workspace font directly from the selected-order design screen. The mapping becomes a durable workspace-wide alias used by Etsy and Amazon imports. Creating or changing a mapping immediately applies and persists the selected font on the active design line without silently rewriting other saved designs.

## Selected-Order Experience

Each imported customer-font metadata row always shows both the marketplace value and its current resolution:

- `Line 1 Font: Lemonade (Crushed Lemonade)` when mapped.
- `Line 1 Font: Lemonade (Unmapped)` when unresolved.
- `Line 1 Font: Super Boy (Super Boys — archived)` when an existing alias targets an archived font.

An unresolved row has a compact `Map font` action after the text. A resolved row has a compact pencil action with the accessible label `Change font mapping`.

The action opens a focused `Map Marketplace Font` dialog containing:

- the read-only marketplace font name;
- explanatory text that the mapping applies to all marketplace imports in the current workspace;
- a searchable selector containing active workspace fonts;
- a preview of the current design line rendered in the selected font when a corresponding line exists;
- `Cancel` and `Map Font` actions.

The confirmation action stays disabled until an active font is selected. The dialog traps focus, closes on `Cancel` or Escape, and returns focus to the row action.

## Mapping Behavior

Submitting a new mapping performs one operator action:

1. Persist the marketplace font name as an alias of the selected workspace font.
2. Apply the selected font to the corresponding active design line.
3. Persist that design-line change so refresh or navigation does not undo it.
4. Refresh the preview and metadata row to show the resolved display name.

If the imported selection refers to a future line that does not yet exist, the alias is saved immediately but no design line is synthesized. The existing future-line behavior applies the alias when that text line is later created.
After success, the row reports the resolved mapping normally; the dialog confirmation reports that the mapping was saved for future Line N and that no current design line was changed.

If the alias is already mapped to a different font, the first submission shows a warning naming both fonts, for example: `Lemonade is currently mapped to Crushed Lemonade. Replace this mapping with Lemon Cake Regular?` The operator must explicitly confirm `Replace Mapping`. Reassignment affects future resolution across Etsy and Amazon but does not rewrite other saved designs.

## Data Model

Add a dedicated `font_aliases` table with:

- `id uuid primary key default gen_random_uuid()`;
- `workspace_id uuid not null` referencing the workspace with cascade deletion;
- `font_id text not null` referencing `fonts.id` with restricted deletion;
- `alias_name text not null` preserving the operator-visible marketplace value;
- `normalized_alias text not null` used for matching;
- `created_by` and `updated_by` nullable user references;
- `created_at` and `updated_at` timestamps.

The table has a unique constraint on `(workspace_id, normalized_alias)`. Aliases are workspace-wide and marketplace-neutral. A single `Lemonade` mapping therefore applies to both Etsy and Amazon in that workspace.

One shared canonicalization function defines `normalized_alias`: convert to Unicode NFKC, trim leading and trailing whitespace, collapse internal whitespace runs to one ASCII space, and apply locale-independent lowercase conversion. The server computes this value and the database mutation verifies/stores it; clients may compute it for display and lookup but are not authoritative. The optional trailing `Laser` compatibility rule remains a font-candidate matching fallback and is not removed when forming alias identity.

The alias references the existing stable `fonts.id`. Built-in IDs include `candlepin`, `skywalk`, and `somekind`; uploaded fonts use generated `font-<uuid>` IDs. A display-name change does not invalidate an alias.

Row-level security permits workspace members to read aliases and operators to create or reassign them, following the same workspace membership boundary as font management. Service-role import paths may read aliases during enrichment.

The schema change is additive and must be delivered as a checked-in Supabase migration. The current internal `Super Boy` to `Super Boys` exception is seeded only for workspaces containing the matching active `Super Boys` font, using a workspace/font join so no cross-workspace or missing-font reference is created. The static exception is then removed so persisted aliases become the single operator-managed alias mechanism.

## Resolution Rules

Font-name resolution is centralized and receives workspace font options plus workspace aliases. It performs case-insensitive, trimmed matching with the existing optional trailing `Laser` normalization.

Resolution priority is:

1. a persisted workspace alias;
2. an exact font ID, label, or display-name match after normalization.

Alias targets may be retained when a font is archived so saved metadata remains explainable. New imports do not apply an alias whose target is archived or deleted: the preset font remains unchanged while the UI renders `Name (Old Font — archived)`. Existing saved lines using the archived font remain renderable. Restoring that font reactivates alias resolution. The mapping dialog offers active fonts only, and the server rejects archived, deleted, or cross-workspace targets.

## Server Interface And Transaction

Expose an authenticated workspace-scoped alias endpoint that supports listing aliases and creating or reassigning one alias. The mutation accepts the original marketplace name, selected stable font ID, the active order/design identity when a corresponding line exists, the line index, and the client's current order-item and design revisions.

The server validates workspace membership, normalizes the alias, verifies that the target font is active and belongs to the workspace, and verifies that the design and line belong to the same workspace. One authenticated database RPC locks the relevant alias/design records, upserts or reassigns the alias, updates only the selected design line, increments the affected order-item and design revisions, and returns the complete saved line and new revisions. A stale revision, alias race, validation error, or line-update failure rolls back the entire transaction, so an alias cannot be saved without the requested active-line update.

For a stored future-line selection with no materialized design line, the request omits the design-line mutation and saves only the alias.

The response contains the authoritative previous and current alias targets with current font display metadata and, when updated, the new order-item revision, design revision, and complete line state. It does not expose private Etsy import diagnostics.

## Import And Client Data Flow

Workspace bootstrap data includes aliases alongside fonts so browser rendering, preset synchronization, later line creation, and manual mapping share the same resolution behavior. Etsy and Amazon import handlers load the same alias registry with the workspace font registry before enriching imported designs. Reimporting an existing order may refresh diagnostics but must not overwrite its saved design through newly available aliases.

Imported source metadata continues preserving the original customer value in `customerFontSelections`; it is not rewritten to the internal font name. This allows the UI to display `Lemonade (Crushed Lemonade)` and preserves marketplace fidelity.

After a successful dialog submission, the client replaces its local alias snapshot, applies the returned line state, updates its saved baseline and revision, rerenders the preview and metadata, and leaves unrelated unsaved design settings unchanged. The operation must not mark unrelated edits as saved.

## Error Handling

- Alias conflict: show the explicit replacement warning and require confirmation.
- Archived or deleted target: reject the mutation and refresh the active-font list.
- Order-item or design revision conflict: roll back the alias mutation, leave the dialog open, reload the current mapping and active order state, preserve the operator's selected target, and require confirmation again if the authoritative mapping changed while the dialog was open.
- Network or server failure: leave the current design and alias display unchanged and show a dismissible plain-language error in the dialog.
- Alias saved for a future line: show the resolved mapping immediately without creating a blank line.

## Verification

Unit coverage proves normalization, alias priority, case-insensitive matching, archived-target handling, exact-name fallback, and removal of the hard-coded `Super Boy` exception.

Database and API coverage proves workspace isolation and RLS, unique canonical aliases, authorized creation, explicit reassignment, inactive-font rejection, atomic alias/design-line updates, future-line alias-only updates, alias-race rollback, and stale order-item/design revision rollback.

Import regression coverage proves `Lemonade` resolves to `Crushed Lemonade` for both Etsy and Amazon after the alias exists, while the original `Lemonade` value remains in source metadata.

Browser coverage proves the exact mapped, unmapped, and archived parenthetical row labels; dialog focus and accessible controls; font search and preview; immediate active-line persistence; future-line feedback; replacement warning; conflict recovery; failure behavior; and no changes to unrelated saved designs.

The existing production order `4144190516` is not modified by the migration. After deployment, the operator can map `Lemonade` from one affected row; that active row updates immediately, while the other previously imported designs remain unchanged until explicitly edited.
