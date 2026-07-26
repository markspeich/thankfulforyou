# Vercel Function Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Vercel deployment to 12 functions by excluding the local-only preset persistence route.

**Architecture:** Keep `api/presets.js` available to the local development server and exclude only its Vercel upload. A routing regression test protects both sides of that boundary.

**Tech Stack:** Vercel configuration, Node.js, Vitest

## Global Constraints

- Do not change production API URLs or runtime behavior.
- Keep `/api/presets` available through `tools/dev_server.mjs`.
- Do not add dependencies.

---

### Task 1: Exclude the local-only route from Vercel

**Files:**
- Modify: `.vercelignore`
- Modify: `tests/unit/vercel-routing.test.js`

**Interfaces:**
- Consumes: Vercel's `.vercelignore` file matching and the existing local `/api/presets` mapping.
- Produces: A deployment input with 12 function source files and unchanged local preset persistence.

- [ ] **Step 1: Write the failing test**

Add an assertion that `.vercelignore` contains an exact `api/presets.js` entry and retain the assertion that the development server maps `/api/presets`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/unit/vercel-routing.test.js`

Expected: FAIL because `.vercelignore` does not yet exclude `api/presets.js`.

- [ ] **Step 3: Write the minimal implementation**

Add this line to `.vercelignore`:

```text
api/presets.js
```

- [ ] **Step 4: Run verification**

Run:

```text
npx vitest run tests/unit/vercel-routing.test.js
npm run build
npm run test:unit
```

Expected: all commands exit successfully.

- [ ] **Step 5: Review and commit**

Review `git diff --check`, confirm only the intended files changed, and commit the implementation.
