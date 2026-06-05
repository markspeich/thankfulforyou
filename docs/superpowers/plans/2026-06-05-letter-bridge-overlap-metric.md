# Letter Bridge Overlap Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Letter Bridge` minimize visual letter overlap while preserving a manufacturable connected tab between adjacent glyphs.

**Architecture:** Extract pair-overlap measurement into a small tested module, then have the existing layout pipeline call that module when positioning neighboring glyph masks. Keep the UI and persisted setting name unchanged; only the geometry meaning of `bridgeMm` changes.

**Tech Stack:** JavaScript ES modules, browser canvas glyph masks, Vitest unit tests.

---

### Task 1: Add A Testable Bridge Geometry Helper

**Files:**
- Create: `src/bridge-geometry.js`
- Create: `tests/unit/bridge-geometry.test.js`

- [x] **Step 1: Write failing tests for vertical overlap tabs**

Create a mask fixture where two glyph masks overlap in a tall, narrow vertical tab. Assert that `getOverlapBridgeLengthPx(leftMask, rightMask, dxPx)` returns the tab height rather than the horizontal width.

- [x] **Step 2: Verify red**

Run:

```powershell
npx vitest run tests/unit/bridge-geometry.test.js
```

Expected: FAIL because the old horizontal-span metric reports `1` instead of `5`.

- [x] **Step 3: Implement connected overlap measurement**

Update the helper to collect overlapping pixels, group them into connected components, and return the largest component span as `max(width, height)`.

- [x] **Step 4: Verify green**

Run:

```powershell
npx vitest run tests/unit/bridge-geometry.test.js
```

Expected: PASS.

### Task 2: Wire The App Layout To The New Metric

**Files:**
- Modify: `src/app.js`

- [x] **Step 1: Replace horizontal overlap placement**

Import `findPairOffsetPx` from `src/bridge-geometry.js` and use it inside `findPairOffsetMm`.

- [x] **Step 2: Preserve fallback behavior**

If no offset produces a connected tab at the target length, keep the existing fallback:

```javascript
return (leftMask.rightMm + rightMask.leftMm) - bridgeMm;
```

### Task 3: Document The Manufacturing Semantics

**Files:**
- Modify: `docs/requirements.md`

- [x] **Step 1: Update bridge requirement**

Document that `Letter Bridge` is a minimum connected overlap-tab length, measured along the overlap component's longest horizontal or vertical span, not a horizontal overlap width.

### Task 4: Verify

**Files:**
- Test: `tests/unit/bridge-geometry.test.js`
- Test: `tests/unit/**/*.test.js`

- [x] **Step 1: Run focused geometry tests**

```powershell
npx vitest run tests/unit/bridge-geometry.test.js
```

- [x] **Step 2: Run full unit tests**

```powershell
npm run test:unit
```
