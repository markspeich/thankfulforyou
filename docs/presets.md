# Preset Authoring Guide

## Overview

Production presets are loaded from JSON files in [public/presets](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets:1).

The app does not automatically discover every file in that directory. It loads presets from the manifest in [public/presets/manifest.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/manifest.json:1).

To add a new preset today:

1. Create a new preset JSON file in `public/presets/`.
2. Add an entry for that file in `public/presets/manifest.json`.
3. Add any listing-specific assignment overrides inside the preset file if the preset should auto-apply for imported Etsy listings.
4. Verify the preset in the browser.

## Files Involved

- Schema: [docs/schemas/preset.schema.json](/C:/Users/Mark/CodexProjects/thankfulforyou/docs/schemas/preset.schema.json:1)
- Sample: [docs/examples/preset.preset-c3e8a1d7f520.sample.json](/C:/Users/Mark/CodexProjects/thankfulforyou/docs/examples/preset.preset-c3e8a1d7f520.sample.json:1)
- Runtime manifest: [public/presets/manifest.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/manifest.json:1)
- Current runtime presets:
  [preset-a1f4c8e2b601.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/preset-a1f4c8e2b601.json:1),
  [preset-c3e8a1d7f520.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/preset-c3e8a1d7f520.json:1),
  [preset-d9b4f2a6c731.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/preset-d9b4f2a6c731.json:1)

## Preset File Shape

Each preset file contains:

- `schemaVersion`: currently `1`
- `id`: stable machine-readable preset id
- `name`: dropdown label shown in the app
- `description`: optional note for humans
- `globalDefaults`: preset-wide defaults like backing border and weld toggle
- `lineDefaults`: base values for every line
- `lineRules`: rule-based overrides for specific lines
- `listingAssignments`: optional listing-specific mappings and overrides tied to the preset

## Line Rules

`lineRules` are evaluated per line and merged on top of `lineDefaults`.

Supported `match.kind` values:

- `all`: apply to every line
- `first`: apply only to line index `0`
- `remaining`: apply to every line after the first
- `index`: apply only to one exact `lineIndex`

Example:

```json
{
  "match": { "kind": "first" },
  "settings": { "fontId": "skywalk" }
}
```

## Listing Assignments

`listingAssignments` let a preset declare Etsy listing ids that should map to it, along with any listing-specific line overrides.

Example:

```json
{
  "listingId": "1884223710",
  "lineOverrides": [
    {
      "lineIndex": 1,
      "settings": {
        "fontSizeMm": 21
      }
    }
  ]
}
```

## Adding A New Preset

### 1. Copy An Existing Preset

Start from the closest existing file in [public/presets](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets:1).

Good starting points:

- `preset-a1f4c8e2b601.json` for a single-font preset
- `preset-c3e8a1d7f520.json` for a multi-font preset with listing overrides

### 2. Update The Preset Fields

At minimum, update:

- `id`
- `name`
- `description`
- `lineRules`
- `listingAssignments` if the preset should auto-apply for imported Etsy listing ids

Keep `id` stable once the preset is in use. Saved batch data stores the preset id, so changing it later can break old saved state.

### 3. Add The Preset To The Manifest

Add a new entry to [public/presets/manifest.json](/C:/Users/Mark/CodexProjects/thankfulforyou/public/presets/manifest.json:1):

```json
{
  "id": "your-new-preset-id",
  "path": "public/presets/your-new-preset-id.json"
}
```

If the preset should become the default for new manual designs, also update `defaultPresetId` in the manifest.

### 4. Verify The Behavior

Check all of the following in the browser:

- the new preset appears in the `Presets` dropdown
- selecting it resets line controls to the expected defaults
- each line gets the expected font and sizing defaults
- any imported listing id that should map to it auto-selects it correctly

## Recommended Conventions

- Use lowercase kebab-case for `id`, such as `preset-c3e8a1d7f520-wide`.
- Treat `name` as the exact operator-facing label.
- Put broad defaults in `lineDefaults`.
- Use `lineRules` only for differences from the base defaults.
- Keep listing-specific overrides as narrow as possible so they only override the fields that truly differ.

## Current Limitations

- New preset files are not auto-discovered from the folder.
- The manifest is required because the browser app loads static files and cannot enumerate the directory itself.
- There is not yet a UI button for writing preset files from the current editor state.

## Future `Save As Preset` Direction

The long-term goal is to support a `Save As Preset` action in the editor.

That future feature should:

- capture the full current preset-relevant editor state
- generate a valid preset JSON file matching [preset.schema.json](/C:/Users/Mark/CodexProjects/thankfulforyou/docs/schemas/preset.schema.json:1)
- include the preset name and stable preset id
- serialize global defaults such as `backingMm` and `weldExportedDesign`
- serialize per-line font choices, bridges, offsets, and text-height defaults in a form that can round-trip back into `lineDefaults` and `lineRules`
- avoid embedding one-off order text into the preset file

Because of that future direction, preset authoring should keep the schema focused on reusable layout defaults rather than order-specific content.
