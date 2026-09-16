# Task 1 Brief: Persist and validate per-draft Amazon production details

Implement Task 1 from `docs/superpowers/plans/2026-09-16-amazon-production-release.md` using strict TDD.

## Scope

- Modify `api/_lib/listing-store.js`.
- Modify `api/_lib/listing-amazon-production.js`.
- Modify `tests/unit/listing-store.test.js`.
- Modify `tests/unit/listing-amazon-production.test.js`.
- Generate an additive migration using `npx supabase migration new persist_amazon_production_details`; do not invent the timestamp manually.
- Modify `tests/db/listing-drafts.db.test.js` only as needed for persistence coverage.
- Do not edit browser UI files; those belong to Task 2.
- Do not spawn agents or expand scope.

## Required contract

`draft.amazonProductionDetails` must contain:

- `packageLengthInches`: finite positive number
- `packageWidthInches`: finite positive number
- `packageHeightInches`: finite positive number
- `packageWeightOunces`: finite positive number
- `manufacturer`: trimmed nonempty text, maximum 200 characters
- `partNumber`: trimmed nonempty text, maximum 200 characters
- `specialFeature`: trimmed nonempty text, maximum 200 characters
- `closureType`: trimmed nonempty text, maximum 200 characters

Persist the object separately from imported/read-only Etsy `facts_json`, preferably in a non-null JSONB column defaulting to `{}`. Draft update must remain atomic, revision-checked, and revision-incrementing. Use a new versioned RPC name so existing deployed callers are not broken during an atomic migration/code rollout.

`normalizeListingChanges` must accept only the complete object above when supplied and reject missing, extra, invalid, zero, negative, NaN, infinite, or overlong values with safe `400` listing errors. `applyListingChanges` must invalidate stale copy approval only for copy fields; production-detail changes still make the draft dirty and revisioned but do not falsely revoke copy or image approval.

`buildProductionPayload` must remove the Etsy listing-ID hardcode. It must map saved production details to `item_package_dimensions`, `item_package_weight`, `manufacturer`, `part_number`, `special_feature`, and `closure` for every listing. Missing/invalid details must produce local issues that block production validation/submission. Details must participate in the production content hash through the emitted non-image attributes.

Retain `LISTING_PRODUCT_ONLY`; do not add price, offer, quantity, or inventory attributes. Retain country `US`, no batteries, and `not_applicable` dangerous-goods declarations. Retain all existing approval, image, duplicate, confirmation, and uncertain-outcome protections.

## TDD and verification

First add tests that fail for the missing behavior and run:

`npx vitest run tests/unit/listing-store.test.js tests/unit/listing-amazon-production.test.js`

Record the expected failing output in the report. Then implement the minimum change and rerun the same command. If a local database is already prepared, run only the targeted database test without resetting operator data, using the safe existing-environment command described in AGENTS.md; otherwise report that DB verification remains for the controller.

## Deliverables

Commit only Task 1 files on the current branch with message `Add per-listing Amazon production details`. Write a report to `docs/superpowers/plans/2026-09-16-amazon-production-release-task-1-report.md` covering files changed, the red test failure, green test results, migration name, assumptions, and blockers. Stop if migration generation fails or requirements become ambiguous.
