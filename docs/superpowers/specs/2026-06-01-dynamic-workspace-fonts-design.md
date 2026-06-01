# Dynamic Workspace Fonts Design

## Goal

Allow operators to manage production fonts from inside the app instead of relying on a fixed deploy-time font list. Fonts are workspace-wide: any signed-in operator in the current Supabase workspace can upload, use, overwrite with a new version, or delete fonts, and order item designs can resolve those fonts across sessions and deployments.

## Scope

This design covers:

- a new `Fonts` left-nav workspace
- workspace-scoped font metadata in Supabase Postgres
- workspace-scoped font files in Supabase Storage
- dynamic font loading for browser preview and controls
- analysis and SVG export resolution for uploaded font files
- preserving built-in Candlepin, Skywalk, and Somekind behavior
- deleting uploaded fonts
- uploading a new version for an existing font

This design does not cover:

- automatic classification of whether a font is safe for laser cutting
- font editing or glyph modification inside the app
- cross-workspace font sharing
- per-user private font libraries
- marketplace or customer-facing font selection

## Product Intent

The shop should be able to add production-ready fonts without changing source code or redeploying the app. Once a font is uploaded, it should behave like the built-in production fonts: it appears in per-line font dropdowns, preset font fields, previews, connectedness analysis, and SVG export.

Font management should remain practical for production work. Operators need to see what fonts are available, upload a new one, replace a font file when the business updates it, and remove fonts that should no longer be used.

## User-Facing Behavior

### Navigation

Add a fourth left-nav item, `Fonts`, between `Presets` and `Size Guides`. It uses the existing collapsible icon-plus-label navigation language and opens a dedicated font-management workspace.

### Fonts Workspace

The workspace follows the same calm production layout style as `Presets` and `Size Guides`:

- left panel: workspace font list
- right panel: selected font details and upload actions

The font list shows:

- font display name
- file format
- built-in or uploaded status
- active/deleted state where useful
- last updated timestamp

The editor shows:

- display name
- font id as read-only support information only if needed
- current file name and format
- preview sample text rendered with the selected font
- upload/replace action
- delete action for uploaded fonts

Built-in fonts should be protected from deletion. If replacing built-ins is supported later, it should require an explicit design decision because existing presets and designs depend on their stable ids.

### Uploading A Font

The operator can upload `.otf`, `.ttf`, `.woff`, or `.woff2` files from their computer. On upload, the app:

1. validates the file extension and MIME type where available
2. creates a stable opaque font id
3. stores the file in Supabase Storage under the current workspace
4. writes font metadata to Supabase Postgres
5. dynamically loads the font in the browser
6. refreshes all font selectors without a page reload

The upload form should include an editable display-name field. It defaults to a cleaned-up version of the file name before upload.

### Overwriting A Font

Operators can upload a new file version for an existing uploaded font. The app should present this as `Upload New Version` or `Replace Font File`, not as a separate new font.

Replacing a font:

- keeps the same `fontId`
- creates a new Storage object path with a version marker instead of overwriting the old object in place
- updates the active metadata to point at the new version
- reloads the browser font face with a cache-busting URL
- invalidates analysis/export-ready cached geometry for designs using that font

Old Storage objects should be retained for recovery and to avoid CDN propagation problems. A future maintenance task can add cleanup once the shop has a version-retention policy.

### Deleting A Font

Deleting an uploaded font requires an in-app confirmation dialog.

Deletion should be a soft delete in Postgres for the first implementation:

- deleted fonts disappear from normal font dropdowns
- existing designs that already reference the deleted font can still resolve it for preview/export when possible
- if a deleted font cannot be resolved, the UI should show an explicit missing-font warning instead of silently switching to Candlepin

The delete action should be disabled for built-in fonts. If an uploaded font is used by existing presets or designs, the confirmation should warn that new designs will not be able to select it but existing saved work may continue referencing it.

## Data Model

Add a workspace-scoped `fonts` table:

```sql
create table public.fonts (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  family_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  public_url text,
  file_name text not null,
  file_format text not null check (file_format in ('otf', 'ttf', 'woff', 'woff2')),
  version integer not null default 1 check (version > 0),
  is_builtin boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, display_name)
);
```

If public Storage URLs are not desirable long term, `public_url` can be replaced with an app-hosted `/api/fonts/:id/file` route that checks workspace membership before streaming the object. The first implementation can use a public Supabase Storage bucket because font files are production assets rather than customer personal data, but this assumption should be documented.

Storage paths should include workspace and version information:

```text
workspaces/{workspaceId}/fonts/{fontId}/v{version}/{safeFileName}
```

Seed metadata for built-in fonts using their existing ids:

- `candlepin`
- `skywalk`
- `somekind`

Built-in rows may point to the existing `public/fonts` deploy paths or be migrated into the same Storage bucket. Keeping deploy paths for built-ins is acceptable if the dynamic font registry exposes a consistent `url` and `exportPath` shape to the app.

## Architecture

### Font Registry Module

Add a focused client module, `src/fonts.js`, responsible for:

- bundled built-in font definitions
- fetching workspace font metadata
- normalizing font records into app font options
- registering dynamic `FontFace` objects
- exposing active font options for dropdowns
- resolving deleted or missing font ids for existing designs

The app should stop treating `FONT_OPTIONS` as a hard-coded constant in `src/app.js`. Instead, it should initialize from the font registry and re-render controls after the registry changes.

### API Routes

Add authenticated API routes:

- `GET /api/fonts` returns active fonts plus resolvable deleted fonts needed by current saved designs if included by id
- `POST /api/fonts` accepts multipart upload and creates a font
- `PUT /api/fonts/:fontId` accepts multipart upload for a new version
- `DELETE /api/fonts/:fontId` soft-deletes an uploaded font

The routes should use the existing Supabase auth/session pattern and verify workspace membership through the same server-side helpers used by production batch routes.

### Supabase Storage

Create a Storage bucket for font files, tentatively `workspace-fonts`.

The server API should perform uploads with the service-role client after authenticating the operator and workspace membership. This avoids exposing broad Storage write policies to the browser. If direct browser uploads are later needed for large files, add signed upload URLs with narrow paths.

The bucket can be public for the first implementation so browser `FontFace` and Python export can fetch font files by URL. If the bucket is private, the app needs a signed URL renewal strategy for browser preview and a server-side download strategy for Python export.

### Preview And Controls

Font dropdowns in the order editor and preset editor should use the runtime registry. When a font is uploaded or replaced:

- the Fonts workspace list updates
- order line font dropdowns update
- preset editor font dropdowns update
- current designs using that font re-render

If the active design references a deleted font, keep that option visible in its dropdown with a deleted/missing marker so the operator understands why the design still renders differently from normal selectable fonts.

### Analysis And Export

The layout payload already includes `fontId` and `fontPath`/`exportPath` for letters. Uploaded fonts should pass a resolvable URL or route reference to Python so `tools/export_svg.py` can load the real font file.

Update the Python font resolver to support:

- existing local `public/fonts/...` paths
- absolute HTTPS Supabase Storage URLs
- app-hosted font file URLs if the bucket is private later

Remote font downloads should keep a size limit and cache files by URL/version to avoid repeated downloads.

### Caching And Versioning

Replacing a font should not reuse the same public URL. A versioned Storage path gives browser preview, Python analysis, and Vercel/Supabase CDN caches a clean new asset.

Order/design settings can continue storing `fontId`. The active font metadata determines the current version for new analysis/export. This means replacing a font intentionally changes future output for designs using that font. The UI should make that clear in the replace confirmation.

## Error Handling

- Invalid file type: show an inline upload error and do not write metadata.
- Upload succeeds but metadata insert fails: report the failure and leave the Storage object unused; cleanup can be best-effort.
- Metadata insert succeeds but dynamic font load fails: keep the font in the registry with a warning so the operator can delete or replace it.
- Missing font id in saved design: show a missing-font warning and fall back only for layout safety, never silently.
- Delete built-in font: block the action.
- Delete uploaded font used by designs/presets: require confirmation and soft-delete.
- Replace font used by designs/presets: require confirmation that future analysis/export may change.

## Requirements Updates

Add these production requirements to `docs/requirements.md`:

- The app must allow workspace-wide font uploads.
- Uploaded fonts must be stored in Supabase so signed-in operators in the workspace can use them across sessions and deployments.
- The `Fonts` workspace must allow uploading, deleting, and replacing uploaded fonts with new versions.
- Font choices in order designs and presets must come from the dynamic workspace font registry plus protected built-in fonts.

## Testing Strategy

Add unit tests for:

- font metadata normalization
- built-in font fallback
- deleted font resolution for saved designs
- upload payload validation helpers
- versioned Storage path generation
- font dropdown options updating from registry data
- export payloads carrying uploaded font URLs

Add API route tests for:

- listing workspace fonts
- creating an uploaded font
- replacing an uploaded font version
- soft-deleting an uploaded font
- rejecting delete/replace of built-in fonts
- rejecting unsupported file types
- rejecting requests without a valid workspace membership

Add Playwright coverage for:

- `Fonts` appears in the left nav
- uploading a font makes it available in a line font dropdown
- replacing a font keeps the same option but updates status/version
- deleting a font removes it from normal new selections
- built-in fonts cannot be deleted
