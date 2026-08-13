# Preset Fixed Design State Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure applying a preset with reusable fixed SVG items immediately persists those items into the active order and renders them, including when the order has no text.

**Architecture:** Preserve the existing preset builder and rendering pipeline. Correct the handoff between `buildReloadedPresetSettings`, the editor controls, and the active-order model so `render()` and later reads observe the newly selected preset settings rather than stale order settings.

**Tech Stack:** Vanilla JavaScript, Vitest, Playwright.

## Global Constraints

- Keep the fix scoped to preset application state flow; avoid unrelated refactors.
- Use a failing browser-level regression test before changing production code.
- The regression must apply a preset containing `fixedItems` to a blank manual design and assert that the fixed SVG appears in the preview.
- Preserve existing behavior for presets applied to designs containing text.
- Do not change database schema or add dependencies.

---

### Task 1: Persist and Render Preset Fixed Items

**Files:**
- Modify: `src/app.js:8948-8972`
- Test: `tests/e2e/fixed-design-insert.spec.js`

**Interfaces:**
- Consumes: `buildReloadedPresetSettings(...)` returns normalized settings with preset text lines and `fixedItems`.
- Produces: `applyPresetSelection(presetId)` leaves the active order, editor controls, and preview synchronized to those returned settings.

- [x] **Step 1: Write the failing regression test**

Add a Playwright test that installs the existing fixed-design and preset route fixtures, opens a blank manual design, selects a preset whose `fixedItems` contains one `fixedSvg`, and asserts both the fixed-design control and `#preview [data-fixed-svg-id="<id>"]` are visible with the expected asset URL.

- [x] **Step 2: Run the focused test and verify RED**

Run the test through the worktree-safe runner with the resolved test URL:

```powershell
npm run test:e2e -- tests/e2e/fixed-design-insert.spec.js
```

Expected: FAIL because the control card appears but the preview contains no matching `data-fixed-svg-id` element.

- [x] **Step 3: Implement the minimal state-flow correction**

Update `applyPresetSelection(presetId)` so the active order receives the freshly built `nextSettings` before any call to `render()` or any settings reconstruction that uses `activeOrder.settings`. Keep fixed-design record enrichment behavior intact.

- [x] **Step 4: Run focused verification and verify GREEN**

```powershell
npm run test:e2e -- tests/e2e/fixed-design-insert.spec.js
npm run test:unit
```

Expected: focused regression passes, all fixed-design E2E tests in the file pass, and all unit tests pass.

- [x] **Step 5: Self-review and commit**

Confirm the diff contains only the regression test and minimal production correction, then commit:

```powershell
git add src/app.js tests/e2e/fixed-design-insert.spec.js docs/superpowers/plans/2026-08-12-fix-preset-fixed-design-state.md
git commit -m "fix: apply preset fixed designs to active order"
```
