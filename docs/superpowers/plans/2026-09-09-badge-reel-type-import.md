# Badge Reel Type Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize Amazon and Etsy badge-reel selections to stable IDs, persist and backfill them, and show their canonical labels in Orders item details.

**Architecture:** A shared pure catalog module owns canonical IDs, labels, alias normalization, and extraction helpers. Both marketplace normalizers place a recognized ID in normalized source metadata; the order store persists it in a dedicated nullable column, API mappers expose it, and Orders renders the catalog label while distinguishing missing from retained-but-unrecognized values.

**Tech Stack:** JavaScript ESM, Supabase/PostgreSQL migrations and RPCs, Vitest, DOM-based app UI tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-badge-reel-type-import-design.md`

## Global Constraints

- Store canonical IDs, never marketplace display strings, in `public.order_items.badge_reel_type_id`.
- The initial canonical ID is `swivel-alligator` with display label `Swivel Alligator`.
- Preserve original Amazon responses and Etsy variations in existing source metadata.
- Missing or unknown values cannot fail an import.
- Re-import may fill a null canonical ID but cannot replace a non-null ID or alter saved design data.
- The production migration is additive; do not apply it without the separate deployment workflow required by `AGENTS.md`.
- Do not add search, filtering, editing, Production Batch UI, or export behavior in this feature.

---

### Task 1: Canonical badge-reel type catalog

**Files:**
- Create: `src/badge-reel-types.js`
- Create: `tests/unit/badge-reel-types.test.js`

**Interfaces:**
- Produces: `resolveBadgeReelTypeId(value): string | null`
- Produces: `badgeReelTypeLabel(id): string | null`
- Produces: `findBadgeReelTypeCandidate(entries, { label, value }): { rawValue: string, id: string | null } | null`

- [ ] Write failing tests for canonical alias resolution, case/whitespace/punctuation normalization, exact field-label matching, first-candidate behavior, unknown values, and unknown IDs.
- [ ] Run `npx vitest run tests/unit/badge-reel-types.test.js` and confirm the missing module causes failure.
- [ ] Implement the smallest immutable catalog and pure helpers that satisfy the tests; do not use fuzzy or substring matching.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Add canonical metadata to Amazon and Etsy normalization

**Files:**
- Modify: `api/_lib/amazon-customization-normalizer.js`
- Modify: `api/_lib/etsy-import-normalizer.js`
- Modify: `tests/unit/amazon-customization-normalizer.test.js`
- Modify: `tests/unit/etsy-import-normalizer.test.js`

**Interfaces:**
- Consumes: catalog resolution helpers from `src/badge-reel-types.js`.
- Produces: optional `normalizedItem.source.badgeReelTypeId`.

- [ ] Add failing Amazon tests using `Badge Reel Type: Swivel Alligator Clip`, an unknown value, and no matching field; assert raw `personalizationResponses` remain unchanged.
- [ ] Add failing Etsy tests using the captured fixture's `Badge Reel: Swivel Alligator`, an unknown value, and no matching variation; assert raw `variations` remain unchanged.
- [ ] Run both focused normalizer suites and confirm the new assertions fail.
- [ ] Extract candidates from Amazon configuration fields and Etsy variations, adding `source.badgeReelTypeId` only for a recognized type.
- [ ] Re-run both focused suites and confirm they pass.

### Task 3: Add durable storage, safe backfill, and re-import behavior

**Files:**
- Create: `supabase/migrations/<generated>_store_badge_reel_type.sql` using `npx supabase migration new store_badge_reel_type`
- Create: `tests/unit/badge-reel-type-migration.test.js`
- Modify: `api/_lib/orders-store.js`
- Modify: `api/_lib/amazon-import-store.js` if its transactional payload needs explicit coverage
- Modify: `supabase/migrations/20260726051443_amazon_import_state_and_transactional_order_import.sql` only if the current RPC definition is the source template; otherwise add the replacement RPC definition to the new migration
- Modify: `tests/unit/orders-store.test.js`
- Modify: `tests/unit/amazon-import-store.test.js`

**Interfaces:**
- Consumes: `source.badgeReelTypeId`.
- Produces: nullable `order_items.badge_reel_type_id` and `badgeReelTypeId` in mapped order-item objects.

- [ ] Generate the migration with the required Supabase command; stop if generation fails.
- [ ] Add failing migration tests asserting the nullable column, exact known aliases for both retained source shapes, null-only updates, and no destructive statements.
- [ ] Add failing store tests for new-row persistence, API mapping, null-only re-import enrichment, and preservation of a non-null stored ID and existing design.
- [ ] Run the migration and store suites and confirm the new assertions fail.
- [ ] Implement the additive migration, including any current Amazon transactional RPC replacement needed to read/write the column.
- [ ] Update all relevant order-item selects, row builders, and mappers. Extend existing-item update logic so a recognized incoming ID fills only a null stored value.
- [ ] Re-run the focused migration and store suites and confirm they pass.

### Task 4: Render the canonical value in Orders item details

**Files:**
- Modify: `src/app.js`
- Modify: `tests/unit/orders-workspace.test.js` or the existing DOM rendering test that owns selected-order item cards
- Modify: `tests/e2e/orders-workspace.spec.js` if that is the existing Orders card coverage location

**Interfaces:**
- Consumes: `item.badgeReelTypeId`, retained `item.source` metadata, and `badgeReelTypeLabel(id)`.
- Produces: a `Badge reel` metadata row between Color and Quantity with `Swivel Alligator`, `Not set`, or `Unrecognized`.

- [ ] Add failing UI tests for recognized, missing, retained-unrecognized, and unknown-stored-ID states, including metadata order.
- [ ] Run the focused UI suite and confirm failure.
- [ ] Add a small helper that detects whether retained source data contains a reel-type candidate, then render the new safe text-only metadata row.
- [ ] Re-run the focused UI suite and confirm it passes.

### Task 5: Integrated verification and documentation check

**Files:**
- Verify: `docs/requirements.md`
- Verify: all files changed above

**Interfaces:**
- Consumes: the completed feature slices.
- Produces: verification evidence that new and historical marketplace data follow one stable order-item contract.

- [ ] Run `npx vitest run tests/unit/badge-reel-types.test.js tests/unit/amazon-customization-normalizer.test.js tests/unit/etsy-import-normalizer.test.js tests/unit/badge-reel-type-migration.test.js tests/unit/orders-store.test.js tests/unit/amazon-import-store.test.js tests/unit/orders-workspace.test.js`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run build`.
- [ ] Run the relevant Orders Playwright test through `npm run test:e2e` using the worktree-safe runner if local dependencies are available.
- [ ] Run `git diff --check`, inspect the complete diff against the approved spec, and confirm no production migration was applied.
- [ ] Report the generated migration path, additive/destructive classification, verification results, and the required next step for applying it to production project `oezjskcygvfyezvoulzw`.
