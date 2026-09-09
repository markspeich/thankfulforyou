# Task 2 Report: Canonical badge-reel type normalization

## Files changed

- `api/_lib/amazon-customization-normalizer.js`
- `api/_lib/etsy-import-normalizer.js`
- `tests/unit/amazon-customization-normalizer.test.js`
- `tests/unit/etsy-import-normalizer.test.js`

## Red/green evidence

- Red: `npx vitest run tests/unit/amazon-customization-normalizer.test.js tests/unit/etsy-import-normalizer.test.js` failed only because the expected `source.badgeReelTypeId` was absent for the Amazon `Swivel Alligator Clip` and Etsy fixture `Swivel Alligator` selections (2 failures, 33 passes).
- Green: the same focused command passed after the minimal catalog lookups (2 files passed, 35 tests passed).

## Implementation

- Each normalizer asks the shared `findBadgeReelTypeCandidate` catalog helper for the first marketplace badge-reel field.
- A canonical `source.badgeReelTypeId` is emitted only when that candidate resolves to an ID.
- Existing raw Amazon `personalizationResponses` and Etsy `variations` are retained unchanged.

## Assumptions

- Amazon candidate fields are the existing accepted configuration fields, as required. Blank or malformed entries that the existing parser excludes remain non-fatal and do not produce a canonical ID.

## Self-review

- Checked the first-match behavior with an unknown first selection followed by a recognized selection.
- Checked recognized, unknown, blank, malformed, and absent values, plus raw source preservation.
- Scope is limited to the two normalizers and their focused unit coverage; no persistence, UI, or database code changed.

## Commit

- Created with message: `Add canonical badge reel type normalization`.

## Blockers

- None.
