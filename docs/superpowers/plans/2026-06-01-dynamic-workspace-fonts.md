# Dynamic Workspace Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-wide Fonts workspace where operators can upload, replace, delete, and use Supabase-backed fonts in designs and presets.

**Architecture:** Introduce a font registry boundary shared by UI controls, design serialization, and export payloads. Store font metadata in Supabase Postgres, store uploaded files in Supabase Storage with versioned paths, and keep built-in fonts protected as seeded records plus local fallbacks.

**Tech Stack:** Vanilla ES modules, Vitest, Playwright, Supabase Postgres, Supabase Storage, Vercel-style API routes, Python/fontTools export pipeline.

---

## File Structure

- Create `src/fonts.js`: client-side font registry, normalization, option resolution, dynamic `FontFace` loading, and upload API calls.
- Create `src/font-api.js`: small fetch wrapper for `/api/fonts`.
- Create `api/_lib/font-store.js`: Supabase Postgres/Storage operations for listing, creating, replacing, and soft-deleting fonts.
- Create `api/fonts.js`: authenticated route for list/create/delete/replace font operations.
- Create `supabase/migrations/20260601120000_workspace_fonts.sql`: fonts table, RLS, grants, Storage bucket insert.
- Modify `src/app.js`: replace hard-coded `FONT_OPTIONS` usage with the font registry, add Fonts workspace state/rendering, refresh dropdowns after upload/delete/replace.
- Modify `src/styles.css`: add nav icon and Fonts workspace styles.
- Modify `index.html`: add `Fonts` nav button and workspace markup.
- Modify `tools/export_svg.py`: allow absolute HTTPS font URLs in the font resolver.
- Modify `tools/dev_server.mjs`: route `/api/fonts` requests in local development.
- Test `tests/unit/fonts.test.js`: registry normalization and option behavior.
- Test `tests/unit/font-store.test.js`: Supabase store behavior with mocked client.
- Test `tests/unit/fonts-api.test.js`: API route behavior.
- Extend Playwright nav/UI tests for the `Fonts` workspace.

## Task 1: Font Registry Unit Boundary

**Files:**
- Create: `src/fonts.js`
- Create: `src/font-api.js`
- Create: `tests/unit/fonts.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from "vitest";
import {
  BUILTIN_FONT_DEFINITIONS,
  buildFontOptions,
  normalizeFontRecord,
  resolveFontOption,
} from "../../src/fonts.js";

describe("font registry", () => {
  it("keeps built-in fonts first and appends uploaded workspace fonts", () => {
    const options = buildFontOptions([
      { id: "font-1", display_name: "Clinic Sans", family_name: "ClinicSans", public_url: "https://example.test/font.otf", file_format: "otf", version: 1 },
    ]);

    expect(options.map((font) => font.id).slice(0, 3)).toEqual(["candlepin", "skywalk", "somekind"]);
    expect(options.at(-1)).toMatchObject({
      id: "font-1",
      label: "Clinic Sans",
      family: "ClinicSans",
      url: "https://example.test/font.otf",
      exportPath: "https://example.test/font.otf",
      isUploaded: true,
    });
  });

  it("excludes deleted uploaded fonts from normal choices", () => {
    const options = buildFontOptions([
      { id: "font-1", display_name: "Deleted", family_name: "Deleted", public_url: "https://example.test/font.otf", file_format: "otf", version: 1, deleted_at: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(options.some((font) => font.id === "font-1")).toBe(false);
  });

  it("can resolve a deleted font for an existing design", () => {
    const record = normalizeFontRecord({
      id: "font-1",
      display_name: "Old Font",
      family_name: "OldFont",
      public_url: "https://example.test/font.otf",
      file_format: "otf",
      version: 2,
      deleted_at: "2026-06-01T00:00:00.000Z",
    }, { includeDeleted: true });

    const option = resolveFontOption("font-1", [...BUILTIN_FONT_DEFINITIONS, record]);
    expect(option.label).toBe("Old Font (deleted)");
    expect(option.isDeleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run tests/unit/fonts.test.js`

Expected: FAIL because `src/fonts.js` does not exist.

- [ ] **Step 3: Implement the registry**

Define built-ins, `normalizeFontRecord`, `buildFontOptions`, `resolveFontOption`, `loadWorkspaceFonts`, `uploadWorkspaceFont`, `replaceWorkspaceFont`, and `deleteWorkspaceFont`.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/unit/fonts.test.js`

Expected: PASS.

## Task 2: Supabase Font Store And Migration

**Files:**
- Create: `api/_lib/font-store.js`
- Create: `supabase/migrations/20260601120000_workspace_fonts.sql`
- Create: `tests/unit/font-store.test.js`

- [ ] **Step 1: Write failing store tests**

Test these behaviors with a mocked Supabase admin client:

- `buildFontStoragePath({ workspaceId: "workspace-1", fontId: "font-1", version: 2, fileName: "Clinic Sans.otf" })` returns `workspaces/workspace-1/fonts/font-1/v2/Clinic-Sans.otf`
- `normalizeUploadedFontFile({ name: "Clinic Sans.otf", type: "font/otf", size: 123 })` returns format `otf`
- unsupported files throw `Unsupported font file type. Upload an OTF, TTF, WOFF, or WOFF2 file.`
- deleting a built-in font throws `Built-in fonts cannot be deleted.`

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run tests/unit/font-store.test.js`

Expected: FAIL because `font-store.js` does not exist.

- [ ] **Step 3: Implement store helpers and migration**

Migration must create `public.fonts`, enable RLS, grant authenticated/service_role access, add workspace membership policy, and insert a public `workspace-fonts` Storage bucket.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/unit/font-store.test.js`

Expected: PASS.

## Task 3: Fonts API Route

**Files:**
- Create: `api/fonts.js`
- Create: `tests/unit/fonts-api.test.js`
- Modify: `tools/dev_server.mjs`

- [ ] **Step 1: Write failing API tests**

Test:

- `GET /api/fonts` calls auth and `listWorkspaceFonts`
- `POST /api/fonts` rejects missing upload data with 400
- `DELETE /api/fonts?fontId=candlepin` returns 400 for built-in delete from the store
- unsupported methods return 405

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/fonts-api.test.js`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route and dev server wrapper**

Use `resolveProductionBatchAuth(req)` and call the font store. The route accepts JSON in tests and `FormData`/multipart in production if available. The dev server should forward `/api/fonts` requests to the route.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/unit/fonts-api.test.js`

Expected: PASS.

## Task 4: Fonts Workspace UI

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Extend: `tests/e2e/preset-editor.spec.js`

- [ ] **Step 1: Write failing Playwright test**

Add a test that clicks `Fonts`, sees the Fonts workspace, sees protected built-ins, and returns to `Production Batch`.

- [ ] **Step 2: Run RED**

Run: `npx playwright test tests/e2e/preset-editor.spec.js --grep "fonts workspace"`

Expected: FAIL because the nav item/workspace does not exist.

- [ ] **Step 3: Implement nav and read-only font list**

Add the nav button, workspace shell, workspace switching logic, built-in list rendering, and protected delete state. Keep upload actions wired to client functions, but do not depend on live Supabase for the first visual test.

- [ ] **Step 4: Run GREEN**

Run: `npx playwright test tests/e2e/preset-editor.spec.js --grep "fonts workspace"`

Expected: PASS.

## Task 5: Dynamic Font Selectors And Export Paths

**Files:**
- Modify: `src/app.js`
- Modify: `tools/export_svg.py`
- Extend: `tests/unit/export-svg.test.js`
- Extend: `tests/unit/fonts.test.js`

- [ ] **Step 1: Write failing tests**

Add a unit test that uploaded font options produce `exportPath` as the Supabase public URL, and a Python/export test that an HTTPS font ref is accepted by `find_font_path` through remote caching.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/fonts.test.js tests/unit/export-svg.test.js`

Expected: FAIL on uploaded font export path or HTTPS font resolution.

- [ ] **Step 3: Implement dynamic selectors and HTTPS resolver**

Replace `FONT_OPTIONS` constant use with mutable registry access. Add absolute URL support to `cache_remote_font` with cache filenames based on URL hash/version.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/unit/fonts.test.js tests/unit/export-svg.test.js`

Expected: PASS.

## Task 6: Upload, Replace, Delete Interaction

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Extend: `tests/e2e/preset-editor.spec.js`

- [ ] **Step 1: Write failing Playwright tests**

Test mocked `/api/fonts` responses for:

- upload adds a font to the list and line dropdown
- replace keeps the same font id and increments version display
- delete removes an uploaded font from normal selection
- built-in delete button is disabled

- [ ] **Step 2: Run RED**

Run: `npx playwright test tests/e2e/preset-editor.spec.js --grep "font"`

Expected: FAIL for missing interactions.

- [ ] **Step 3: Implement interactions**

Wire file input, display name, upload, replace, delete confirmation, status messages, registry refresh, and control re-rendering.

- [ ] **Step 4: Run GREEN**

Run: `npx playwright test tests/e2e/preset-editor.spec.js --grep "font"`

Expected: PASS.

## Task 7: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run unit tests for touched areas**

Run: `npx vitest run tests/unit/fonts.test.js tests/unit/font-store.test.js tests/unit/fonts-api.test.js tests/unit/export-svg.test.js tests/unit/preset-editor.spec.js`

Expected: all selected tests pass. If `tests/unit/preset-editor.spec.js` does not exist, run the nearest affected unit suites instead.

- [ ] **Step 2: Run focused Playwright coverage**

Run: `npx playwright test tests/e2e/preset-editor.spec.js`

Expected: PASS.

- [ ] **Step 3: Run full verification when focused checks are green**

Run: `npm test`

Expected: PASS.

## Self-Review

Spec coverage:

- Workspace-wide uploads: Tasks 2, 3, 6.
- Supabase Storage/Postgres deployment: Tasks 2 and 3.
- Fonts nav/editor: Tasks 4 and 6.
- Delete and overwrite/version upload: Tasks 2, 3, and 6.
- Dynamic design/preset use: Tasks 1, 5, and 6.
- Export/analysis real font access: Task 5.

Placeholder scan: no `TBD` or `TODO` steps remain. Later cleanup is explicitly out of first implementation scope.

Type consistency: the plan consistently uses `fontId`, `display_name`, `family_name`, `storage_path`, `public_url`, `version`, `deleted_at`, and app-facing `label`, `family`, `url`, `exportPath`.

