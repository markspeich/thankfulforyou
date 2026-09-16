# Amazon sandbox listing workflow

User approved this next milestone with "Proceed". This extends the approved Etsy/Amazon design; no production writes are authorized by sandbox configuration.

## Design and interfaces

- Local checks require saved approved copy, title/description/five nonempty bullets, one selected approved main image and approval for every selected image. Build a provisional `PRODUCT` / `LISTING_PRODUCT_ONLY` payload with Generic brand and GTIN exemption; no price/quantity/offer/ASIN is transmitted. Actual badge-reel product type and exemption remain production-account checks.
- Stable SKU: `TFY-` plus the draft UUID without hyphens. Persist attempts bound to workspace, draft revision, SKU, and payload hash. Concurrent operations are claimed in Postgres. Never treat a static sandbox response as a created/inactive listing.
- Server client `createAmazonSandboxClient({env,fetchImpl,...})` exposes `preview({sku,payload})`, `submit({sku,payload})`, `get({sku})`; all URLs hardcoded North America sandbox, LWA token endpoint only for credentials. Preview uses real stable SKU; its default canned ACCEPTED response is only protocol-test success. Capture normalized `{status,sku,submissionId,issues,requestId}`. Expired token refresh once; bounded throttling handling. Do not auto-replay an uncertain PUT; mark unknown and reconcile via GET. A canned unrelated SKU cannot resolve uncertainty.
- Existing GET `/api/listings` and GET `?id` return capabilities with `amazonSandbox:boolean` (production `amazon:false` remains). Draft gets `amazonSandbox:{sku,attempts:[{id,revision,action,status,issues,createdAt}],notice}`. Actions `validateAmazonSandbox`, `submitAmazonSandbox`, `reconcileAmazonSandbox` accept `{id,revision}` and return `{draft}`. Precondition failures return safe 409/422; remote results including invalid/unknown are persisted and returned.
- UI shows "Amazon sandbox" panel, local readiness issues, three explicit test actions and attempt history. Require saving dirty edits, clear stale result readiness after revision changes, protect auth/session epochs. Submission requires a successful preview for the same revision. Unknown submission requires a status check; static mismatches remain unconfirmed. Never enable production publish.
- Local start loads only named listing-provider keys from `.local/listing-providers.env` and sandbox keys from `.local/amazon-sp-api.sandbox.env`, with explicit allowlist. No implicit `.env.local` loading. Hosted configuration uses server environment variables.

## Tasks

- [x] Root: migration, attempt store/service, candidate payload/local checks, API integration, env loading and provider-config presence check.
- [x] Client agent: sandbox-only SP-API adapter and focused unit tests; safe CLI for real Listings sandbox protocol verification.
- [x] UI agent: sandbox panel and API actions with browser tests, no backend edits.
- [x] Root: local DB concurrency/isolation tests, combined unit/browser/build verification, actual sandbox preview/submission test, docs and limitations.

Existing developer credentials stay local. Do not print tokens, secrets, signed image URLs, or raw upstream error bodies. No paid generation calls unless a real configured provider is present. Provider quality is a separate live check.

## Verification result

- Full unit suite: 927 tests across 104 files passed. Final focused API/client/UI-state suite: 17 passed after review fixes.
- Fresh local database migration and persistence suite: 14 passed.
- Browser preparation and sandbox workflows: 9 passed using mocked API responses with the persisted backend action/issue contract.
- Live sandbox: valid preview VALID, invalid preview INVALID, synthetic submission ACCEPTED. No production listing was created.
- Build passed. Provider credentials remain absent, so live copy generation and background-removal quality remain unverified.
- Independent review caught the UI/history action mismatch; corrected and verified with actual preview, submit, and status-check button flows.
