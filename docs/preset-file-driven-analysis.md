# Preset JSON Proposal

## What The Sample Covers

The sample file in `docs/examples/preset.preset-c3e8a1d7f520.sample.json` represents the current `Skywalk, Somekind` preset as data instead of code.

It captures the parts that are currently spread across `src/presets.js` and `src/app.js`:

- Preset identity and display name.
- Global defaults that could reasonably belong to a preset.
- Per-line default settings.
- Per-line font and sizing rules.
- Listing-specific overrides for a preset-driven imported order.

## Recommended Shape For A File-Driven Rollout

For the schema itself, one JSON file per preset is a clean authoring model.

For the app runtime, this repo will need one of these two loading strategies:

1. A single catalog JSON containing all presets and listing mappings.
2. Individual preset JSON files plus a small manifest JSON listing available preset files.

Because the current app is served as static files without a bundler step, option 1 is the simpler implementation path. Browsers cannot discover a directory of JSON files on their own, so a manifest or catalog is required anyway.

## What Would Need To Change In The App

### 1. Replace Hardcoded Preset Definitions

Current preset behavior is hardcoded in [src/presets.js](/C:/Users/Mark/CodexProjects/thankfulforyou/src/presets.js:1):

- `PRESET_OPTIONS`
- `DEFAULT_PRESET_ID`
- `LISTING_PRESET_MAP`
- `LISTING_PRESET_LINE_OVERRIDES`
- `getPresetFontIdForLine`
- `getPresetLineOverrides`

Those would need to become data-driven helpers that read normalized preset records from JSON.

### 2. Move From Switch Logic To Rule Evaluation

Today `getPresetFontIdForLine()` uses a `switch` on the preset id. A file-driven version would instead:

1. Start with `lineDefaults`.
2. Apply matching `lineRules` for the current line index.
3. Apply any listing-specific `lineOverrides` when the order's listing id selects that preset.

That is a modest refactor, not a full rewrite. The current `buildPresetLines()` function is already close to the right seam for this.

### 3. Stop Hardcoding Dropdown Options In HTML

The preset dropdown is currently static in [index.html](/C:/Users/Mark/CodexProjects/thankfulforyou/index.html:96).

To be truly driven from JSON, the app should render dropdown options from loaded preset data instead of maintaining names in both HTML and JS.

### 4. Load Preset Data Before Initializing The Editor

The current app starts synchronously from module scope in [src/app.js](/C:/Users/Mark/CodexProjects/thankfulforyou/src/app.js:1).

A file-driven implementation would likely need:

- an async startup step that fetches preset JSON
- a normalized in-memory preset registry
- a fallback error state if preset loading fails

This is the most visible structural change, but it is still contained near app startup and preset helpers.

### 5. Rework Listing-Based Auto Selection

Imported Etsy orders currently resolve listing ids through hardcoded mappings in `src/presets.js`.

If presets move to JSON, there are two viable patterns:

1. Keep listing id to preset id mapping in a separate catalog file.
2. Let each preset file declare its own `listingAssignments`, then build a lookup map at load time.

The sample schema shows the second pattern because it keeps preset-specific overrides close to the preset they modify.

### 6. Update Tests

Current unit tests in [tests/unit/presets.test.js](/C:/Users/Mark/CodexProjects/thankfulforyou/tests/unit/presets.test.js:1) verify hardcoded branching behavior.

They would need to shift toward:

- schema validation tests for sample preset JSON
- rule evaluation tests for `first`, `remaining`, and `index`
- listing assignment override tests
- integration tests that verify preset labels populate the dropdown

## Complexity Assessment

This is a medium-complexity cleanup, not a risky architecture change.

The main work is:

- introducing async preset loading
- consolidating duplicate preset knowledge into one source of truth
- replacing preset-specific branching with generic rule evaluation

The rest of the editor state model can stay mostly unchanged as long as preset ids remain stable.

## Suggested Migration Plan

1. Introduce a JSON catalog and schema without changing behavior.
2. Add a small preset loader that normalizes JSON into the current helper interface.
3. Swap `src/presets.js` to read from loaded data instead of hardcoded constants.
4. Render the preset dropdown from loaded data.
5. Update tests to validate both the JSON shape and the runtime behavior.

## Main Risk To Watch

The biggest practical risk is not the schema itself. It is letting preset data exist in both JSON and hardcoded HTML or JS during a partial migration.

If we do this, we should move the dropdown labels, preset ids, and listing mappings together so there is only one source of truth.
