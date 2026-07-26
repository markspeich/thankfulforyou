# Marketplace Order Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render compact Etsy and Amazon icons with consistent imported order-number titles in the selected-order header.

**Architecture:** Add presentation-only marketplace/order-number resolution beside the existing selected-order title logic in `src/app.js`. Render an accessible inline marketplace icon only in the selected-order heading, style it in `src/styles.css`, and protect the behavior with Playwright coverage using realistic grouped-order payloads.

**Tech Stack:** Vanilla JavaScript DOM rendering, CSS, inline SVG, Playwright.

## Global Constraints

- Genuine manual orders keep `Manual Order: <design text>` and have no marketplace icon.
- Amazon detection uses item `source.marketplace`; imported numbered records without an explicit marker remain Etsy-compatible.
- Order numbers fall back from the group to item fields and then item source metadata.
- No database, import persistence, or order-list-row behavior changes.

---

### Task 1: Selected-order marketplace header

**Files:**
- Modify: `tests/e2e/orders-workspace.spec.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: grouped order objects with `orderNumber` and `items[].source`.
- Produces: a selected-order `<h2>` containing optional `.database-order-marketplace-icon` and title text.

- [ ] **Step 1: Write the failing browser test**

Add assertions that an existing numbered Etsy fixture exposes an Etsy marketplace image in its selected heading. Add an Amazon fixture with `source.marketplace: "amazon"` and `source.orderNumber: "114-1234567-1234567"` but no group-level order number, select it, and assert that the heading is `Order 114-1234567-1234567`, its marketplace image is named `Amazon`, and `Manual Order:` is absent.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm run test:e2e -- tests/e2e/orders-workspace.spec.js
```

Expected: FAIL because no marketplace icon is rendered and the Amazon fixture uses the manual title fallback.

- [ ] **Step 3: Implement minimal selected-header rendering**

Add helpers in `src/app.js` that resolve the imported order number and marketplace, then replace the selected heading children with an accessible marketplace SVG plus the consistent `Order <number>` text. Preserve the existing manual title fallback and leave grouped list titles unchanged.

- [ ] **Step 4: Add compact icon styling**

Style the selected heading as an inline flex row and size the SVG icon to fit the existing heading line without increasing header height unnecessarily.

- [ ] **Step 5: Record the requirement**

Add the approved marketplace-header behavior to the Orders workspace requirements in `docs/requirements.md`.

- [ ] **Step 6: Run focused and broader verification**

Run:

```powershell
npm run test:e2e -- tests/e2e/orders-workspace.spec.js
npm run test:unit
```

Expected: PASS.

- [ ] **Step 7: Commit**

Stage only the marketplace-header implementation, tests, and documentation, then commit with:

```powershell
git commit -m "Add marketplace icons to order headers"
```
