# Etsy Import Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist server-only Etsy variation classification, pairing, and font-resolution diagnostics for every successful Etsy order import.

**Architecture:** The Etsy normalizer constructs a compact diagnostic envelope alongside its normal import contract. The order store writes this envelope to a dedicated JSONB column that is intentionally absent from all normal read projections; on an idempotent re-import it updates only this diagnostic field and existing permitted import metadata.

**Tech Stack:** JavaScript ESM, Vitest, Supabase Postgres JSONB migrations.

## Global Constraints

- Diagnostics must not contain OAuth credentials, request envelopes, or be copied into `source_json`, browser responses, telemetry, or normal application logs.
- The normal imported-order UI remains unchanged.
- Re-import must not overwrite saved design settings or design lines.
- Do not run the test suite for this task; regression tests are added for future runs.

---

### Task 1: Add a private Etsy diagnostic column

**Files:**
- Create: `supabase/migrations/<generated>_store_etsy_import_diagnostics.sql`

**Interfaces:**
- Produces: nullable `public.order_items.etsy_import_diagnostics jsonb`, readable only through trusted server queries.

- [ ] **Step 1: Create the migration through the Supabase CLI**

Run: `npx supabase migration new store_etsy_import_diagnostics`

- [ ] **Step 2: Add the additive schema change**

```sql
alter table public.order_items
  add column if not exists etsy_import_diagnostics jsonb;
```

### Task 2: Produce normalized Etsy diagnostic data

**Files:**
- Modify: `api/_lib/etsy-import-normalizer.js`
- Modify: `tests/unit/etsy-import-normalizer.test.js`

**Interfaces:**
- Produces: `item.etsyImportDiagnostics` with `variations`, `fontSelections`, and `fontResolutions` arrays.

- [ ] **Step 1: Add regression assertions for a two-line font selection and a rejected variation**

Assert each captured variation has a classification/reason and that the second line maps to its recognized font selection.

- [ ] **Step 2: Implement the minimal diagnostic envelope**

Create the envelope from Etsy variation metadata before returning the normalized import item. Keep it outside `source`.

### Task 3: Persist diagnostics privately on import and re-import

**Files:**
- Modify: `api/_lib/orders-store.js`
- Modify: `tests/unit/orders-store.test.js`

**Interfaces:**
- Consumes: `item.etsyImportDiagnostics`.
- Produces: `order_items.etsy_import_diagnostics`, excluded from existing read projections.

- [ ] **Step 1: Add regression assertions for private persistence and re-import replacement**

Assert the write row contains the diagnostic field, returned orders omit it, and an existing order update replaces diagnostics without changing design data.

- [ ] **Step 2: Extend imported-row construction and the existing-item update payload**

Write a JSON object only; omit null or malformed values. Include the field in existing-item updates independently of ship-date updates.

### Task 4: Document the production behavior

**Files:**
- Modify: `docs/requirements.md`

- [ ] **Step 1: Add the server-side Etsy audit requirement**

State that successful Etsy imports persist classified/pairing/font-resolution diagnostics in a dedicated private field and that ordinary responses and logs exclude it.
