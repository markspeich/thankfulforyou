# Workspace Font Alias Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators persist workspace-wide marketplace font aliases from imported font rows and atomically apply the mapped font to the active design line.

**Architecture:** Add a workspace-owned `font_aliases` relation and transactional RPC, expose it through a focused authenticated API/store, then inject alias snapshots into shared client/server resolution. Extend the selected-order metadata with an accessible mapping dialog whose mutation updates only the selected saved line and revisions.

**Tech Stack:** JavaScript ES modules, Supabase Postgres/RLS/RPC, Vitest, Playwright, HTML/CSS.

## Global Constraints

- Aliases are workspace-wide and marketplace-neutral.
- Alias identity uses NFKC normalization, trimmed/collapsed whitespace, and locale-independent lowercase; trailing `Laser` compatibility is not part of alias identity.
- Alias records reference stable `fonts.id` values.
- Mapping an existing line must atomically save the alias and that line, or roll back both.
- Previously saved unrelated designs must never be rewritten.
- Archived/deleted fonts remain explainable but are not valid new mapping targets and do not override presets on new imports.
- Preserve original marketplace values in `source.customerFontSelections`.
- Use a checked-in additive Supabase migration and verify it locally.

---

### Task 1: Shared alias normalization and resolution

**Files:**
- Modify: `src/amazon-customer-fonts.js`
- Modify: `tests/unit/amazon-customer-fonts.test.js`

**Interfaces:**
- Produces: `normalizeCustomerFontAlias(value): string`.
- Produces: `resolveCustomerFont(name, fontOptions, fontAliases): { fontId, font, alias, status } | null`, where `status` is `active`, `archived`, or `deleted`.
- Preserves: `resolveCustomerFontId(name, fontOptions, fontAliases): string | null` and `overlayCustomerFontsOnLines(lines, selections, fontOptions, fontAliases)` for callers.

- [ ] **Step 1: Add failing normalization and resolution tests**

Cover NFKC, whitespace collapse, case normalization, alias precedence, exact display-name fallback, trailing `Laser` compatibility, cross-workspace snapshot isolation by input, inactive alias targets returning metadata but no applicable font ID, and removal of the static `Super Boy` map.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

- [ ] **Step 3: Implement the shared functions and thread optional aliases through overlay/summary helpers**

Keep all name matching in this module. An alias input record has `{ id, aliasName, normalizedAlias, fontId }`; a font option has `{ id, displayName, label, archivedAt, deletedAt }`.

- [ ] **Step 4: Run the focused test and confirm pass**

Run: `npx vitest run tests/unit/amazon-customer-fonts.test.js`

- [ ] **Step 5: Commit the shared resolver slice**

Run: `git add src/amazon-customer-fonts.js tests/unit/amazon-customer-fonts.test.js` then `git commit -m "feat: resolve workspace font aliases"`.

### Task 2: Additive schema, RLS, and transactional mapping RPC

**Files:**
- Create via CLI: `supabase/migrations/<timestamp>_workspace_font_aliases.sql`
- Create: `tests/db/font-aliases.db.test.js`
- Modify when required by DB harness: `tools/run_db_tests.mjs`

**Interfaces:**
- Produces table: `public.font_aliases(id, workspace_id, font_id, alias_name, normalized_alias, created_by, updated_by, created_at, updated_at)`.
- Produces RPC: `map_workspace_font_alias(p_workspace_id uuid, p_alias_name text, p_normalized_alias text, p_font_id text, p_order_item_id text default null, p_design_id uuid default null, p_line_index integer default null, p_expected_order_revision bigint default null, p_expected_design_revision bigint default null)`.
- RPC returns authoritative alias/font metadata, complete updated line JSON when present, and updated order/design revisions.

- [ ] **Step 1: Create the migration with the mandated CLI**

Run: `npx supabase migration new workspace_font_aliases`. Stop if the command fails; do not invent a filename.

- [ ] **Step 2: Add failing database tests**

Prove workspace uniqueness, RLS isolation, active same-workspace target validation, conditional `Super Boy` seeding, alias-only future-line mapping, selected-line-only update, revision increments, reassignment, stale revision rollback, and concurrent/authoritative conflict behavior.

- [ ] **Step 3: Run the focused database test and confirm failure**

Run: `npm run test:db:local -- tests/db/font-aliases.db.test.js`

- [ ] **Step 4: Implement the additive migration and RPC**

Use the same workspace membership policy shape as `fonts`. Lock the alias and design/order rows in the RPC, validate both expected revisions before mutation, reject archived/deleted/cross-workspace fonts, update only `design_lines.font_id`, bump `designs.revision` and `order_items.revision`, and return authoritative state. Seed `Super Boy` by joining each workspace to its active `Super Boys` font.

- [ ] **Step 5: Reset/prepare local Supabase and run the focused database test**

Run: `npm run prepare:local`, then `npm run test:db:local -- tests/db/font-aliases.db.test.js`.

- [ ] **Step 6: Commit the database slice**

Stage the generated migration and DB test, then commit with `feat: persist workspace font aliases`.

### Task 3: Alias store, authenticated API, and workspace snapshot

**Files:**
- Create: `api/_lib/font-alias-store.js`
- Create: `api/font-aliases.js`
- Modify: `api/_lib/production-batch-store.js`
- Modify: `api/_lib/production-batch-mapper.js`
- Create: `tests/unit/font-alias-store.test.js`
- Create: `tests/unit/font-alias-api.test.js`
- Modify: `tests/unit/production-batch-store.test.js`

**Interfaces:**
- Produces: `listWorkspaceFontAliases({ workspaceId, supabase? })` returning browser-safe alias records with target font display/lifecycle metadata.
- Produces: `mapWorkspaceFontAlias(input)` invoking the RPC and mapping database conflict/validation errors to stable API errors.
- Produces endpoint: `GET /api/font-aliases` and `POST /api/font-aliases`.
- Extends production-batch/bootstrap payload with `fontAliases`.

- [ ] **Step 1: Add failing store, endpoint, and snapshot tests**

Test auth/method handling, canonicalization on the server, active-font validation delegated to RPC, 409 revision/conflict responses with authoritative mapping, safe response shape, and inclusion of aliases in bootstrap data without diagnostics.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/unit/font-alias-store.test.js tests/unit/font-alias-api.test.js tests/unit/production-batch-store.test.js`.

- [ ] **Step 3: Implement the store, endpoint, and snapshot mapping**

Reuse `resolveProductionBatchAuth`; never trust a client-provided normalized key; return plain-language errors plus stable codes; do not expose `etsy_import_diagnostics`.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `npx vitest run tests/unit/font-alias-store.test.js tests/unit/font-alias-api.test.js tests/unit/production-batch-store.test.js`.

- [ ] **Step 5: Commit the API slice**

Commit with `feat: expose workspace font alias mapping`.

### Task 4: Inject aliases into Etsy, Amazon, and later-line resolution

**Files:**
- Modify: `api/_lib/amazon-import-enrichment.js`
- Modify: `api/amazon-import.js`
- Modify: `api/etsy-import.js`
- Modify: `src/etsy-import.js`
- Modify: `src/app.js`
- Modify: `tests/unit/amazon-import-service.test.js`
- Modify: `tests/unit/etsy-import.test.js`
- Modify: `tests/unit/etsy-import-service.test.js`

**Interfaces:**
- Consumes: alias records from `listWorkspaceFontAliases` and Task 1 resolver signatures.
- Preserves: original `customerFontSelections[].name` values.

- [ ] **Step 1: Add failing Etsy/Amazon import and later-line tests**

Prove `Lemonade` resolves to the selected font for both marketplaces, archived aliases retain the preset font, existing imported designs are not overwritten on reimport, original source values survive, and a future numbered line uses the alias when materialized.

- [ ] **Step 2: Run focused import tests and confirm failure**

Run the changed Etsy and Amazon Vitest files explicitly with `npx vitest run`.

- [ ] **Step 3: Load and inject workspace aliases into both server import enrichers and browser resolution**

Pass one alias snapshot through `createAmazonItemEnricher`, its overlay/summary calls, Etsy clipboard normalization, and `applyCustomerFontToNewTextLine`.

- [ ] **Step 4: Run focused import tests and confirm pass**

Run the same explicit Vitest files.

- [ ] **Step 5: Commit the import integration slice**

Commit with `feat: apply font aliases during imports`.

### Task 5: Selected-order mapping dialog and immediate line application

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Modify: `tests/e2e/preview-layout.spec.js`
- Modify: `tests/e2e/production-batch-sync.spec.js`

**Interfaces:**
- Consumes: bootstrap `fontAliases`, active `FONT_OPTIONS`, and `POST /api/font-aliases`.
- Renders: `Line N Font: Marketplace Name (Resolved Name|Unmapped|Resolved Name — archived)` followed by map/edit action.

- [ ] **Step 1: Add failing browser tests for exact row copy and dialog behavior**

Cover mapped/unmapped/archived text, accessible map/edit action, focus return, search/select, current-line preview, disabled submit without selection, successful immediate persisted line update, future-line success feedback, replacement warning naming both fonts, 409 recovery, and non-mutating failure.

- [ ] **Step 2: Resolve this worktree's test URL and run focused tests to confirm failure**

Run the required `tools/dev_port.mjs` resolution command, then run `npm run test:e2e -- preview-layout production-batch-sync` or the repository-supported focused arguments.

- [ ] **Step 3: Add dialog markup/styles and isolated client helpers**

Implement row rendering without `innerHTML` for imported values, an accessible modal consistent with existing dialogs, active-font filtering/search, preview registration through existing font faces, and authoritative conflict warning/retry behavior.

- [ ] **Step 4: Implement successful-state reconciliation**

Update only the alias snapshot, returned design line, saved baseline, order/design revisions, row text, and preview. Preserve unrelated unsaved settings and do not mark them saved.

- [ ] **Step 5: Run focused browser tests and confirm pass**

Use the same resolved test URL and focused Playwright files.

- [ ] **Step 6: Commit the UI slice**

Commit with `feat: map marketplace fonts from design screen`.

### Task 6: Full verification and deployment handoff

**Files:**
- Modify only if failures reveal feature defects in files already in scope.

**Interfaces:**
- Verifies all prior task outputs as one production story.

- [ ] **Step 1: Run unit tests**

Run: `npm run test:unit`.

- [ ] **Step 2: Run database tests against freshly prepared local Supabase**

Run: `npm run prepare:local`, then `npm run test:db:local`.

- [ ] **Step 3: Run the build**

Run: `npm run build`.

- [ ] **Step 4: Run relevant browser tests through the safe runner**

Resolve the test URL as required by `AGENTS.md`, then run the two focused e2e files; expand to `npm run test:e2e` if focused coverage passes and runtime permits.

- [ ] **Step 5: Inspect migration status and working tree**

Run `git status --short`, `git diff --check`, and report the additive migration path. Do not apply it to production outside the `finish this worktree` workflow without explicit authorization.

- [ ] **Step 6: Request final code review and address actionable findings**

Use a fresh reviewer focused on correctness, transaction safety, workspace isolation, and regression risk; rerun affected verification after any change.

- [ ] **Step 7: Commit any final verification fixes**

Commit only scoped fixes with a descriptive message and leave the worktree ready for the standard finish workflow.
