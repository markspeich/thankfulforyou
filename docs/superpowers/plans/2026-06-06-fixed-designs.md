# Fixed Designs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-managed fixed SVG designs and allow operators to insert them into Production Batch designs alongside text lines.

**Architecture:** Reuse the workspace-font storage pattern for Supabase-backed SVG assets, extend `design_lines` into ordered mixed design items, and render fixed SVG items through separate controls and vector preview/export paths.

**Tech Stack:** Vanilla ES modules, Supabase Postgres and Storage, Vercel-style API routes, Vitest, Playwright, Python SVG export tooling.

---

## File Structure

- Create `src/fixed-design-api.js`: client fetch wrapper for `/api/fixed-designs`.
- Create `src/fixed-designs.js`: client registry normalization, fixed design state helpers, and file-read helpers.
- Create `api/_lib/fixed-design-store.js`: Supabase Storage/Postgres operations for listing, creating, replacing, soft-deleting, and validating SVG files.
- Create `api/fixed-designs.js`: authenticated API route for fixed design operations.
- Create the timestamped `workspace_fixed_designs` migration produced by `npx supabase migration new workspace_fixed_designs`: Storage bucket, `fixed_designs` table, `design_lines` mixed-item columns, grants, and RLS policies.
- Modify `index.html`: add `Fixed Designs` navigation and workspace markup; add fixed design picker and load-version dialog shells.
- Modify `src/app.js`: add route/nav state, fixed design workspace rendering, picker behavior, mixed item line controls, persistence serialization, and preview rendering.
- Modify `src/styles.css`: add fixed design workspace, menus, modal, picker, and fixed SVG control-card styles.
- Modify `src/layout-controls-clipboard.js`: include fixed SVG items in layout copy/paste.
- Modify `src/order-signatures.js`: include fixed SVG item fields in settings signatures.
- Modify `api/_lib/production-batch-mapper.js`, `api/_lib/production-batch-store.js`, and `api/_lib/orders-store.js`: map mixed `design_lines` rows to/from snapshots.
- Modify `tools/dev_server.mjs`: route `/api/fixed-designs`.
- Modify `tools/export_svg.py` and any export payload builder in `src/app.js`: include fixed SVG vector assets in export.
- Test `tests/unit/fixed-design-store.test.js`: storage path, SVG validation, create/replace/delete behavior with mocked Supabase.
- Test `tests/unit/fixed-designs.test.js`: client normalization and deleted/missing fixed design handling.
- Test `tests/unit/production-batch-mapper-fixed-designs.test.js`: mixed item row mapping.
- Test `tests/unit/layout-controls-clipboard.test.js` and `tests/unit/order-signatures.test.js`: fixed SVG settings behavior.
- Extend Playwright tests for Fixed Designs workspace and Production Batch insertion.

## Task 1: Supabase Fixed Design Store

**Files:**
- Create: `api/_lib/fixed-design-store.js`
- Create: `tests/unit/fixed-design-store.test.js`
- Create via Supabase CLI: the timestamped `workspace_fixed_designs` migration in `supabase/migrations`

- [ ] **Step 1: Create the migration file**

Run:

```powershell
npx supabase migration new workspace_fixed_designs
```

Expected: a new timestamped SQL file appears in `supabase/migrations`.

- [ ] **Step 2: Write failing store tests**

Create tests that assert:

```js
import { describe, expect, it, vi } from "vitest";
import {
  buildFixedDesignStoragePath,
  normalizeSvgUploadFile,
  validateSvgContent,
} from "../../api/_lib/fixed-design-store.js";

describe("fixed design store helpers", () => {
  it("builds versioned workspace storage paths", () => {
    expect(buildFixedDesignStoragePath({
      workspaceId: "workspace-1",
      fixedDesignId: "nurse-cross",
      version: 4,
      fileName: "Nurse Cross.svg",
    })).toBe("workspaces/workspace-1/fixed-designs/nurse-cross/v4/Nurse-Cross.svg");
  });

  it("accepts svg uploads", () => {
    expect(normalizeSvgUploadFile({
      name: "Nurse Cross.svg",
      type: "image/svg+xml",
      text: "<svg viewBox=\"0 0 10 10\"></svg>",
    })).toMatchObject({ fileName: "Nurse Cross.svg", contentType: "image/svg+xml" });
  });

  it("rejects files without an svg root", () => {
    expect(() => validateSvgContent("<html></html>")).toThrow("Upload a valid SVG file.");
  });
});
```

Run:

```powershell
npx vitest run tests/unit/fixed-design-store.test.js
```

Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Implement `fixed-design-store.js`**

Implement exported functions:

```js
export const FIXED_DESIGN_STORAGE_BUCKET = "workspace-fixed-designs";
export function buildFixedDesignStoragePath({ workspaceId, fixedDesignId, version, fileName }) {}
export function validateSvgContent(svgText) {}
export function normalizeSvgUploadFile(file) {}
export async function listWorkspaceFixedDesigns({ workspaceId, includeDeleted = false }) {}
export async function createWorkspaceFixedDesign({ workspaceId, displayName, file }) {}
export async function replaceWorkspaceFixedDesign({ workspaceId, fixedDesignId, file }) {}
export async function deleteWorkspaceFixedDesign({ workspaceId, fixedDesignId }) {}
```

Match the error style used by `api/_lib/font-store.js`: expose user-facing 400 errors for invalid uploads and 404 errors for missing fixed designs.

- [ ] **Step 4: Fill the migration SQL**

Create:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-fixed-designs',
  'workspace-fixed-designs',
  true,
  5242880,
  array['image/svg+xml', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.fixed_designs (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  storage_bucket text not null default 'workspace-fixed-designs',
  storage_path text not null,
  public_url text,
  file_name text not null,
  version integer not null default 1 check (version > 0),
  metadata_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, display_name)
);

alter table public.design_lines
  add column if not exists item_kind text not null default 'text'
    check (item_kind in ('text', 'fixed_svg')),
  add column if not exists fixed_design_id text references public.fixed_designs(id) on delete set null,
  add column if not exists fixed_design_version integer,
  add column if not exists svg_size_mm numeric(8, 3) not null default 32 check (svg_size_mm > 0),
  add column if not exists offset_y_mm numeric(8, 3) not null default 0;
```

Add indexes, grants, RLS, and Storage object policies following `20260601120000_workspace_fonts.sql`, using `fixed_designs.workspace_id` and the path prefix `workspaces/<workspace-id>/fixed-designs/`.

- [ ] **Step 5: Run store tests**

Run:

```powershell
npx vitest run tests/unit/fixed-design-store.test.js
```

Expected: PASS.

## Task 2: Fixed Designs API

**Files:**
- Create: `api/fixed-designs.js`
- Create: `src/fixed-design-api.js`
- Modify: `tools/dev_server.mjs`
- Test: `tests/unit/fixed-designs-api.test.js`

- [ ] **Step 1: Write API route tests**

Mock `resolveProductionBatchAuth` and store functions. Cover:

- `GET /api/fixed-designs` returns `{ fixedDesigns }`
- `POST` requires `file`
- `PUT` requires `fixedDesignId` and `file`
- `DELETE` requires `fixedDesignId`

- [ ] **Step 2: Implement `api/fixed-designs.js`**

Mirror `api/fonts.js` with `fixedDesignId` query parsing and JSON upload payloads:

```js
if (req.method === "GET") {
  const fixedDesigns = await listWorkspaceFixedDesigns({ workspaceId: req.auth.workspaceId });
  res.status(200).json({ fixedDesigns });
  return;
}
```

- [ ] **Step 3: Implement `src/fixed-design-api.js`**

Export:

```js
export async function fetchWorkspaceFixedDesigns({ accessToken = null, includeDeleted = false } = {}) {}
export async function createWorkspaceFixedDesign(uploadPayload, { accessToken = null } = {}) {}
export async function replaceWorkspaceFixedDesign(fixedDesignId, uploadPayload, { accessToken = null } = {}) {}
export async function deleteWorkspaceFixedDesign(fixedDesignId, { accessToken = null } = {}) {}
```

- [ ] **Step 4: Add dev server route**

Route `/api/fixed-designs` the same way `/api/fonts` is routed.

- [ ] **Step 5: Run API tests**

Run:

```powershell
npx vitest run tests/unit/fixed-designs-api.test.js
```

Expected: PASS.

## Task 3: Mixed Design Item Model

**Files:**
- Create: `src/fixed-designs.js`
- Modify: `src/app.js`
- Modify: `api/_lib/production-batch-mapper.js`
- Modify: `api/_lib/production-batch-store.js`
- Modify: `api/_lib/orders-store.js`
- Test: `tests/unit/fixed-designs.test.js`
- Test: `tests/unit/production-batch-mapper-fixed-designs.test.js`

- [ ] **Step 1: Add client normalization tests**

Assert that fixed design records normalize from snake_case API rows to camelCase UI records and preserve deleted/missing state labels.

- [ ] **Step 2: Add production batch mapper tests**

Create a snapshot with:

```js
settings: {
  lines: [
    { kind: "text", fontId: "skywalk", fontSizeMm: 30 },
    { kind: "fixedSvg", fixedDesignId: "nurse-cross", fixedDesignVersion: 3, svgSizeMm: 38, offsetXMm: 2, offsetYMm: -7 },
    { kind: "text", fontId: "somekind", fontSizeMm: 23 },
  ],
}
```

Assert the mapper writes `item_kind` values `text`, `fixed_svg`, `text`, preserves `line_index`, and maps back to the same mixed settings.

- [ ] **Step 3: Implement mixed line normalization**

In `src/app.js`, update settings normalization so every line has `kind: "text"` by default. Add a factory:

```js
function createFixedDesignLineSettings(fixedDesign) {
  return {
    kind: "fixedSvg",
    fixedDesignId: fixedDesign.id,
    fixedDesignName: fixedDesign.displayName,
    fixedDesignVersion: fixedDesign.version,
    svgSizeMm: 32,
    offsetXMm: 0,
    offsetYMm: 0,
  };
}
```

- [ ] **Step 4: Update API mappers**

Map:

- `kind: "text"` <-> `item_kind = "text"`
- `kind: "fixedSvg"` <-> `item_kind = "fixed_svg"`
- `svgSizeMm` <-> `svg_size_mm`
- `offsetYMm` <-> `offset_y_mm`
- `fixedDesignId` <-> `fixed_design_id`
- `fixedDesignVersion` <-> `fixed_design_version`

- [ ] **Step 5: Run mapper and model tests**

Run:

```powershell
npx vitest run tests/unit/fixed-designs.test.js tests/unit/production-batch-mapper-fixed-designs.test.js
```

Expected: PASS.

## Task 4: Fixed Designs Workspace UI

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: Playwright workspace navigation test

- [ ] **Step 1: Add route and nav**

Add `fixedDesigns: "fixed-designs"` to `WORKSPACE_ROUTE_SEGMENTS`, include it in active workspace validation, add a nav button, and add the `fixedDesignsWorkspace` DOM reference.

- [ ] **Step 2: Add workspace markup**

Add a `section#fixedDesignsWorkspace` matching Fonts/Size Guides style:

- left selector with `Upload SVG`
- search
- fixed design rows
- right editor with preview/details and ellipsis menu
- load-version dialog

- [ ] **Step 3: Implement rendering**

Add app state:

```js
let fixedDesignRecords = [];
let selectedFixedDesignId = null;
```

Implement `refreshWorkspaceFixedDesigns`, `renderFixedDesignWorkspace`, `selectFixedDesign`, upload handling, replace handling, download handling, and delete confirmation.

- [ ] **Step 4: Run focused UI check**

Run:

```powershell
npm run test:e2e
```

Expected: existing navigation tests pass, and new Fixed Designs checks pass.

## Task 5: Insert Fixed Design Picker And Controls

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `src/layout-controls-clipboard.js`
- Modify: `src/order-signatures.js`
- Test: `tests/unit/layout-controls-clipboard.test.js`
- Test: `tests/unit/order-signatures.test.js`
- Test: Playwright insertion flow

- [ ] **Step 1: Add menu action**

Add `Insert Fixed Design` to the Preset card ellipsis menu. Keep Copy/Paste/Save as New Preset in the popup, not permanently visible in the card.

- [ ] **Step 2: Add picker dialog**

The dialog contains search/filter, selectable fixed design rows, a selected SVG preview, metadata, `Cancel`, and `Insert Fixed Design`.

- [ ] **Step 3: Render fixed SVG control cards**

Update `renderLineControls` so text lines call the existing text-line card path and fixed SVG items render:

```js
<section class="line-control-card fixed-design-line-card">
  <h3>Fixed Design: Nurse Cross</h3>
  <input type="range" data-line-setting="svgSizeMm">
  <input type="range" data-line-setting="offsetXMm">
  <input type="range" data-line-setting="offsetYMm">
</section>
```

- [ ] **Step 4: Update control event handling**

Ensure `handleLineControlsChange` reads and writes fixed SVG fields without expecting font/text fields.

- [ ] **Step 5: Update copy/paste and signatures**

Include fixed SVG item fields in copied layout settings and settings signatures:

```js
["kind", "fixedDesignId", "fixedDesignVersion", "svgSizeMm", "offsetXMm", "offsetYMm"]
```

Do not copy fixed-design library metadata beyond the reference/version needed for the layout item.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/layout-controls-clipboard.test.js tests/unit/order-signatures.test.js
```

Expected: PASS.

## Task 6: Preview And Export

**Files:**
- Modify: `src/app.js`
- Modify: `tools/export_svg.py`
- Test: add or extend a focused unit test for the export payload builder touched in this task
- Test: Playwright preview/export flow

- [ ] **Step 1: Render fixed SVGs in live preview**

Load fixed design `publicUrl`, render it as SVG image/vector markup in the preview, center it in the design coordinate space, apply `svgSizeMm`, `offsetXMm`, and `offsetYMm`, and keep text size-guide fitting independent.

- [ ] **Step 2: Include fixed SVGs in export payload**

Add fixed SVG item data to the export request:

```json
{
  "kind": "fixedSvg",
  "fixedDesignId": "nurse-cross",
  "fixedDesignVersion": 3,
  "svgUrl": "https://...",
  "svgSizeMm": 38,
  "offsetXMm": 2,
  "offsetYMm": -7
}
```

- [ ] **Step 3: Preserve vector paths in export**

Update `tools/export_svg.py` to include fixed SVG vector content in the output SVG without applying text fitting. If the first implementation cannot safely parse and merge every SVG path, preserve the fixed SVG as an SVG group with its original child nodes transformed into design coordinates.

- [ ] **Step 4: Run export verification**

Run:

```powershell
npm run test:unit
npm run test:e2e
```

Expected: PASS, with fixed SVG insertion and export covered.

## Task 7: Full Verification

**Files:**
- Test: all relevant unit/e2e suites
- Modify: `docs/requirements.md` only if implementation reveals a clarified requirement

- [ ] **Step 1: Run full unit tests**

```powershell
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run database tests**

```powershell
npm run test:db:local
```

Expected: PASS.

- [ ] **Step 3: Run e2e tests**

```powershell
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 4: Manual browser verification**

Start local app using AGENTS.md local workflow, sign in as `test.operator@example.com`, verify:

- `/fixed-designs` loads.
- Upload SVG creates a row.
- Load New Version opens a popup and updates version.
- Download SVG downloads the selected SVG.
- Production Batch `Insert Fixed Design` opens picker.
- Inserted item appears as `Fixed Design: <NAME>`.
- Save/reload preserves SVG size and offsets.
- Export includes the fixed SVG.
