# Unified Font Lifecycle Design

## Goal

Make every workspace font follow the same lifecycle. Candlepin, Skywalk, and Somekind are ordinary seeded font records, not a privileged runtime category. Fonts can be replaced, archived, restored, loaded, previewed, analyzed, and exported according to the same rules regardless of origin.

This design also fixes the current replaced-Candlepin browser fallback. The replacement is stored with a new family name, but the client declines to register it because the record is marked built-in. Removing that distinction and registering every resolvable record eliminates the mismatch.

## Product Rules

- A new environment is seeded with ordinary `fonts` rows for Candlepin, Skywalk, and Somekind.
- Those seed rows retain the stable ids `candlepin`, `skywalk`, and `somekind` so existing preset and design references remain valid.
- Font ids do not confer special permissions or runtime behavior.
- Fonts are never physically deleted through the application.
- Any font can be archived and subsequently restored.
- An archived font cannot be assigned to a new preset line or design line.
- Active and archived presets and saved designs that already reference an archived font continue to load, preview, analyze, and export with that font.
- A selector editing an existing archived-font reference retains that current option and labels it `(<archived>)`; it does not offer the archived font as a new choice elsewhere.
- Replacing a font preserves its stable id, writes a new versioned asset, and updates all future rendering and geometry for references to that id.
- Font loading failures are visible errors or warnings, not silent fallback rendering presented as the selected font.

## Recommended Data Transition

Use an additive deployment transition so code and schema can be deployed safely in either order:

1. Add nullable `archived_at timestamptz` to `public.fonts`.
2. Copy existing non-null `deleted_at` values into `archived_at`.
3. Deploy application code that reads `archived_at`, with temporary compatibility for `deleted_at` during rollout if necessary.
4. Convert the seeded font rows to the same ordinary state as every other font and stop reading or writing `is_builtin`.
5. In a later cleanup migration, after production code no longer depends on the old fields, remove `deleted_at` and `is_builtin`.

The migration is database-dependent behavior and must be generated with `npx supabase migration new <descriptive_name>`, checked into the repository, and verified with the local Supabase workflow. The initial additive migration is non-destructive. Dropping obsolete columns belongs in a separate cleanup migration after compatibility has been verified.

Existing font objects and prior versions remain in Supabase Storage. Archiving changes metadata only and must not remove stored assets.

## Seed Behavior

Environment initialization inserts Candlepin, Skywalk, and Somekind as normal rows using the existing stable ids and initial bundled asset paths. The seed operation should be idempotent and must not overwrite a font row that an operator has replaced or archived after initialization.

Client code must not contain a parallel authoritative built-in registry. If a lightweight boot failure state is necessary, it should report that the font registry could not load rather than silently substituting hardcoded production definitions.

## Application Behavior

### Loading And Registration

The font API returns active and archived font metadata when the workspace registry is loaded. The browser registers every non-missing font asset, including archived fonts, because selection eligibility and renderability are separate concerns.

Registration should key browser font faces by the record's runtime family name and current versioned URL. Replacing a version removes the previously registered face for that family before registering the new asset. A registration failure remains observable in the Fonts workspace and in any design or preset using that font.

### Selection

Provide a shared selector helper with these rules:

- New assignment: return active fonts only.
- Existing active reference: return active fonts normally.
- Existing archived reference: return active fonts plus the referenced archived font, visibly labeled archived.
- Missing reference: preserve the missing id as a non-selectable warning option rather than rewriting it.

Use this helper consistently in the preset editor and design-line controls. The Fonts workspace may list archived fonts when `Show archived fonts` is enabled.

### Font Management

Every font exposes the same actions:

- update display name and bridging setting;
- load a new file version;
- archive when active;
- restore when archived.

Replace built-in-specific copy and disabled controls with lifecycle copy based only on active or archived state. Archiving requires an in-app confirmation explaining that the font will disappear from new selectors while existing references continue working.

## API And Store Changes

- Replace delete semantics with explicit archive and restore operations. A `PATCH` lifecycle field or dedicated archive/restore endpoints are both acceptable; prefer the smallest extension consistent with the current API style.
- Remove ID-based and `is_builtin`-based deletion protection.
- Rename store helpers and user-facing messages from delete/deleted to archive/archived.
- List queries must be able to return archived rows for registry loading and the Fonts workspace.
- API responses should expose `archived_at` and stop exposing `is_builtin` after the compatibility period.
- Replacement must work identically for seeded and subsequently uploaded rows.

## Preset And Saved-Design Compatibility

Archiving does not mutate presets or saved designs. References continue to store the stable font id. Both active and archived presets must resolve archived font records when rendered or exported.

The preset editor must not silently change an archived font merely because the preset is opened and saved. The current archived selection remains valid until the operator deliberately selects an active replacement.

The same preservation rule applies to existing order designs. Although the immediate UI requirement concerns preset selectors, a saved design must also continue rendering its archived font and must never be silently rewritten.

## Error Handling

- Registry API failure: show a workspace-load error; do not replace the registry with hardcoded production fonts without disclosure.
- Font asset failure: identify the affected font and show a load warning; do not present Segoe Script or another fallback as successful rendering.
- Archive failure: keep the font active and show the server error.
- Restore failure: keep the font archived and show the server error.
- Missing font id: preserve and label the unresolved reference.
- Replacement upload failure: keep the prior version active and usable.

## Testing

Add or update tests covering:

- seeded and subsequently uploaded records normalize to the same runtime shape;
- no font permission or registration behavior depends on `is_builtin` or a special id;
- a replaced seeded font is dynamically registered using its new family and URL;
- active selectors exclude archived fonts;
- selectors retain the currently referenced archived font without offering other archived fonts;
- active and archived presets using archived fonts retain their ids and render successfully;
- saved designs using archived fonts retain their ids and render successfully;
- archived fonts remain available to analysis and SVG export;
- every font can be archived and restored;
- seeding is idempotent and does not overwrite replaced or archived rows;
- visible warnings appear when a font asset cannot load;
- old delete/built-in terminology and behavior are removed from unit, database, and browser tests.

## Out Of Scope

- Pinning a preset or design to an historical font-file version. Existing references continue to resolve the current version of their stable font id.
- Automated removal of prior font files from Storage.
- Cross-workspace font sharing.
- Font editing or glyph modification inside the application.

## Deployment And Verification

1. Generate and apply the additive local migration.
2. Reset/prepare the local Supabase environment and verify seeded rows.
3. Run unit and database tests.
4. Run focused browser tests for replacement, archive, restore, and archived-reference selectors.
5. Manually replace Candlepin and verify the browser's computed family is loaded from the replacement URL rather than falling back.
6. Verify analysis and export use the same replacement asset.
7. Before production deployment, report the checked-in migration path and apply it to the intended target according to the repository migration workflow.

