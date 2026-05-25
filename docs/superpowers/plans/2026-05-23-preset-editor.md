# Preset Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible left-nav workspace switcher, a dedicated preset editor, and preset authoring/persistence flows so operators can create, edit, assign, and unassign presets directly in the app.

**Architecture:** Keep geometry and queue behavior intact while layering preset authoring on top through a pure preset-authoring helper module, a small file-backed preset API, and a new app-shell workspace switcher. Reuse the current control-card UI patterns so the order editor and preset editor share the same mental model and most of the same form-building helpers.

**Tech Stack:** Vanilla ES modules, Vitest, Playwright, Node HTTP dev server, JSON file persistence in `public/presets/`

---

## File Structure

- Create: `src/preset-authoring.js`
- Create: `src/preset-api.js`
- Create: `api/presets.js`
- Create: `tests/unit/preset-authoring.test.js`
- Create: `tests/e2e/preset-editor.spec.js`
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/presets.js`
- Modify: `src/styles.css`
- Modify: `tools/dev_server.mjs`
- Modify: `tests/unit/presets.test.js`

### Responsibility Map

- `src/preset-authoring.js`
  Pure functions for inferring reusable preset rules, creating draft definitions, updating assignments, and validating/sanitizing authoring payloads.
- `src/preset-api.js`
  Browser-facing fetch helpers for loading, creating, and updating preset definitions.
- `api/presets.js`
  Filesystem-backed preset persistence for create/update flows against `public/presets/*.json` and `public/presets/manifest.json`.
- `src/presets.js`
  Runtime registry loading plus targeted authoring-friendly exports needed by the app shell.
- `src/app.js`
  Workspace state, left-nav behavior, order-editor actions, preset editor rendering, and save flows.
- `index.html` and `src/styles.css`
  App-shell markup, nav rail, preset workspace layout, and action placement.
- `tests/unit/preset-authoring.test.js`
  TDD coverage for rule inference and assignment mutation.
- `tests/e2e/preset-editor.spec.js`
  UI verification for navigation and authoring flows.

### Task 1: Build pure preset-authoring helpers with TDD

**Files:**
- Create: `src/preset-authoring.js`
- Create: `tests/unit/preset-authoring.test.js`
- Modify: `tests/unit/presets.test.js`

- [ ] **Step 1: Write the failing unit tests for preset inference and assignment helpers**

```javascript
import { describe, expect, it } from "vitest";

import {
  inferPresetDefinitionFromSettings,
  buildPresetIdFromName,
  upsertListingAssignment,
  removeListingAssignment,
} from "../../src/preset-authoring.js";

const makeSettings = () => ({
  text: "Morgan\nRN",
  presetId: "skywalk-somekind",
  backingMm: 2.2,
  weldExportedDesign: true,
  lines: [
    {
      fontId: "skywalk",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 18,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: false,
    },
    {
      fontId: "somekind",
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      fontSizeMm: 23,
      horizontalScale: 1,
      verticalScale: 1,
      lockTextHeight: true,
    },
  ],
});

describe("preset authoring", () => {
  it("infers shared line defaults plus first and index rules from editor settings", () => {
    const preset = inferPresetDefinitionFromSettings({
      name: "Skywalk RN",
      settings: makeSettings(),
    });

    expect(preset.id).toBe("skywalk-rn");
    expect(preset.globalDefaults).toEqual({
      backingMm: 2.2,
      weldExportedDesign: true,
    });
    expect(preset.lineDefaults).toEqual({
      bridgeMm: 0.5,
      lineBridgeMm: 0.5,
      offsetXMm: 0,
      horizontalScale: 1,
      verticalScale: 1,
    });
    expect(preset.lineRules).toEqual([
      {
        match: { kind: "first" },
        settings: { fontId: "skywalk", fontSizeMm: 18, lockTextHeight: false },
      },
      {
        match: { kind: "index", lineIndex: 1 },
        settings: { fontId: "somekind", fontSizeMm: 23, lockTextHeight: true },
      },
    ]);
  });

  it("builds stable kebab-case ids from operator-facing names", () => {
    expect(buildPresetIdFromName("Skywalk RN")).toBe("skywalk-rn");
  });

  it("adds or replaces a listing assignment for one listing id", () => {
    const preset = upsertListingAssignment({
      preset: {
        id: "skywalk-rn",
        name: "Skywalk RN",
        lineDefaults: {},
        lineRules: [{ match: { kind: "all" }, settings: {} }],
        listingAssignments: [],
      },
      assignment: {
        listingId: "1884223710",
        name: "PICU Badge Reel",
      },
    });

    expect(preset.listingAssignments).toEqual([
      {
        listingId: "1884223710",
        name: "PICU Badge Reel",
        lineOverrides: [],
      },
    ]);
  });

  it("removes one listing assignment without touching the rest", () => {
    const preset = removeListingAssignment({
      preset: {
        id: "skywalk-rn",
        name: "Skywalk RN",
        lineDefaults: {},
        lineRules: [{ match: { kind: "all" }, settings: {} }],
        listingAssignments: [
          { listingId: "1884223710", name: "PICU Badge Reel", lineOverrides: [] },
          { listingId: "4465975709", name: "Tech Reel", lineOverrides: [] },
        ],
      },
      listingId: "1884223710",
    });

    expect(preset.listingAssignments).toEqual([
      { listingId: "4465975709", name: "Tech Reel", lineOverrides: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run the new unit test file and verify it fails for the missing module/export**

Run: `npx vitest run tests/unit/preset-authoring.test.js`

Expected: `FAIL` with an import or export error for `src/preset-authoring.js`

- [ ] **Step 3: Write the minimal preset-authoring implementation**

```javascript
const LINE_SETTING_KEYS = [
  "fontId",
  "bridgeMm",
  "lineBridgeMm",
  "offsetXMm",
  "fontSizeMm",
  "horizontalScale",
  "verticalScale",
  "lockTextHeight",
];

function pickLineSettings(line, keys) {
  return keys.reduce((result, key) => {
    if (Object.hasOwn(line, key)) {
      result[key] = line[key];
    }
    return result;
  }, {});
}

function diffLineSettings(base, line) {
  return LINE_SETTING_KEYS.reduce((result, key) => {
    if (line[key] !== base[key]) {
      result[key] = line[key];
    }
    return result;
  }, {});
}

export function buildPresetIdFromName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferPresetDefinitionFromSettings({ name, settings }) {
  const lines = Array.isArray(settings?.lines) ? settings.lines : [];
  const shared = LINE_SETTING_KEYS.reduce((result, key) => {
    const firstValue = lines[0]?.[key];
    if (lines.length > 0 && lines.every((line) => line?.[key] === firstValue)) {
      result[key] = firstValue;
    }
    return result;
  }, {});

  const lineRules = [];
  const firstDiff = diffLineSettings(shared, lines[0] || {});
  if (Object.keys(firstDiff).length > 0) {
    lineRules.push({ match: { kind: "first" }, settings: firstDiff });
  }

  lines.slice(1).forEach((line, index) => {
    const nextDiff = diffLineSettings(shared, line);
    if (Object.keys(nextDiff).length > 0) {
      lineRules.push({
        match: { kind: "index", lineIndex: index + 1 },
        settings: nextDiff,
      });
    }
  });

  return {
    schemaVersion: 1,
    id: buildPresetIdFromName(name),
    name: String(name ?? "").trim(),
    description: "",
    globalDefaults: {
      backingMm: settings?.backingMm,
      weldExportedDesign: settings?.weldExportedDesign,
    },
    lineDefaults: shared,
    lineRules: lineRules.length > 0 ? lineRules : [{ match: { kind: "all" }, settings: {} }],
    listingAssignments: [],
  };
}

export function upsertListingAssignment({ preset, assignment }) {
  const listingAssignments = Array.isArray(preset.listingAssignments)
    ? preset.listingAssignments.filter((item) => item.listingId !== assignment.listingId)
    : [];

  return {
    ...preset,
    listingAssignments: [
      ...listingAssignments,
      {
        listingId: assignment.listingId,
        name: assignment.name || "",
        lineOverrides: [],
      },
    ],
  };
}

export function removeListingAssignment({ preset, listingId }) {
  return {
    ...preset,
    listingAssignments: (preset.listingAssignments || []).filter((item) => item.listingId !== listingId),
  };
}
```

- [ ] **Step 4: Run the focused unit tests and verify they pass**

Run: `npx vitest run tests/unit/preset-authoring.test.js tests/unit/presets.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/preset-authoring.js tests/unit/preset-authoring.test.js tests/unit/presets.test.js
git commit -m "feat: add preset authoring helpers"
```

### Task 2: Add file-backed preset persistence with TDD

**Files:**
- Create: `src/preset-api.js`
- Create: `api/presets.js`
- Modify: `tools/dev_server.mjs`
- Modify: `src/presets.js`

- [ ] **Step 1: Write a failing unit test for authoring-safe registry mutation**

```javascript
it("can expose a full preset definition for authoring and replace it in the registry", async () => {
  setPresetRegistryForTests(
    { defaultPresetId: "all-candlepin" },
    [
      {
        schemaVersion: 1,
        id: "all-candlepin",
        name: "All Candlepin",
        lineDefaults: { fontId: "candlepin" },
        lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
        listingAssignments: [],
      },
    ],
  );

  expect(getPresetDefinitionForEditor("all-candlepin")?.name).toBe("All Candlepin");

  replacePresetDefinitionForTests({
    schemaVersion: 1,
    id: "all-candlepin",
    name: "All Candlepin Updated",
    lineDefaults: { fontId: "candlepin" },
    lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
    listingAssignments: [],
  });

  expect(getPresetDefinitionForEditor("all-candlepin")?.name).toBe("All Candlepin Updated");
});
```

- [ ] **Step 2: Run the focused registry tests and verify they fail for the missing exports**

Run: `npx vitest run tests/unit/presets.test.js`

Expected: `FAIL` with missing export errors for authoring-friendly preset accessors

- [ ] **Step 3: Add minimal registry authoring exports and the browser/API persistence layer**

```javascript
// src/presets.js
export function getPresetDefinitionForEditor(presetId) {
  const definition = getPresetDefinition(presetId);
  return definition ? structuredClone(definition) : null;
}

export function replacePresetDefinitionForTests(definition) {
  const normalized = normalizePresetDefinition(definition);
  const definitions = [...presetRegistry.presetById.values()]
    .filter((item) => item.id !== normalized.id)
    .concat(normalized);
  presetRegistry = createPresetRegistry({ defaultPresetId: presetRegistry.defaultPresetId }, definitions);
}
```

```javascript
// src/preset-api.js
export async function savePresetDefinition({ preset, previousId = null }) {
  const method = previousId ? "PUT" : "POST";
  const response = await fetch("/api/presets", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, previousId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save preset.");
  }

  return response.json();
}
```

```javascript
// api/presets.js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const presetsDir = join(process.cwd(), "public", "presets");
const manifestPath = join(presetsDir, "manifest.json");

async function readManifest() {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(path, value) {
  await mkdir(presetsDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "POST, PUT");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const preset = payload?.preset;
  const previousId = typeof payload?.previousId === "string" ? payload.previousId : null;
  const manifest = await readManifest();
  const nextPath = `public/presets/${preset.id}.json`;
  const filePath = join(process.cwd(), nextPath);

  await writeJson(filePath, preset);

  const nextEntries = Array.isArray(manifest.presets) ? [...manifest.presets] : [];
  const existingIndex = nextEntries.findIndex((entry) => entry.id === (previousId || preset.id));

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = { id: preset.id, path: nextPath };
  } else {
    nextEntries.push({ id: preset.id, path: nextPath });
  }

  await writeJson(manifestPath, {
    ...manifest,
    presets: nextEntries,
  });

  res.status(200).json({ preset, manifest: { ...manifest, presets: nextEntries } });
}
```

```javascript
// tools/dev_server.mjs
if (requestUrl.pathname === "/api/presets" && (request.method === "POST" || request.method === "PUT")) {
  readRequestBody(request).then(async (body) => {
    try {
      const { default: handler } = await import("../api/presets.js");
      const payload = body ? JSON.parse(body) : {};
      const req = { method: request.method, body: payload };
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(name, value) {
          response.setHeader(name, value);
        },
        json(payload) {
          sendJson(response, this.statusCode || 200, payload);
        },
      };
      await handler(req, res);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to save preset." });
    }
  });
  return;
}
```

- [ ] **Step 4: Run the targeted unit tests and a quick API smoke check**

Run: `npx vitest run tests/unit/presets.test.js tests/unit/preset-authoring.test.js`

Expected: `PASS`

Run: `npm start`

Expected: server prints `Badge reel layout tool: http://localhost:<port>`

Run: `Invoke-WebRequest -Method Post -Uri http://localhost:<port>/api/presets -ContentType 'application/json' -Body '{"preset":{"schemaVersion":1,"id":"tmp-plan-check","name":"Tmp Plan Check","lineDefaults":{"fontId":"candlepin"},"lineRules":[{"match":{"kind":"all"},"settings":{"fontId":"candlepin"}}],"listingAssignments":[]}}'`

Expected: `200 OK` JSON response containing `preset.id = "tmp-plan-check"`

- [ ] **Step 5: Commit**

```bash
git add src/preset-api.js src/presets.js api/presets.js tools/dev_server.mjs
git commit -m "feat: add preset persistence api"
```

### Task 3: Add the app-shell left nav and preset workspace scaffolding

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`

- [ ] **Step 1: Write a failing Playwright test for workspace navigation**

```javascript
import { test, expect } from "@playwright/test";

test("switches between order items and presets from the left nav", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Order Items" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Presets" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected design editor" })).toBeVisible();

  await page.getByRole("button", { name: "Presets" }).click();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-nav-collapsed", "true");
});
```

- [ ] **Step 2: Run the new Playwright test and verify it fails because the nav and workspace do not exist yet**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "switches between order items and presets from the left nav"`

Expected: `FAIL` because the nav buttons and preset workspace are missing

- [ ] **Step 3: Add the minimal app-shell markup, CSS, and workspace state**

```html
<main class="app-shell" data-workspace="orders" data-nav-collapsed="false">
  <aside class="workspace-nav" aria-label="Workspace navigation">
    <button id="navCollapseButton" class="workspace-nav-toggle" type="button" aria-label="Collapse navigation"></button>
    <button id="orderWorkspaceButton" class="workspace-nav-item is-active" type="button" aria-label="Order Items">
      <span class="workspace-nav-icon" aria-hidden="true"></span>
      <span class="workspace-nav-label">Order Items</span>
    </button>
    <button id="presetWorkspaceButton" class="workspace-nav-item" type="button" aria-label="Presets">
      <span class="workspace-nav-icon" aria-hidden="true"></span>
      <span class="workspace-nav-label">Presets</span>
    </button>
  </aside>

  <section class="workspace-stage">
    <section id="ordersWorkspace" class="workspace-view is-active" aria-label="Order items workspace">
      <!-- existing production-workspace -->
    </section>
    <section id="presetsWorkspace" class="workspace-view" aria-label="Preset editor workspace" hidden>
      <header class="editor-header">
        <div>
          <p class="eyebrow">Preset Library</p>
          <h2>Presets</h2>
        </div>
      </header>
    </section>
  </section>
</main>
```

```css
.app-shell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  height: 100vh;
}

.workspace-nav {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  gap: 10px;
  padding: 14px 10px;
  background: linear-gradient(180deg, #163341 0%, #21495d 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.workspace-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 12px;
}

.app-shell[data-nav-collapsed="true"] .workspace-nav-label {
  display: none;
}

.workspace-view[hidden] {
  display: none;
}
```

```javascript
const appShell = document.querySelector(".app-shell");
const ordersWorkspace = document.querySelector("#ordersWorkspace");
const presetsWorkspace = document.querySelector("#presetsWorkspace");
const orderWorkspaceButton = document.querySelector("#orderWorkspaceButton");
const presetWorkspaceButton = document.querySelector("#presetWorkspaceButton");
const navCollapseButton = document.querySelector("#navCollapseButton");

let activeWorkspace = "orders";
let navCollapsed = false;

function setActiveWorkspace(workspace) {
  activeWorkspace = workspace;
  appShell.dataset.workspace = workspace;
  ordersWorkspace.hidden = workspace !== "orders";
  presetsWorkspace.hidden = workspace !== "presets";
  orderWorkspaceButton.classList.toggle("is-active", workspace === "orders");
  presetWorkspaceButton.classList.toggle("is-active", workspace === "presets");
}

function setNavCollapsed(nextCollapsed) {
  navCollapsed = nextCollapsed;
  appShell.dataset.navCollapsed = String(nextCollapsed);
  navCollapseButton.setAttribute("aria-label", nextCollapsed ? "Expand navigation" : "Collapse navigation");
}

orderWorkspaceButton.addEventListener("click", () => setActiveWorkspace("orders"));
presetWorkspaceButton.addEventListener("click", () => setActiveWorkspace("presets"));
navCollapseButton.addEventListener("click", () => setNavCollapsed(!navCollapsed));
```

- [ ] **Step 4: Run the focused Playwright test and verify it passes**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "switches between order items and presets from the left nav"`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/app.js tests/e2e/preset-editor.spec.js
git commit -m "feat: add workspace navigation shell"
```

### Task 4: Wire the order-editor preset actions and the preset editor UI

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Modify: `src/presets.js`
- Modify: `src/preset-api.js`

- [ ] **Step 1: Write a failing Playwright test for creating and editing presets from the UI**

```javascript
test("can create a new preset from order settings and update an existing preset", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Add Design" }).click();
  await page.locator("#textInput").fill("Morgan\nRN");
  await page.locator('[data-line-index="0"] [data-setting="fontId"]').selectOption("skywalk");
  await page.locator('[data-line-index="1"] [data-setting="fontId"]').selectOption("somekind");

  await page.getByRole("button", { name: "Save as New Preset" }).click();
  await expect(page.getByRole("region", { name: "Preset editor workspace" })).toBeVisible();
  await page.locator("#presetDraftName").fill("Morgan RN");
  await page.getByRole("button", { name: "Save Preset" }).click();

  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");

  await page.locator("#presetEditorSelect").selectOption("all-candlepin");
  await page.locator("#presetDraftName").fill("All Candlepin Updated");
  await page.getByRole("button", { name: "Save Preset" }).click();
  await expect(page.locator("#presetEditorStatus")).toContainText("Saved");
});
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails because the new actions and preset editor controls are not present**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "can create a new preset from order settings and update an existing preset"`

Expected: `FAIL`

- [ ] **Step 3: Add the order-editor action row and preset editor controls**

```html
<div class="layout-utility-row" aria-label="Layout utilities">
  <button id="copyLayoutPlacementButton" class="editor-action-button editor-utility-button" type="button" disabled>...</button>
  <button id="pasteLayoutPlacementButton" class="editor-action-button editor-utility-button" type="button" disabled>...</button>
  <button id="saveAsPresetButton" class="editor-action-button editor-utility-button" type="button" disabled>
    <span class="editor-action-label">Save as New Preset</span>
  </button>
  <button id="assignPresetToListingButton" class="editor-action-button editor-utility-button" type="button" hidden>
    <span class="editor-action-label">Assign Preset to Listing</span>
  </button>
</div>
```

```html
<section id="presetsWorkspace" class="workspace-view" aria-label="Preset editor workspace" hidden>
  <header class="editor-header">
    <div>
      <p class="eyebrow">Preset Library</p>
      <h2>Preset Editor</h2>
    </div>
    <div class="editor-actions">
      <button id="newPresetButton" class="editor-action-button" type="button">New Preset</button>
      <button id="savePresetButton" class="editor-action-button" type="button">Save Preset</button>
    </div>
  </header>
  <section class="preset-editor-workspace">
    <section class="preset-editor-main">
      <label class="field compact-field">
        <span>Preset</span>
        <select id="presetEditorSelect"></select>
      </label>
      <label class="field compact-field">
        <span>Name</span>
        <input id="presetDraftName" type="text" autocomplete="off">
      </label>
      <label class="field compact-field">
        <span>Id</span>
        <input id="presetDraftId" type="text" autocomplete="off">
      </label>
      <p id="presetEditorStatus" class="note" aria-live="polite"></p>
    </section>
    <aside id="presetLineControls" class="line-controls" aria-label="Preset line rules"></aside>
  </section>
</section>
```

```javascript
import {
  buildPresetIdFromName,
  inferPresetDefinitionFromSettings,
  upsertListingAssignment,
  removeListingAssignment,
} from "./preset-authoring.js";
import { savePresetDefinition } from "./preset-api.js";

let presetEditorDraft = null;
let presetEditorSourceId = null;

function openPresetEditorForNewPreset() {
  presetEditorSourceId = null;
  presetEditorDraft = inferPresetDefinitionFromSettings({
    name: "",
    settings: getCurrentSettings(),
  });
  syncPresetEditorForm();
  setActiveWorkspace("presets");
}

async function savePresetEditorDraft() {
  const draft = collectPresetEditorDraftFromControls();
  const result = await savePresetDefinition({
    preset: draft,
    previousId: presetEditorSourceId,
  });

  presetEditorSourceId = result.preset.id;
  presetEditorDraft = result.preset;
  await loadPresetRegistry();
  renderPresetOptions();
  renderPresetEditorOptions();
}

async function assignSelectedPresetToActiveListing() {
  const order = getActiveOrder();
  if (!order?.source?.listingId) {
    return;
  }

  const definition = getPresetDefinitionForEditor(presetInput.value);
  const nextDefinition = upsertListingAssignment({
    preset: definition,
    assignment: {
      listingId: order.source.listingId,
      name: order.source.listingTitle || "",
    },
  });

  await savePresetDefinition({
    preset: nextDefinition,
    previousId: definition.id,
  });
  await loadPresetRegistry();
}

saveAsPresetButton.addEventListener("click", openPresetEditorForNewPreset);
assignPresetToListingButton.addEventListener("click", assignSelectedPresetToActiveListing);
savePresetButton.addEventListener("click", savePresetEditorDraft);
presetDraftName.addEventListener("input", () => {
  presetDraftId.value = buildPresetIdFromName(presetDraftName.value);
});
```

- [ ] **Step 4: Run the focused Playwright test and verify it passes**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "can create a new preset from order settings and update an existing preset"`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/app.js src/presets.js src/preset-api.js
git commit -m "feat: add preset editor workflows"
```

### Task 5: Add listing unassign UI and end-to-end verification

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Modify: `tests/e2e/preset-editor.spec.js`

- [ ] **Step 1: Write a failing Playwright test for listing assignment visibility and removal**

```javascript
test("shows assigned listings for a preset and unassigns one listing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Presets" }).click();

  await page.locator("#presetEditorSelect").selectOption("skywalk-somekind");
  await expect(page.getByText("1884223710")).toBeVisible();

  await page.getByRole("button", { name: "Unassign listing 1884223710" }).click();
  await expect(page.getByText("1884223710")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails because the assignment list and unassign action do not exist**

Run: `npx playwright test tests/e2e/preset-editor.spec.js -g "shows assigned listings for a preset and unassigns one listing"`

Expected: `FAIL`

- [ ] **Step 3: Render assigned listings and wire unassign saves**

```html
<section class="global-control-card" aria-label="Assigned listings">
  <div class="section-heading">Assigned Listings</div>
  <div id="presetAssignmentList" class="preset-assignment-list"></div>
</section>
```

```javascript
function renderPresetAssignmentList() {
  presetAssignmentList.replaceChildren();
  const assignments = Array.isArray(presetEditorDraft?.listingAssignments)
    ? presetEditorDraft.listingAssignments
    : [];

  assignments.forEach((assignment) => {
    const row = document.createElement("div");
    row.className = "preset-assignment-row";

    const copy = document.createElement("div");
    copy.textContent = assignment.name
      ? `${assignment.listingId} - ${assignment.name}`
      : assignment.listingId;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-action-button editor-utility-button";
    button.setAttribute("aria-label", `Unassign listing ${assignment.listingId}`);
    button.textContent = "Unassign";
    button.addEventListener("click", async () => {
      presetEditorDraft = removeListingAssignment({
        preset: presetEditorDraft,
        listingId: assignment.listingId,
      });
      await savePresetEditorDraft();
      renderPresetAssignmentList();
    });

    row.append(copy, button);
    presetAssignmentList.append(row);
  });
}
```

```css
.preset-assignment-list {
  display: grid;
  gap: 10px;
}

.preset-assignment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
}
```

- [ ] **Step 4: Run the full targeted verification set**

Run: `npx vitest run tests/unit/presets.test.js tests/unit/preset-authoring.test.js`

Expected: `PASS`

Run: `npx playwright test tests/e2e/preset-editor.spec.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/app.js tests/e2e/preset-editor.spec.js
git commit -m "feat: add preset assignment management"
```

## Self-Review

### Spec coverage

- Left nav with `Order Items` and `Presets`: covered by Task 3
- `Save as New Preset` with inferred reusable rules: covered by Tasks 1 and 4
- Update existing preset JSON definition in place: covered by Tasks 2 and 4
- `Assign Preset to Listing` from order editor: covered by Task 4
- Show assigned listings and unassign individually: covered by Task 5
- Preserve existing preset runtime behavior: covered by Tasks 1, 2, and 5 verification

### Placeholder scan

- No `TBD`, `TODO`, or “implement later” placeholders remain
- Each task includes explicit files, code, and test commands
- Save persistence is concrete and does not rely on implicit browser filesystem access

### Type consistency

- Authoring helper names stay consistent across plan tasks:
  `inferPresetDefinitionFromSettings`
  `buildPresetIdFromName`
  `upsertListingAssignment`
  `removeListingAssignment`
  `savePresetDefinition`
- Workspace names stay consistent as `orders` and `presets`
- The save flow consistently uses `previousId` to distinguish create vs update semantics

