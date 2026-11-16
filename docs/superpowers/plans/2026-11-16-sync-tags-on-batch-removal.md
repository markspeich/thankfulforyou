# Batch Removal Tag Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Keep Current Production Batch tags aligned when items leave production, including trash removal.
**Architecture:** Reuse saved-batch reconciliation after membership removals with HTTP200 warning feedback; support empty-batch tag clearing and manual recovery.
**Tech Stack:** Existing JavaScript API, ShipStation V2 client, Vitest, Playwright.
**Spec:** ../specs/2026-11-16-sync-tags-on-batch-removal-design.md

## Review focus
- Trash and selected removal/skip/complete routes covered; whole-order tags remain until last item leaves.
- Orders skip paths and empty batch recovery covered; other tags preserved.
- Authentication/current saved membership required; failed DB mutations never sync tags.
- External failure never rolls back successful removal or loses remaining drafts.

### Server
- [x] Write failing service/helper/route tests for retained sibling items, final removal, partial failures, ownership and empty recovery.
- [x] Extend existing auto-sync helper and service to support removals and valid empty snapshots, wire routes after successful changes.
- [x] Run tagging, Orders route and production route regressions.

### UI
- [x] Write failing mocked browser tests for trash and selected removal success/warning, Orders skip and empty recovery.
- [x] Reuse shared feedback with removal-specific wording, add progress to trash, enable authenticated empty-batch retry.
- [x] Verify membership/draft retention, duplicate prevention and focus handling.

### Verification
- [x] Review final diff, update requirements/continuity, run relevant unit and browser suites, build and whitespace checks.

## Verification

- Red/green service tests cover retained sibling-order tags, final/empty removal, partial empty cleanup counts, saved workspace loading, and warning responses after provider failures.
- Root verification: 229 tests passed across eight relevant service/client/store/route unit suites.
- Combined Orders + production batch + existing preview trash regression: 109 browser checks passed.
- Additional final focused checks passed for Orders item/whole/bulk skip warnings and empty recovery after-close text (four cases); root independently reran the three Orders skip/reopen cases successfully after the last fix.
- Fixed a pre-existing const reassignment in bulk-skip status delta exposed by the new active-batch warning scenario; changed to in-place splice preserving shared array identity.
- Empty manual results no longer tell operators to print packing slips. Existing completion cleanup unchanged.
- Build and whitespace checks passed. Independent review completed; empty partial counts and empty success alert review findings were corrected.
- No migrations, live ShipStation writes, commit, or deployment. Changes remain local on feat/sync-tags-on-batch-removal.

## Finish verification — November 16, 2026

- Latest origin/main already included; no merge changes required.
- Full unit suite: 110 files / 1,122 tests passed with two workers and a 15-second per-test timeout for slow Windows/Python export startup. Assertions and checked-in test timeouts unchanged.
- All 109 affected Orders/production-batch/trash browser checks passed; build and whitespace checks passed.
- All 52 local migration versions exactly match production oezjskcygvfyezvoulzw; no migrations required or applied.
- No live ShipStation tag mutations performed during verification.
