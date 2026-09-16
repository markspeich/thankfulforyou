# Task 1 report: Amazon production details

## Files changed

- `api/_lib/listing-store.js`
- `api/_lib/listing-amazon-production.js`
- `tests/unit/listing-store.test.js`
- `tests/unit/listing-amazon-production.test.js`
- `tests/db/listing-drafts.db.test.js`
- `supabase/migrations/20260916210103_persist_amazon_production_details.sql`

## TDD record

The initial required unit run failed as expected: `amazonProductionDetails` was an unsupported draft field; ordinary listings did not emit saved package attributes; and missing details did not create a local production issue. The targeted database test also failed as expected with the unsupported-field error.

After the minimal implementation, `npx vitest run tests/unit/listing-store.test.js tests/unit/listing-amazon-production.test.js` passed with 27 tests in 2 files.

## Migration

Generated with `npx supabase migration new persist_amazon_production_details`:

`supabase/migrations/20260916210103_persist_amazon_production_details.sql`

This additive migration adds the non-null JSONB `amazon_production_details` column with an empty-object default and introduces `update_listing_draft_atomic_v2`. The v2 RPC preserves the prior RPC for deployed callers while atomically persisting details, checking revision, and incrementing revision.

## Assumptions

- Production details are deliberately separate from read-only Etsy `facts_json`.
- A draft lacking complete details remains saveable but cannot pass production validation.
- Production-detail edits retain copy and image approvals; draft revisioning still makes the draft dirty.

## Blockers and follow-up

Targeted local database verification could not be completed because the existing local Supabase Postgres endpoint was unavailable (`ECONNREFUSED 127.0.0.1:54322`). Applying the generated migration with `npx supabase migration up --local` therefore did not run. No database was reset. The controller should start/prepare this worktree's local Supabase environment, apply the additive migration, and rerun the targeted DB test.
