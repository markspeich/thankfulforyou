# Listing Preparation Implementation Plan

> Use subagent-driven-development for bounded implementation and review tasks. User approved the design and execution; continue without additional design gates.

**Goal:** Ship saved Etsy-to-Amazon preparation drafts while Amazon access is pending.
**Architecture:** Workspace-scoped persisted drafts, separate UI module, server-side Etsy/asset service, optional generation adapters. Amazon writes remain unavailable until real credentials/schema validation can be verified.
**Tech stack:** Existing browser JavaScript, Node API handlers, Supabase/Postgres/storage, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-09-15-etsy-amazon-listings-design.md`

## Shared interface

`/api/listings` GET returns `{drafts, capabilities}`; GET `?id=` returns `{draft, capabilities}`.
POST body `{action:'import', source}` returns `{draft, existing}`.
PATCH body `{id, revision, changes}` returns `{draft}`.
POST actions `generateCopy`, `prepareImage`, `uploadImage` use `{id, revision, ...}` and return `{draft}`.
Draft: `{id, revision, etsyListingId, sourceUrl, sourceTitle, sourceDescription, title, description, bullets: string[5], basePriceCents:1999, facts: object, warnings:string[], images:[{id,url,sourceUrl,kind:'original'|'prepared'|'uploaded',alt,selected,main,approved}], copyApproved:boolean, createdAt, updatedAt}`.
Capabilities: `{amazon:false, copyGeneration:boolean, imagePreparation:boolean}`. Never imply live validation.
Changes whitelist: `title,description,bullets,basePriceCents,copyApproved,images` (image changes only selection/main/approval for existing IDs). Server invalidates approvals when content changes. Revision compare-and-swap prevents lost updates.
UI factory `createListingsWorkspace({root,getAccessToken,onAccessToken,onSelect})` returns `{open(id),reset()}`. Route `/listings/:id?`.
Provider module `api/_lib/listing-providers.js`: `getListingCapabilities(env)`, `generateListingCopy({draft,env,fetchImpl})` -> `{title,description,bullets,warnings}`, `prepareListingImage({bytes,mimeType,env,fetchImpl})` -> `{bytes,mimeType}`. No paid calls without configured provider keys.

## Tasks

- [x] 1. Backend: write behavioral tests for source parsing/ownership, duplicate import preservation, revision conflicts, approval invalidation and auth isolation; run failing tests. Implement migration, model/store, Etsy download service, API and bounded private asset delivery. Run focused unit and local database tests. Files: `api/_lib/listing-handler.js`, `api/_lib/listing-*.js` excluding providers, generated migration, corresponding tests.
- [x] 2. Frontend: test disconnected draft edit/save/reload and image review. Implement standalone workspace/API module and integrate app navigation/routes/HTML/styles. Preserve unsaved edits on request errors; reset account state on sign-out. Files: `src/listings-*.js`, shell files, browser tests.
- [x] 3. Providers: test configuration absence, successful validated copy/image responses, malformed/error/timeout responses. Implement server-only configurable adapters and provider docs. Retain deterministic fixtures only in tests. Files: provider module, provider unit tests, setup documentation.
- [x] 4. Integration: wire local API route, verify static build includes modules, apply migration to isolated local stack, run combined tests, inspect workspace in browser. Independently review authorization, uploads/downloads, and revision guards.
- [x] 5. Record verified behavior and remaining credential-dependent checks. Do not deploy or write to existing marketplace listings.

## Verification commands

Focused unit tests: `npm run test:unit -- tests/unit/listing-*.test.js tests/unit/listings-*.test.js` (enumerate exact file paths if shell glob is not expanded).
Build: `npm run build`.
Local schema: `npm run prepare:local`, then relevant local DB test.
Resolve this worktree's test port via `tools/dev_port.mjs` with `DEV_SERVER_PORT_ROLE=test`, then use `npm run test:e2e -- tests/e2e/listings.spec.js`.

## Rulings and progress

Final local verification: 100 unit files / 907 tests passed; 12 listing database tests passed after a fresh isolated schema reset; five browser checks passed; production static build passed. Reviewed a browser screenshot and corrected gallery alignment. Tests cover private assets, concurrent revisions/uploads/imports, operation claims, provider failure preservation, edit/save/reload, visible import errors, and stale-session responses.

Deployment uses `/api/listings` rewritten through the existing Etsy connection function to retain the project's 12-function limit. The additive migration is checked in and applied only to this worktree's local database. No production deployment or marketplace writes occurred. Optional adapters are implemented; live provider quality and Amazon integration are not verified. See `docs/listing-preparation.md` and `docs/listing-provider-setup.md`.

- Approved design is authority. Existing isolated worktree is used; no new checkout required.
- Interface review: backend owns server contract; frontend consumes exact camelCase fields above; provider module is dependency-injected and owns no persistence. Integration owner resolves mismatches.
- Initial Amazon integration is disabled deliberately, not simulated; live schema/publishing milestone remains credential-blocked.
- Provider configuration may remain unavailable; manual copy editing/replacement images must still work. Do not claim generated content in an unconfigured environment.
