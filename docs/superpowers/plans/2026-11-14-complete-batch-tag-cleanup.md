# Complete Batch Tag Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Remove the app-owned ShipStation tag when completing production.
**Architecture:** Authenticated completion loads the saved batch, performs tag-only cleanup, then completes the existing database transaction. Existing frontend rollback preserves the active batch on failure.
**Tech Stack:** JavaScript, ShipStation V2, Vitest, Playwright.
**Spec:** ../specs/2026-11-14-complete-batch-tag-cleanup-design.md

## Constraints and review focus
- Preserve unrelated tags; discover all pages before deletions; include non-pending shipments.
- Check workspace ownership before external writes; do not complete DB on any cleanup failure.
- Report partial deletion and database-after-cleanup failure truthfully; retry is idempotent.
- No migrations, live mutations, new dependency, or lifecycle changes to selected-item operations.

### Server
- [x] Write/run failing cleanup and completion-route tests for success, empty tags, discovery/deletion failure, and ownership; complete DB only after successful cleanup.
- [x] Add focused cleanup service using existing client and wire whole-batch complete action. Response includes shipStationCleanup: { removedTags }.
- [x] Run relevant service/client/route regression tests.

### UI
- [x] Add failing browser coverage for cleanup-aware success and failure retaining the active batch.
- [x] Update confirmation, working and completion descriptions/metrics and error guidance.
- [x] Run focused browser tests, unit suite, build and diff checks; review changes and update continuity.

## Verification

- Red/green browser test confirmed cleanup messaging was absent, then verified success counts and cleanup-failure batch restoration.
- Full unit suite: 109 files / 1,089 tests passed.
- Production-batch browser suite: 41 tests passed.
- Static build and whitespace checks passed; independent review found no remaining actionable issues.
- Database uncertainty wording corrected to instruct refresh/status check before retry after cleanup succeeds but completion cannot be confirmed.
- No migration, deployment, or live tag mutation performed. Changes remain local on feat/complete-batch-tag-cleanup.

## Finish verification — November 15, 2026

- Latest origin/main already included; no merge changes needed.
- Fresh verification: 1,089 unit tests, 42 completion/production-batch browser checks, static build and whitespace checks passed.
- All 52 checked-in migration versions exactly match production oezjskcygvfyezvoulzw; no migrations needed or applied.
- No live ShipStation tags changed by verification.
