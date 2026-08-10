# Amazon Fonts in Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include parsed Amazon per-line font selections in ShipStation Notes to Buyer.

**Architecture:** Keep parsing and design enrichment unchanged. At the Amazon import service's note-building boundary, combine `personalizationResponses` with font fields derived by pairing normalized text responses and `customerFontSelections` by line index.

**Tech Stack:** Node.js ES modules, Vitest, ShipStation API v2.

## Global Constraints

- Preserve the existing Amazon shipment `items` array unchanged in ShipStation updates.
- Emit `<text label> Font: <font name>` only when both values exist.
- Do not add dependencies, database changes, or unrelated refactors.

---

### Task 1: Add Amazon font selections to Notes to Buyer

**Files:**
- Modify: `api/_lib/amazon-import-service.js`
- Modify: `tests/unit/amazon-import-service.test.js`
- Modify: `docs/requirements.md`

**Interfaces:**
- Consumes: `normalized.source.personalizationResponses` and `normalized.source.customerFontSelections`.
- Produces: the `fields` array passed to `buildAmazonNoteBlock`, including synthesized font fields.

- [ ] **Step 1: Write the failing regression test**

Add a service test with two normalized text responses (`Name`, `Title`) and font selections (`Skywalk`, `Somekind`). Assert the Notes to Buyer update includes `Name Font: Skywalk` and `Title Font: Somekind`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/amazon-import-service.test.js`

Expected: the new assertions fail because the note contains no font lines.

- [ ] **Step 3: Implement the minimal boundary mapping**

Before `buildAmazonNoteBlock`, derive font fields by pairing non-font personalization responses with `customerFontSelections` by `lineIndex`, naming each field `${response.name} Font`. Pass the original personalization responses followed by the derived font fields.

- [ ] **Step 4: Update the requirement**

Add one sentence to `docs/requirements.md` requiring ShipStation Notes to Buyer to include each parsed Amazon per-line font selection using its text label.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```text
npx vitest run tests/unit/amazon-import-service.test.js tests/unit/amazon-customization-normalizer.test.js
npm run test:unit
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 6: Run the live simplified check**

Retrieve the single pending Amazon shipment using the local ShipStation credentials, fetch its customization, generate the note with production code, update the shipment with its existing items/packages/shipping fields, re-fetch it, and assert the persisted note contains `Name Font: Skywalk` and `Title Font: Somekind` without printing customer-entered note content.

- [ ] **Step 7: Commit**

```text
git add api/_lib/amazon-import-service.js tests/unit/amazon-import-service.test.js docs/requirements.md docs/superpowers/specs/2026-08-04-amazon-fonts-in-notes-design.md docs/superpowers/plans/2026-08-04-amazon-fonts-in-notes.md
git commit -m "fix: include Amazon fonts in buyer notes"
```

