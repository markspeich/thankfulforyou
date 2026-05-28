# Bounding Border Size Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-backed bounding-border size selection so operators can fit designs against named max rectangles while previewing matching min rectangles.

**Architecture:** Add a small size-preset registry module, persist `boundingSizePresetId` as a global layout setting, then thread resolved guide dimensions through layout math, preview rendering, preset authoring, and layout-copy flows. Keep the current 2.2 inch by 1.5 inch behavior as the default fallback so old orders and preset files continue to work.

**Tech Stack:** Vanilla ES modules, Vitest, Playwright, JSON schema, existing preset snapshot/local-storage/shared-queue persistence

---

## File Structure

- Create: `src/bounding-size-presets.js`
- Create: `tests/unit/bounding-size-presets.test.js`
- Modify: `docs/schemas/preset.schema.json`
- Modify: `public/presets/*.json`
- Modify: `src/app.js`
- Modify: `src/layout-math.js`
- Modify: `src/layout-controls-clipboard.js`
- Modify: `src/order-signatures.js`
- Modify: `src/preset-authoring.js`
- Modify: `src/preset-selection.js`
- Modify: `src/presets.js`
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `tests/unit/layout-math.test.js`
- Modify: `tests/unit/layout-controls-clipboard.test.js`
- Modify: `tests/unit/order-signatures.test.js`
- Modify: `tests/unit/preset-authoring.test.js`
- Modify: `tests/unit/preset-selection.test.js`
- Modify: `tests/unit/presets.test.js`
- Modify: `tests/e2e/preview-layout.spec.js`
- Modify: `tests/e2e/preset-editor.spec.js`

## Responsibility Map

- `src/bounding-size-presets.js`
  Owns bundled size definitions, default fallback, id validation, option lists, and inch-to-millimeter resolution.
- `src/layout-math.js`
  Accepts resolved guide dimensions for fitting, overflow, and preview-frame centering.
- `src/app.js`
  Normalizes `boundingSizePresetId`, renders the global setting, resolves guide data for layout building, renders dynamic preview guides, and exposes the size-preset section in the Presets workspace.
- Preset modules and schema
  Allow `globalDefaults.boundingSizePresetId` to round-trip through bundled presets, local edits, remote snapshots, and preset inference.
- Signature/copy modules
  Treat the size id like other global layout controls.

### Task 1: Add Bounding Size Preset Registry

**Files:**
- Create: `src/bounding-size-presets.js`
- Create: `tests/unit/bounding-size-presets.test.js`

- [ ] **Step 1: Write failing tests for registry defaults and fallback**

```javascript
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  getBoundingSizePresetOptions,
  isValidBoundingSizePresetId,
  resolveBoundingSizePreset,
} from "../../src/bounding-size-presets.js";

describe("bounding size presets", () => {
  it("resolves the default 2.2 by 1.5 inch guide in millimeters", () => {
    const preset = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID);

    expect(preset.id).toBe("size-2-2x1-5");
    expect(preset.maxWidthMm).toBeCloseTo(55.88, 6);
    expect(preset.maxHeightMm).toBeCloseTo(38.1, 6);
    expect(preset.minWidthMm).toBeCloseTo(40.64, 6);
    expect(preset.minHeightMm).toBeCloseTo(27.94, 6);
  });

  it("falls back to the default when an unknown id is provided", () => {
    expect(resolveBoundingSizePreset("missing").id).toBe(DEFAULT_BOUNDING_SIZE_PRESET_ID);
    expect(isValidBoundingSizePresetId("missing")).toBe(false);
  });

  it("exposes operator-facing options", () => {
    expect(getBoundingSizePresetOptions()).toEqual([
      {
        id: "size-2-2x1-5",
        label: "2.2 x 1.5 in",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/unit/bounding-size-presets.test.js`

Expected: `FAIL` because `src/bounding-size-presets.js` does not exist.

- [ ] **Step 3: Implement the bundled registry**

```javascript
const MM_PER_INCH = 25.4;

export const DEFAULT_BOUNDING_SIZE_PRESET_ID = "size-2-2x1-5";

const BOUNDING_SIZE_PRESETS = Object.freeze([
  {
    id: DEFAULT_BOUNDING_SIZE_PRESET_ID,
    label: "2.2 x 1.5 in",
    max: { widthIn: 2.2, heightIn: 1.5 },
    min: { widthIn: 1.6, heightIn: 1.1 },
  },
]);

function toMm(inches) {
  return Number(inches) * MM_PER_INCH;
}

function resolveDefinition(definition) {
  return {
    id: definition.id,
    label: definition.label,
    maxWidthMm: toMm(definition.max.widthIn),
    maxHeightMm: toMm(definition.max.heightIn),
    minWidthMm: toMm(definition.min.widthIn),
    minHeightMm: toMm(definition.min.heightIn),
    maxWidthIn: definition.max.widthIn,
    maxHeightIn: definition.max.heightIn,
    minWidthIn: definition.min.widthIn,
    minHeightIn: definition.min.heightIn,
  };
}

export function getBoundingSizePresetOptions() {
  return BOUNDING_SIZE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
}

export function isValidBoundingSizePresetId(presetId) {
  return BOUNDING_SIZE_PRESETS.some((preset) => preset.id === presetId);
}

export function resolveBoundingSizePreset(presetId) {
  const definition = BOUNDING_SIZE_PRESETS.find((preset) => preset.id === presetId)
    || BOUNDING_SIZE_PRESETS.find((preset) => preset.id === DEFAULT_BOUNDING_SIZE_PRESET_ID);

  return resolveDefinition(definition);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run tests/unit/bounding-size-presets.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/bounding-size-presets.js tests/unit/bounding-size-presets.test.js
git commit -m "feat: add bounding size preset registry"
```

### Task 2: Persist Bounding Size In Presets And Order Globals

**Files:**
- Modify: `docs/schemas/preset.schema.json`
- Modify: `public/presets/preset-a1f4c8e2b601.json`
- Modify: `public/presets/preset-b7d2e9f4c318.json`
- Modify: `public/presets/preset-c3e8a1d7f520.json`
- Modify: `public/presets/preset-d9b4f2a6c731.json`
- Modify: `src/presets.js`
- Modify: `src/preset-authoring.js`
- Modify: `src/preset-selection.js`
- Modify: `src/app.js`
- Modify: `tests/unit/presets.test.js`
- Modify: `tests/unit/preset-authoring.test.js`
- Modify: `tests/unit/preset-selection.test.js`

- [ ] **Step 1: Write failing tests for preset global defaults**

Add to `tests/unit/presets.test.js`:

```javascript
it("returns preset-level bounding size defaults", () => {
  expect(getPresetGlobalDefaults("preset-a1f4c8e2b601")).toEqual({
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
  });
});
```

Add to `tests/unit/preset-authoring.test.js`:

```javascript
it("infers bounding size as a reusable global default", () => {
  const preset = inferPresetDefinitionFromSettings({
    name: "Default Size",
    settings: {
      text: "Mark",
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [createDefaultLineSettings()],
    },
  });

  expect(preset.globalDefaults).toMatchObject({
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
  });
});
```

Add to `tests/unit/preset-selection.test.js`:

```javascript
it("rebuilds bounding size from the selected preset", () => {
  const settings = applyPresetSelection({
    currentSettings: {
      text: "Mark",
      boundingSizePresetId: "size-small",
      backingMm: 8.8,
      weldExportedDesign: false,
      lines: [],
    },
    presetId: "preset-new",
    getPresetBaseSettings: () => ({
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
    }),
    buildPresetLines: () => [],
    createDefaultLineSettings: () => ({}),
  });

  expect(settings.boundingSizePresetId).toBe("size-2-2x1-5");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npx vitest run tests/unit/presets.test.js tests/unit/preset-authoring.test.js tests/unit/preset-selection.test.js`

Expected: `FAIL` because `boundingSizePresetId` is not included in schema/default normalization/inference.

- [ ] **Step 3: Update schema and preset JSON files**

Add to `docs/schemas/preset.schema.json` under `$defs.globalDefaults.properties`:

```json
"boundingSizePresetId": {
  "type": "string",
  "pattern": "^size-[a-z0-9]+(?:-[a-z0-9]+)*$"
}
```

Add to every bundled preset's `globalDefaults`:

```json
"boundingSizePresetId": "size-2-2x1-5"
```

- [ ] **Step 4: Normalize and infer the new global field**

In `src/presets.js`, include `boundingSizePresetId` when normalizing `globalDefaults`:

```javascript
...(Object.hasOwn(definition.globalDefaults, "boundingSizePresetId")
  ? { boundingSizePresetId: definition.globalDefaults.boundingSizePresetId }
  : {}),
```

In `src/preset-authoring.js`, include it in inferred globals:

```javascript
globalDefaults: {
  boundingSizePresetId: settings?.boundingSizePresetId,
  backingMm: settings?.backingMm,
  weldExportedDesign: settings?.weldExportedDesign,
},
```

In `src/preset-selection.js`, copy it from `presetBaseSettings`:

```javascript
boundingSizePresetId: presetBaseSettings.boundingSizePresetId,
```

In `src/app.js`, import the default and validator:

```javascript
import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  isValidBoundingSizePresetId,
} from "./bounding-size-presets.js";
```

Extend `getPresetBaseSettings`:

```javascript
boundingSizePresetId: isValidBoundingSizePresetId(globalDefaults.boundingSizePresetId)
  ? globalDefaults.boundingSizePresetId
  : DEFAULT_BOUNDING_SIZE_PRESET_ID,
```

Extend `normalizeSettings`:

```javascript
boundingSizePresetId: isValidBoundingSizePresetId(settings.boundingSizePresetId)
  ? settings.boundingSizePresetId
  : presetBaseSettings.boundingSizePresetId,
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npx vitest run tests/unit/presets.test.js tests/unit/preset-authoring.test.js tests/unit/preset-selection.test.js`

Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add docs/schemas/preset.schema.json public/presets src/presets.js src/preset-authoring.js src/preset-selection.js src/app.js tests/unit/presets.test.js tests/unit/preset-authoring.test.js tests/unit/preset-selection.test.js
git commit -m "feat: persist bounding size preset defaults"
```

### Task 3: Include Size In Signatures And Layout Copy

**Files:**
- Modify: `src/order-signatures.js`
- Modify: `src/layout-controls-clipboard.js`
- Modify: `tests/unit/order-signatures.test.js`
- Modify: `tests/unit/layout-controls-clipboard.test.js`

- [ ] **Step 1: Write failing tests for global layout persistence utilities**

Add to `tests/unit/order-signatures.test.js`:

```javascript
it("changes the current settings signature when bounding size changes", () => {
  const baseSettings = {
    text: "Mark",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
    lines: [],
  };

  expect(buildSettingsSignature({
    ...baseSettings,
    boundingSizePresetId: "size-other",
  })).not.toBe(buildSettingsSignature(baseSettings));
});
```

Add to `tests/unit/layout-controls-clipboard.test.js`:

```javascript
it("copies and pastes the bounding size preset id as a global layout setting", () => {
  const snapshot = buildLayoutControlsSnapshot({
    id: "order-1",
    label: "Design 1",
    settings: {
      text: "Mark",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [],
    },
  });

  const result = applyLayoutControlsSnapshot(
    {
      text: "Avery",
      presetId: "preset-c3e8a1d7f520",
      boundingSizePresetId: "size-old",
      backingMm: 4,
      weldExportedDesign: false,
      lines: [],
    },
    snapshot,
  );

  expect(result.settings.boundingSizePresetId).toBe("size-2-2x1-5");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npx vitest run tests/unit/order-signatures.test.js tests/unit/layout-controls-clipboard.test.js`

Expected: `FAIL` because `boundingSizePresetId` is not part of those payloads.

- [ ] **Step 3: Add the field to both global payload builders**

In `src/order-signatures.js`, add:

```javascript
boundingSizePresetId: typeof settings.boundingSizePresetId === "string" ? settings.boundingSizePresetId : "",
```

In `src/layout-controls-clipboard.js`, add to `GLOBAL_SETTING_KEYS`:

```javascript
"boundingSizePresetId",
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npx vitest run tests/unit/order-signatures.test.js tests/unit/layout-controls-clipboard.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/order-signatures.js src/layout-controls-clipboard.js tests/unit/order-signatures.test.js tests/unit/layout-controls-clipboard.test.js
git commit -m "feat: track bounding size in layout signatures"
```

### Task 4: Make Layout Math Guide-Aware

**Files:**
- Modify: `src/layout-math.js`
- Modify: `tests/unit/layout-math.test.js`

- [ ] **Step 1: Write failing guide-aware layout math tests**

Add to `tests/unit/layout-math.test.js`:

```javascript
const SMALL_GUIDE = Object.freeze({
  maxWidthMm: 25,
  maxHeightMm: 20,
  minWidthMm: 15,
  minHeightMm: 10,
});

it("scales text against a provided custom max guide", () => {
  const scale = computeTextFitScale(50, 10, SMALL_GUIDE);

  expect(50 * scale).toBeLessThanOrEqual(SMALL_GUIDE.maxWidthMm - TEXT_FIT_SAFETY_MARGIN_MM);
  expect(scale).toBeLessThan(1);
});

it("reports mixed-scale overflow against a provided guide", () => {
  const bounds = computeMixedScaleBounds(
    [
      {
        y: 0,
        offsetXMm: 0,
        settings: { fontSizeMm: 30, lockTextHeight: true },
        mask: { widthMm: 30, topMm: 0, bottomMm: 10 },
      },
    ],
    [1],
    SMALL_GUIDE,
  );

  expect(bounds.overflowsGuide).toBe(true);
});

it("centers preview text inside a provided guide width and height", () => {
  const textBoundsMm = buildScaledTextBounds(12, 10, 3.1, 1);
  const frame = computePreviewFrame(
    {
      widthMm: 20,
      heightMm: 18,
      textBoundsMm,
    },
    textBoundsMm,
    SMALL_GUIDE,
  );

  const textCenterX = frame.designX + textBoundsMm.left + textBoundsMm.width / 2;
  const textCenterY = frame.designY + textBoundsMm.top + textBoundsMm.height / 2;

  expect(textCenterX).toBeCloseTo(frame.previewBoxX + SMALL_GUIDE.maxWidthMm / 2, 6);
  expect(textCenterY).toBeCloseTo(frame.previewBoxY + SMALL_GUIDE.maxHeightMm / 2, 6);
});
```

- [ ] **Step 2: Run layout math tests and verify they fail**

Run: `npx vitest run tests/unit/layout-math.test.js`

Expected: `FAIL` because layout math ignores custom guide arguments.

- [ ] **Step 3: Derive default constants from the registry and add guide helpers**

In `src/layout-math.js`, import the default resolver:

```javascript
import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  resolveBoundingSizePreset,
} from "./bounding-size-presets.js";
```

Replace fixed max/preview constants with derived values:

```javascript
export const DEFAULT_PREVIEW_GUIDE = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID);
export const MAX_RENDER_WIDTH_MM = DEFAULT_PREVIEW_GUIDE.maxWidthMm;
export const MAX_RENDER_HEIGHT_MM = DEFAULT_PREVIEW_GUIDE.maxHeightMm;
export const PREVIEW_BOX_WIDTH_MM = DEFAULT_PREVIEW_GUIDE.maxWidthMm;
export const PREVIEW_BOX_HEIGHT_MM = DEFAULT_PREVIEW_GUIDE.maxHeightMm;
```

Add helpers:

```javascript
function resolveGuide(guide = DEFAULT_PREVIEW_GUIDE) {
  return guide && Number.isFinite(Number(guide.maxWidthMm)) && Number.isFinite(Number(guide.maxHeightMm))
    ? guide
    : DEFAULT_PREVIEW_GUIDE;
}

function getMaxFitWidthMm(guide) {
  return Math.max(1, resolveGuide(guide).maxWidthMm - TEXT_FIT_SAFETY_MARGIN_MM);
}

function getMaxFitHeightMm(guide) {
  return Math.max(1, resolveGuide(guide).maxHeightMm - TEXT_FIT_SAFETY_MARGIN_MM);
}
```

- [ ] **Step 4: Thread the guide through fit, overflow, mixed scale, and preview frame**

Change function signatures and internal calls:

```javascript
export function computeTextFitScale(textWidthMm, textHeightMm, guide = DEFAULT_PREVIEW_GUIDE) {
  return Math.min(
    getMaxFitWidthMm(guide) / Math.max(1, textWidthMm),
    getMaxFitHeightMm(guide) / Math.max(1, textHeightMm),
  );
}

export function computeMixedFitScale(lines, guide = DEFAULT_PREVIEW_GUIDE) {
  const resolvedGuide = resolveGuide(guide);
  // existing body, passing resolvedGuide to computeTextFitScale and computeMixedScaleBounds
}

export function computeMixedScaleBounds(lines, lineScaleFactors, guide = DEFAULT_PREVIEW_GUIDE) {
  const resolvedGuide = resolveGuide(guide);
  // existing body
  return {
    // existing fields
    overflowsGuide: textWidthMm > getMaxFitWidthMm(resolvedGuide) || textHeightMm > getMaxFitHeightMm(resolvedGuide),
  };
}

export function computeGuideOverflow(lines, textWidthMm, textHeightMm, guide = DEFAULT_PREVIEW_GUIDE) {
  // existing locked-line guard
  return computeTextFitScale(textWidthMm, textHeightMm, guide) < 1 - 1e-6;
}

export function computePreviewFrame(layout, textBoundsMm = layout.textBoundsMm, guide = layout.guide || DEFAULT_PREVIEW_GUIDE) {
  const resolvedGuide = resolveGuide(guide);
  const previewWidthMm = Math.max(layout.widthMm, resolvedGuide.maxWidthMm) + PREVIEW_MARGIN_MM * 2;
  const previewHeightMm = Math.max(layout.heightMm, resolvedGuide.maxHeightMm) + PREVIEW_MARGIN_MM * 2;
  const previewBoxX = (previewWidthMm - PREVIEW_LABEL_RIGHT_MM - resolvedGuide.maxWidthMm) / 2;
  const previewBoxY = (previewHeightMm - resolvedGuide.maxHeightMm) / 2;
  const designX = previewBoxX + (resolvedGuide.maxWidthMm - textBoundsMm.width) / 2 - textBoundsMm.left;
  const designY = previewBoxY + (resolvedGuide.maxHeightMm - textBoundsMm.height) / 2 - textBoundsMm.top;

  return { previewWidthMm, previewHeightMm, previewBoxX, previewBoxY, designX, designY };
}
```

- [ ] **Step 5: Run layout math tests and verify they pass**

Run: `npx vitest run tests/unit/bounding-size-presets.test.js tests/unit/layout-math.test.js`

Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add src/layout-math.js tests/unit/layout-math.test.js
git commit -m "feat: make layout math size aware"
```

### Task 5: Use Selected Size In App Layout And Preview

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `tests/e2e/preview-layout.spec.js`

- [ ] **Step 1: Write failing Playwright coverage for the global size control and dynamic preview**

Add to `tests/e2e/preview-layout.spec.js`:

```javascript
test("shows a bounding size preset control in global settings", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#boundingSizePresetInput")).toBeVisible();
  await expect(page.locator("#boundingSizePresetInput")).toHaveValue("size-2-2x1-5");
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('2.2"');
  await expect(page.locator("#preview .preview-guide-min-box")).toHaveCount(1);
});
```

- [ ] **Step 2: Run the focused e2e test and verify it fails**

Run: `npx playwright test tests/e2e/preview-layout.spec.js -g "shows a bounding size preset control"`

Expected: `FAIL` because the control and min box do not exist.

- [ ] **Step 3: Add the global select markup**

In `index.html`, inside the `Global Settings` card before global stretch controls:

```html
<label class="field compact-field" for="boundingSizePresetInput">
  <span>Bounding Size</span>
  <select id="boundingSizePresetInput"></select>
</label>
```

In the preset editor global defaults area, add:

```html
<label class="field compact-field" for="presetBoundingSizePresetInput">
  <span>Bounding Size</span>
  <select id="presetBoundingSizePresetInput"></select>
</label>
```

- [ ] **Step 4: Populate, normalize, and read the control in `src/app.js`**

Import:

```javascript
import {
  DEFAULT_BOUNDING_SIZE_PRESET_ID,
  getBoundingSizePresetOptions,
  isValidBoundingSizePresetId,
  resolveBoundingSizePreset,
} from "./bounding-size-presets.js";
```

Add DOM references:

```javascript
const boundingSizePresetInput = document.querySelector("#boundingSizePresetInput");
const presetBoundingSizePresetInput = document.querySelector("#presetBoundingSizePresetInput");
```

Populate selects:

```javascript
function renderBoundingSizePresetOptions(selectElement) {
  selectElement.replaceChildren(...getBoundingSizePresetOptions().map((option) => {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    return element;
  }));
}
```

Read current settings:

```javascript
boundingSizePresetId: boundingSizePresetInput?.value || DEFAULT_BOUNDING_SIZE_PRESET_ID,
```

Sync controls:

```javascript
boundingSizePresetInput.value = normalized.boundingSizePresetId;
```

Wire change:

```javascript
boundingSizePresetInput.addEventListener("change", () => {
  updateActiveOrderFromControls();
  render();
});
```

- [ ] **Step 5: Build layouts with resolved guide data**

In `buildOrderLayout`:

```javascript
const guide = resolveBoundingSizePreset(normalized.boundingSizePresetId);
let fitScale = computeMixedFitScale(lines, guide);
// pass guide to computeTextFitScale, computeGuideOverflow, computePreviewFrame through layout
```

In `assembleOrderLayout`, return:

```javascript
guide,
boundingSizePresetId: normalized.boundingSizePresetId,
```

- [ ] **Step 6: Render max and min preview rectangles dynamically**

Change `appendPreviewGuide(previewBoxX, previewBoxY)` to accept `guide`:

```javascript
function appendPreviewGuide(previewBoxX, previewBoxY, guide = resolveBoundingSizePreset(DEFAULT_BOUNDING_SIZE_PRESET_ID)) {
  const guideCenterX = previewBoxX + guide.maxWidthMm / 2;
  const guideCenterY = previewBoxY + guide.maxHeightMm / 2;
  const minBoxX = guideCenterX - guide.minWidthMm / 2;
  const minBoxY = guideCenterY - guide.minHeightMm / 2;
  // labels from guide.maxWidthIn and guide.maxHeightIn
}
```

Append the min rectangle:

```javascript
makeSvgElement("rect", {
  class: "preview-guide-min-box",
  x: minBoxX,
  y: minBoxY,
  width: guide.minWidthMm,
  height: guide.minHeightMm,
  rx: 1.6,
})
```

In `src/styles.css`, share guide styling:

```css
.preview-guide-box,
.preview-guide-min-box,
.preview-guide-inner-line {
  fill: none;
  stroke: rgb(12, 150, 217);
  stroke-width: 0.05px;
}
```

- [ ] **Step 7: Run focused e2e and unit coverage**

Run: `npx vitest run tests/unit/bounding-size-presets.test.js tests/unit/layout-math.test.js`

Expected: `PASS`

Run: `npx playwright test tests/e2e/preview-layout.spec.js -g "shows a bounding size preset control"`

Expected: `PASS`

- [ ] **Step 8: Commit**

```bash
git add index.html src/app.js src/styles.css tests/e2e/preview-layout.spec.js
git commit -m "feat: add bounding size control and preview guide"
```

### Task 6: Add Preset Editor Size Defaults And Size Presets Section

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `tests/e2e/preset-editor.spec.js`

- [ ] **Step 1: Write failing e2e coverage for preset editor behavior**

Add to `tests/e2e/preset-editor.spec.js`:

```javascript
test("shows size presets in the Presets workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();

  await expect(page.getByRole("heading", { name: "Size Presets" })).toBeVisible();
  await expect(page.getByText("2.2 x 1.5 in")).toBeVisible();
  await expect(page.getByText("Max 2.2 x 1.5 in")).toBeVisible();
  await expect(page.getByText("Min 1.6 x 1.1 in")).toBeVisible();
});
```

Add:

```javascript
test("preserves bounding size when saving and reloading a layout preset", async ({ page }) => {
  await page.goto("/");

  await page.locator("#boundingSizePresetInput").selectOption("size-2-2x1-5");
  await page.getByRole("button", { name: "Save as New Preset" }).click();
  await page.locator("#presetDraftName").fill("Default Size Preset");
  await expect(page.locator("#presetBoundingSizePresetInput")).toHaveValue("size-2-2x1-5");
});
```

- [ ] **Step 2: Run focused e2e tests and verify they fail**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "size"`

Expected: `FAIL` because the size preset list and preset-editor field are not wired.

- [ ] **Step 3: Add the `Size Presets` section markup**

In `index.html`, inside the Presets workspace:

```html
<section class="preset-workspace-card size-presets-card" aria-labelledby="sizePresetsTitle">
  <div class="preset-assignment-header">
    <div>
      <p class="preset-assignment-eyebrow">Production Sizes</p>
      <h3 id="sizePresetsTitle">Size Presets</h3>
    </div>
  </div>
  <div id="sizePresetList" class="size-preset-list"></div>
</section>
```

- [ ] **Step 4: Render bundled size definitions in `src/app.js`**

```javascript
function renderSizePresetList() {
  sizePresetList.replaceChildren(...getBoundingSizePresetOptions().map((option) => {
    const preset = resolveBoundingSizePreset(option.id);
    const row = document.createElement("article");
    row.className = "size-preset-row";
    row.innerHTML = `
      <div>
        <p class="size-preset-name">${preset.label}</p>
        <p class="size-preset-meta">Max ${preset.maxWidthIn} x ${preset.maxHeightIn} in</p>
        <p class="size-preset-meta">Min ${preset.minWidthIn} x ${preset.minHeightIn} in</p>
      </div>
    `;
    return row;
  }));
}
```

Call `renderSizePresetList()` during app initialization and when opening the Presets workspace.

- [ ] **Step 5: Wire preset editor global defaults**

In preset editor normalization:

```javascript
boundingSizePresetId: isValidBoundingSizePresetId(globalDefaults.boundingSizePresetId)
  ? globalDefaults.boundingSizePresetId
  : DEFAULT_BOUNDING_SIZE_PRESET_ID,
```

When collecting preset editor draft globals:

```javascript
boundingSizePresetId: presetBoundingSizePresetInput?.value || DEFAULT_BOUNDING_SIZE_PRESET_ID,
```

When syncing preset editor form:

```javascript
presetBoundingSizePresetInput.value = globalDefaults.boundingSizePresetId;
```

- [ ] **Step 6: Add restrained card styling**

```css
.size-preset-list {
  display: grid;
  gap: 10px;
}

.size-preset-row {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.size-preset-name {
  margin: 0;
  font-weight: 700;
}

.size-preset-meta {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
}
```

- [ ] **Step 7: Run focused e2e tests and verify they pass**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "size"`

Expected: `PASS`

- [ ] **Step 8: Commit**

```bash
git add index.html src/app.js src/styles.css tests/e2e/preset-editor.spec.js
git commit -m "feat: show bounding size presets in preset editor"
```

### Task 7: Full Verification

**Files:**
- No planned source edits unless verification reveals a bug

- [ ] **Step 1: Run the focused unit suite**

Run: `npx vitest run tests/unit/bounding-size-presets.test.js tests/unit/layout-math.test.js tests/unit/presets.test.js tests/unit/preset-authoring.test.js tests/unit/preset-selection.test.js tests/unit/order-signatures.test.js tests/unit/layout-controls-clipboard.test.js`

Expected: `PASS`

- [ ] **Step 2: Run the affected Playwright specs**

Run: `npx playwright test tests/e2e/preview-layout.spec.js tests/e2e/preset-editor.spec.js`

Expected: `PASS`

- [ ] **Step 3: Run broader verification**

Run: `npm test`

Expected: `PASS`

- [ ] **Step 4: Commit verification fixes when there are source changes**

If verification required fixes, inspect the exact changed files:

```bash
git status --short
```

Then stage only the files changed by the verification fix and commit them:

```bash
git add src/bounding-size-presets.js src/layout-math.js src/app.js src/styles.css index.html tests/unit/bounding-size-presets.test.js tests/unit/layout-math.test.js tests/e2e/preview-layout.spec.js tests/e2e/preset-editor.spec.js
git commit -m "fix: stabilize bounding size preset behavior"
```

If no fixes were required, do not create an empty commit.

## Self-Review

### Spec Coverage

- Multiple size presets: Task 1 establishes the registry and default list.
- Max and min rectangles: Tasks 1, 4, 5, and 6 cover model, math, preview, and UI.
- Global Settings card selection: Task 5 adds the order-editor control.
- Preset-backed setting: Tasks 2 and 6 add preset global defaults and preset editor sync.
- Backwards compatibility: Tasks 1 and 2 define default fallback behavior.
- Copy/paste and signatures: Task 3 covers both.
- Dedicated Presets workspace area: Task 6 adds the `Size Presets` section.

### Placeholder Scan

The plan has no placeholder implementation steps. The only optional branch is verification-fix handling in Task 7, and it gives exact behavior for either outcome.

### Type Consistency

The persisted field name is `boundingSizePresetId` throughout. The default id is `size-2-2x1-5`. Resolved guide dimensions consistently use `maxWidthMm`, `maxHeightMm`, `minWidthMm`, and `minHeightMm`.
