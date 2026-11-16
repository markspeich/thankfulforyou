# Automatic Batch Addition Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Automatically tag saved orders added to production.
**Architecture:** Orders mutation handlers reconcile the saved batch after additions and return shipStationTagging feedback; UI reflects saved additions with successful or incomplete tagging.
**Tech Stack:** JavaScript, existing ShipStation client, Vitest, Playwright.
**Spec:** ../specs/2026-11-15-auto-tag-batch-additions-design.md

## Review focus
- Single, bulk and production clipboard additions all covered; Orders-only imports unchanged.
- Tagging failure never rolls back or disguises saved membership; no false-success feedback.
- Authenticated workspace snapshot only, no raw upstream errors.
- Existing manual reconciliation and completion cleanup remain intact.

### Server
- [x] Write failing tests for three addition paths, orders-only/no-op exclusions, safe partial warnings and saved snapshot ownership.
- [x] Reconcile after successful membership mutation and append response envelope.
- [x] Run Orders route, tagging and completion regressions.

### UI
- [x] Write failing browser coverage for automatic success and warning outcomes while preserving additions.
- [x] Add reusable feedback rendering for single/group/bulk/production paste paths with no extra tagging request.
- [x] Verify working, success, red warning, draft/selection preservation and recovery guidance.

### Finish verification
- [x] Review combined changes, update requirements/continuity, run full unit suite, affected browser tests, build and whitespace checks.

## Verification

- New backend tests observed red then green; 50 focused route/helper tests passed, and root's combined route/helper/tag-service/client run passed 95 tests.
- Full unit run: 1,099 passed, two existing export-svg tests exceeded their 5-second timeout. Isolated rerun of all 43 export-svg tests passed without code changes (all 1,101 cases covered across runs).
- All 100 Orders workspace + production batch browser tests passed, including eight new automatic-tag success/warning cases spanning single item, selected order, checked orders and production paste. Confirmed no additional browser tag POST.
- Build and whitespace checks passed. Independent review found no actionable issues.
- No migrations or live mutations. Changes remain local and uncommitted on feat/auto-tag-batch-additions; not deployed.

## Finish verification — November 16, 2026

- Latest origin/main already included; no merge changes required.
- Fresh unit suite: 1,100 passed; one unchanged SVG-export test exceeded its five-second timeout. Its isolated rerun passed at the original timeout (4.47 seconds), covering all 1,101 unit cases across runs. No export code or test thresholds changed.
- All 100 affected Orders/Production Batch browser tests passed; build and whitespace checks passed.
- All 52 local migration versions match production oezjskcygvfyezvoulzw exactly; no migrations required or applied.
- Verification used mocks and did not mutate live ShipStation tags.
