# Task 1 report: Preserve numbered Etsy selections

## Changed files

- `api/_lib/etsy-import-normalizer.js`
- `tests/unit/etsy-import-normalizer.test.js`
- `.superpowers/sdd/2026-08-13-preserve-etsy-font-overrides/task-1-report.md`

## Red evidence

Added a production-shaped regression with personalization `Kiara  MA`, Line 1 `Quincy`, and Line 2 `Super Boy`. Before the implementation, `npx vitest run tests/unit/etsy-import-normalizer.test.js` failed because `customerFontSelections` contained only the Line 1 selection; Line 2 was discarded when no matching design line existed.

## Green evidence

After the minimal normalization change, `npx vitest run tests/unit/etsy-import-normalizer.test.js` passed: 1 test file, 9 tests.

## Implementation

Positive explicit `Line N` labels now retain their zero-based mapped index even when that design line is absent. These selections are diagnosed as `stored_without_design_line` and are retained in `source.customerFontSelections`. Unlabeled selections continue to use ordinal fallback and are omitted when no design line is available.

## Self-review

- Confirmed no blank design lines are synthesized.
- Confirmed the regression preserves the two spaces in `Kiara  MA`.
- Confirmed all explicit numbered selections with non-null indexes flow into `customerFontSelections`.
- Confirmed ordinal fallback behavior remains unchanged.
- Confirmed no alias resolution or Fonts UI changes were included.
- Ran `git diff --check`; no whitespace errors were reported.

## Commit

`fix: preserve future Etsy font selections`

## Concerns

None. Alias resolution remains intentionally out of scope for this task.
