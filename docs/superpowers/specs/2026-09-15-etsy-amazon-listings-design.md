# Etsy-to-Amazon listing preparation

Status: preparation milestone implemented and locally verified; provider quality and live Amazon milestones remain pending credentials. The user has requested progress while Amazon developer approval is pending. This document defines the first implementation milestone; it does not claim live Amazon validation or publishing is available.

## Outcome

An operator can prepare and retain an Amazon listing from an owned Etsy listing while Amazon is disconnected. Preparation includes source facts, downloaded photos, a proposed white-background main image, editable title and description, exactly five bullets, and explicit image/copy review. Once account access is available, the same saved draft can be validated and submitted as an inactive Amazon listing.

The requirements source of truth remains `docs/requirements.md`, including the supplied matched Etsy/Amazon reference pair.

## Approaches considered

1. **Preparation workspace with a separate Amazon submission adapter (recommended).** Produces useful reviewable drafts now, permits isolated testing, and retains work when the account connection is added.
2. **Wait for Amazon approval before building.** Permits account-specific schema discovery first, but delays independent import, image, and copy work.
3. **Export-only listing kit.** Less integration work initially, but requires manual entry and duplicates effort once direct submission is added.

## Operator workflow

Add a Listings navigation item and `/listings` route using the existing application shell. Use a draft list on the left and selected draft editor on the right, following the production workspace's calm visual style.

1. Paste an Etsy URL or listing ID. Resolve and validate the ID on the server; fetch listing content through the existing Etsy client and verify the listing belongs to the connected shop.
2. Save a source snapshot, retrieval time, and references to downloaded listing photos. Reopening or reimporting the same listing resumes its existing draft instead of overwriting edits.
3. Automatically recommend a main photo. Prefer a clear complete product photograph over charts, collages, and instructions; do not blindly equate Etsy's first image with the best Amazon main image.
4. Prepare a white-background derivative. Display original and result side by side with approve, reject/regenerate, choose another source, and upload replacement actions. Preserve original product lettering, geometry, hardware, and transparency. Do not fabricate obscured product parts.
5. Draft title, description, and exactly five bullets from source facts and confirmed shop defaults. Show missing or conflicting facts separately. All copy remains editable; regeneration proposes replacements without silently overwriting operator edits.
6. Review the selected gallery and its order. Distinguish main-image approval from gallery selection. Changes to an approved image or copy invalidate that part's approval.
7. Save the preparation draft. Show Amazon connection status separately from preparation status. When disconnected, the submission action is disabled with a clear explanation; local review completion never appears as Amazon acceptance.
8. After connection, validate required attributes against the actual seller, US marketplace, and product-type schema, then request Amazon validation preview. Show actionable issues in the editor before enabling submission.
9. Submit only the operator-reviewed revision as an inactive product-only listing, reconcile asynchronous results, and provide a Seller Central handoff for customization templates and activation.

## Confirmed defaults and boundaries

- One business, one Amazon US seller account, one Amazon listing per Etsy listing, no parent/child variations.
- Proposed brand value `Generic` reflects the inspected reference; validate with the account's product-ID exemption and product type before submitting.
- Base price is USD 19.99 for topper only. Store it in the draft now. Reel surcharges remain in the manually applied customization template. Product-only submission initially omits sales terms to preserve the intended inactive state; surface the saved price for manual completion.
- Never automatically activate a listing. Do not overwrite or duplicate the existing Amazon reference ASIN.
- Start with individual listing preparation, no batch generation, recurring synchronization, or automatic customization configuration.
- The inspected eight-character text limits and Candlepin-only choice are reference-template details, not restrictions on this feature or the geometry editor.

## Application boundaries

- New UI modules own listing state, draft editing, image review, and API calls. Add route registration in `src/app-routes.js`, navigation integration in `src/app.js`, and matching local/hosted route support.
- Authenticated listing API handlers reuse the existing workspace authorization and authenticated-request patterns. Every draft, asset, and operation lookup is scoped to the authorized workspace.
- Extend `api/_lib/etsy-client.js` only as needed for owned-listing retrieval. Reuse encrypted Etsy tokens and refresh behavior. Request additional scopes only if required by the selected endpoint; report reconnect requirements explicitly.
- Keep source normalization, fact extraction, copy generation, image preparation, and Amazon payload construction in separate modules with testable inputs and outputs.
- Copy/image services are server-side adapters. Their API keys are separate from Amazon credentials. Missing configuration produces an explicit unavailable state, not canned output presented as AI generation. Local fixtures test the workflow without paid calls.
- Choose and configure the production copy/background-removal providers during implementation, after comparing support for exact lettering and transparent acrylic/straps on the reference photo. Do not promise image quality before that check. Manual replacement upload remains available.

## Persistence and operations

Use additive checked-in migrations for workspace-scoped listing drafts, image assets, and operation records. Drafts retain source identity/snapshot, editable copy, confirmed facts, unresolved facts, price in integer cents, revision, approvals, and eventual Amazon identity/status. Asset records retain immutable original/derivative storage references, media metadata, source rank, gallery position, and approval revision.

Enforce one draft per workspace, Etsy shop/listing, and target marketplace for this first phase. Reserve a stable seller SKU per draft before any submission; retries retain it. A matching SKU already present in Amazon requires reconciliation rather than a blind full replacement.

Enable row-level security and restrict access according to workspace membership or server-only access, matching the existing app's authorization boundary. Keep credentials and raw provider diagnostics server-only. Use a dedicated private asset bucket for drafts. Expose only approved publishable assets through an Amazon-fetchable delivery mechanism when submission is enabled.

Persist operation state so imports, image processing, and generation can fail independently. Use bounded requests, explicit retryable failures, and owner-scoped operation claims to avoid duplicate work. Stale operations must not overwrite a newer draft revision. If generation needs to outlive one hosted request, use a durable worker/job runner rather than unawaited background promises.

Downloads accept expected Etsy image hosts and validate redirect destinations, byte limits, content types, and decoded image sizes. Do not allow pasted URLs or provider-returned URLs to become unrestricted server fetches.

## Amazon integration after credentials arrive

Implement a server-side SP-API client using the private app's Login with Amazon credentials and refresh token. Retrieve account-specific product definitions and validate the existing exemption. Separate local completeness, Amazon validation, submission acceptance, processing, and confirmed inactive status.

Persist submission attempts with draft revision, payload hash, stable SKU, and safe response identifiers. After a timeout, query the same SKU before deciding whether another write is necessary. Poll with bounded backoff initially; notifications can follow if scale justifies them. Image processing failures remain visible and retryable.

Use mocks for these cases before credentials exist. Never label mock tests as successful live integration. Sandbox responses cannot prove real category eligibility, exemption applicability, image acceptance, or inactive behavior.

## Verification and acceptance

- Unit tests cover Etsy ID parsing, source normalization, conflicting facts, five-bullet validation, approval invalidation, stable draft/SKU identity, and stale-operation protection.
- API/database tests cover authentication, cross-workspace isolation, duplicate imports, revision conflicts, and preserved drafts after provider errors. Apply the migration to a fresh isolated local database using the repository workflow.
- Browser tests cover import, save/reload, copy editing, image selection/rejection, disconnected status, and review invalidation. Use the worktree-specific test port and the canonical end-to-end runner.
- Provider quality checks inspect lettering, contours, clear straps, and white-background output on the supplied source image once service access exists.
- Amazon contract tests cover validation issues, throttling, expired credentials, timeout reconciliation, partial image failures, and accepted-but-not-finished processing using fixtures.
- Live completion requires account-specific validation and an explicitly authorized new inactive listing after credentials arrive. The existing reference listing stays a read-only example.

## Milestones

1. Saved Listings workspace, owned Etsy import, downloaded assets, editable five-bullet copy, review state, and disconnected Amazon status.
2. Configured copy and image services with reference-photo quality verification and recoverable operations.
3. Live Amazon schema validation, inactive submission, image processing verification, and Seller Central handoff after credentials are available.

The first milestone is useful without Amazon or generation-service credentials. The second does not depend on Amazon but does depend on the selected service configuration. The third cannot be verified without the seller's production authorization.
