# Final Review Fix Report: Badge Reel Type Import

## Status

Complete. All four findings and the compact-loading metadata issue are corrected in one cohesive fix wave. No subagents were spawned. The migration was not applied to production.

## Changes

- Historical untagged Etsy rows now use their retained variations array. Tagged Amazon rows use Amazon metadata only; unknown marketplace tags do not fall through to Etsy. Mixed-shape and unknown-first fixtures verify this separation.
- The retained-candidate SQL helper accepts only arrays for Amazon responses and Etsy variations. JSON null, object, string, and number fixtures complete without assigning a canonical ID.
- Every new Amazon normalization retains `source.badgeReelTypeCandidate = { present, id }`. It records the first public candidate even when blank, unknown, or a rejected URL. It contains no raw response or internal field data. Existing accepted response arrays and design text remain unchanged. SQL backfill prefers this marker and otherwise uses legacy accepted responses, excluding internal fields.
- Generic imports atomically ignore conflicting inserts and use the returned inserted IDs for counts and design creation. Conflicting rows are read again for persistence audit results. The race regression injects a concurrent skipped order with a canonical ID and an unprotected draft design immediately before insertion, then verifies the whole row and design remain unchanged while a second truly new item is inserted and counted.
- Compact summary RPC items carry only `badge_reel_type_candidate_present`; the mapper exposes `hasBadgeReelTypeCandidate`. Orders renders unresolved candidates as `Unrecognized` even when detail hydration fails. Full details also honor the new Amazon marker. No raw values were added to compact responses.
- `docs/requirements.md` records the first-candidate, historical-source, malformed-array, concurrent-import, and compact-metadata requirements.

## Files Changed

- `api/_lib/amazon-customization-normalizer.js`
- `api/_lib/orders-store.js`
- `src/app.js`
- `supabase/migrations/20260909184445_store_badge_reel_type.sql`
- `tests/unit/amazon-customization-normalizer.test.js`
- `tests/unit/orders-store.test.js`
- `tests/db/badge-reel-type-migration.db.test.js`
- `tests/e2e/orders-workspace.spec.js`
- `docs/requirements.md`
- This report.

## Test-First Evidence

- Before production changes, the focused normalizer/store run failed seven new cases: five missing candidate-marker assertions, the overwritten concurrent order, and the absent compact presence signal.
- Before SQL changes, the executable migration fixture failed with PostgreSQL `cannot extract elements from a scalar` on malformed retained JSON.
- Before the compact UI correction, the browser regression expected `Unrecognized` and received `Not set` after detail hydration failed.
- After fixing compact handling, an added full-source blank-marker UI assertion independently failed with the same incorrect `Not set` result. Adding marker handling made it pass.
- Existing exact normalizer output expectations were updated for the deliberately added absence marker; existing raw response array expectations remain intact.

## Final Verification

- Focused unit suites: `npx vitest run tests/unit/badge-reel-types.test.js tests/unit/amazon-customization-normalizer.test.js tests/unit/etsy-import-normalizer.test.js tests/unit/badge-reel-type-migration.test.js tests/unit/orders-store.test.js tests/unit/amazon-import-store.test.js tests/unit/orders-workspace.test.js` — **121 tests passed in 7 files**.
- Full unit suite: `npm run test:unit` — **853 tests passed in 92 files**, exit 0.
- Executable SQL fixture: `node tools/run_with_supabase_env.mjs --env local -- npx vitest run --config vitest.db.config.js tests/db/badge-reel-type-migration.db.test.js` — **1 test passed**, exit 0. The final fixture covers 24 historical/marker/malformed cases, compact projection, unchanged source JSON, and existing non-null ID preservation. It runs inside a rolled-back transaction against this worktree's isolated local Supabase database.
- Browser verification: resolved this worktree's test URL with `DEV_SERVER_PORT_ROLE=test` and `tools/dev_port.mjs` to `http://127.0.0.1:4679`; exported that URL and `PORT=4679`; ran `npm run test:e2e -- test tests/e2e/orders-workspace.spec.js --grep 'badge reel'` — **2 tests passed**, exit 0.
- `npm run build` — passed, exit 0.
- `git diff --check` — passed. Git emitted only its existing Windows line-ending normalization notices.

## Environment Notes and Limits

- Local database verification required escalation because the Supabase wrapper resolves the CLI through the machine npm cache. Only the isolated local database was used.
- Sandboxed Playwright runs passed their assertions but lingered during Windows subprocess shutdown; those runner sessions were interrupted. The same focused command completed normally with escalated subprocess permissions and exit 0. Browser output retains existing color-environment warnings and unrelated Etsy-connection diagnostic logs.
- The Supabase skill informed the conflict-option and restricted helper-function review; the installed client source confirms `ignoreDuplicates` sends PostgreSQL/PostgREST ignore-duplicate semantics. No dependencies, auth policies, or production credentials were changed.
- Legacy Amazon rows cannot reconstruct already-discarded rejected/blank candidates. As specified, they fall back to retained accepted responses; future imports preserve the authoritative outcome in the new marker.

## Migration and Commit

The existing, unpublished migration `supabase/migrations/20260909184445_store_badge_reel_type.sql` remains additive. Its new pure helper is `security invoker`, has an empty search path, and grants execution only to `service_role` (besides owner access). Backfill updates only null canonical IDs; executable fixtures confirm source JSON is untouched. The existing transactional Amazon wrapper and Orders RPC protections remain in place.

Production project `oezjskcygvfyezvoulzw` still needs this migration applied through the approved deployment/finish workflow before dependent code is deployed. No production migration was applied here.

All changes and this report are committed together under `Fix badge reel import review findings`; the exact commit hash is returned in the agent completion message.
