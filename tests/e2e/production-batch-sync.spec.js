import { expect, test } from "playwright/test";
import { installSeededFontRoute, SEEDED_FONT_RECORDS } from "./font-test-routes.js";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installSeededFontRoute(page);
});

function installSupabaseSession(page) {
  return page.addInitScript(({ providedSession }) => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    window.__TFU_TEST_PRODUCTION_BATCH_ACCESS_TOKEN__ = providedSession.access_token;
    window.__TFU_TEST_SUPABASE_CLIENT__ = {
      auth: {
        getSession: async () => ({
          data: { session: providedSession },
          error: null,
        }),
        signInWithPassword: async () => ({
          data: {
            session: providedSession,
          },
          error: null,
        }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        }),
      },
    };
  }, {
    providedSession: {
      access_token: "token-1",
      user: {
        id: "user-1",
        email: "mark@example.com",
      },
    },
  });
}

async function expectWorkflowAlertFloatingToast(page) {
  await expect(page.locator("#importStatus")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const alert = document.querySelector("#importStatus");
    const topCard = document.querySelector(".editor-top-card");
    if (!(alert instanceof HTMLElement) || !(topCard instanceof HTMLElement)) {
      return null;
    }

    const alertRect = alert.getBoundingClientRect();
    const topCardRect = topCard.getBoundingClientRect();
    const style = window.getComputedStyle(alert);
    return {
      position: style.position,
      overlapsTopCard: alertRect.bottom > topCardRect.top && alertRect.top < topCardRect.bottom,
    };
  })).toEqual({
    position: "fixed",
    overlapsTopCard: false,
  });
}

function buildMockAnalysisResponse(overrides = {}) {
  return {
    isConnected: true,
    connectedComponentCount: 1,
    facePath: "M0 0 L10 0 L10 10 L0 10 Z",
    exportFacePath: "M0 0 L10 0 L10 10 L0 10 Z",
    backingPath: "M-1 -1 L11 -1 L11 11 L-1 11 Z",
    faceBoundsMm: {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    },
    ...overrides,
  };
}

function buildTestSettingsSignature(settings = {}) {
  return JSON.stringify({
    version: 2,
    text: typeof settings.text === "string" ? settings.text : "",
    presetId: typeof settings.presetId === "string" ? settings.presetId : "",
    boundingSizePresetId: typeof settings.boundingSizePresetId === "string" ? settings.boundingSizePresetId : "",
    backingMm: Number.isFinite(Number(settings.backingMm)) ? Number(settings.backingMm) : 0,
    weldExportedDesign: Boolean(settings.weldExportedDesign),
    lines: (Array.isArray(settings.lines) ? settings.lines : []).map((line = {}) => ({
      fontId: typeof line.fontId === "string" ? line.fontId : "",
      bridgeMm: Number.isFinite(Number(line.bridgeMm)) ? Number(line.bridgeMm) : 0,
      lineBridgeMm: Number.isFinite(Number(line.lineBridgeMm)) ? Number(line.lineBridgeMm) : 0,
      offsetXMm: Number.isFinite(Number(line.offsetXMm)) ? Number(line.offsetXMm) : 0,
      fontSizeMm: Number.isFinite(Number(line.fontSizeMm)) ? Number(line.fontSizeMm) : 0,
      horizontalScale: Number.isFinite(Number(line.horizontalScale)) ? Number(line.horizontalScale) : 0,
      verticalScale: Number.isFinite(Number(line.verticalScale)) ? Number(line.verticalScale) : 0,
      lockTextHeight: Boolean(line.lockTextHeight),
    })),
  });
}

function buildCachedTextLetters(settings) {
  const textLines = typeof settings?.text === "string" ? settings.text.split(/\r?\n/) : [];
  const configuredLines = Array.isArray(settings?.lines)
    ? settings.lines.filter((line) => line?.kind !== "fixedSvg")
    : [];
  const fontPaths = {
    candlepin: "public/fonts/Candlepin-Laser.otf",
    skywalk: "public/fonts/SkywalkLaserRegular.otf",
    somekind: "public/fonts/Somekind.ttf",
  };

  return textLines.flatMap((textLine, lineIndex) => {
    const line = configuredLines[lineIndex] || configuredLines[0] || {};
    return [...textLine].flatMap((character, characterIndex) => (
      character.trim()
        ? [{
            character,
            x: 2 + characterIndex * 2,
            y: 5 + lineIndex * 5,
            fontId: line.fontId,
            fontPath: fontPaths[line.fontId],
            fontSizeMm: line.fontSizeMm,
            horizontalScale: line.horizontalScale,
            verticalScale: line.verticalScale,
          }]
        : []
    ));
  });
}

function buildCompletedRemoteOrder(overrides = {}) {
  const settings = overrides.settings || {
    text: "Saved Linked\nPreset",
    presetId: "preset-a1f4c8e2b601",
    boundingSizePresetId: "size-2-2x1-5",
    backingMm: 3.1,
    weldExportedDesign: true,
    lines: [
      {
        fontId: "candlepin",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
      {
        fontId: "candlepin",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
    ],
  };
  const signature = buildTestSettingsSignature(settings);

  return {
    id: "remote-order-1",
    revision: 7,
    text: settings.text,
    status: "captured",
    settings,
    cachedBuild: {
      signature,
      layout: {
        text: settings.text,
        widthMm: 20,
        heightMm: 14,
        backingMm: settings.backingMm,
        weldExportedDesign: settings.weldExportedDesign,
        boundingSizePresetId: settings.boundingSizePresetId,
        guide: {
          id: "size-2-2x1-5",
          label: "2.2 x 1.5",
          maxWidthIn: 2.2,
          maxHeightIn: 1.5,
          maxWidthMm: 55.88,
          maxHeightMm: 38.1,
          minWidthMm: 0,
          minHeightMm: 0,
          circleDiameterMm: null,
        },
        textBoundsMm: {
          left: 1,
          top: 1,
          width: 18,
          height: 12,
        },
        fit: {
          fitScale: 1,
          lineScaleFactors: [1, 1],
          overflowsGuide: false,
        },
        letters: buildCachedTextLetters(settings),
      },
      analysis: buildMockAnalysisResponse(),
    },
    previousCompletedBuild: null,
    savedSettingsSignature: signature,
    completedSettingsSignature: signature,
    analysisBadge: {
      state: "ok",
      shortLabel: "1",
      fullLabel: "Connected acrylic face",
    },
    pendingAnalysisSignature: null,
    source: {
      listingId: "1884223710",
      listingTitle: "Linked preset listing",
      buyerName: "Avery",
    },
    ...overrides,
  };
}

async function installRemoteBatchSnapshot(page, remoteSnapshot, presetSnapshot = null) {
  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(route.request().postDataJSON()?.snapshot || remoteSnapshot),
    });
  });

  if (presetSnapshot) {
    await page.route("**/api/preset-snapshot**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          workspaceKey: "primary",
          snapshot: presetSnapshot,
        }),
      });
    });
  }
}

test("keeps a saved shared design complete when its linked listing preset differs on startup", async ({ page }) => {
  await installSupabaseSession(page);

  const remoteSnapshot = {
    batch: {
      id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      buildCompletedRemoteOrder(),
    ],
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: {
          id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });

  await page.goto("/production-batch");

  const row = page.locator("#orderList .order-row").filter({ hasText: "Saved Linked" });
  await expect(row).toContainText("Complete");
  await expect(row.locator(".order-analysis-indicator.ok")).toBeVisible();
  await expect(page.locator("#presetInput")).toHaveValue("preset-a1f4c8e2b601");
  await expect(page.locator("#captureButton")).toBeDisabled();
});

test("keeps a recognized imported customer font when startup synchronizes its listing preset", async ({ page }) => {
  await installSupabaseSession(page);

  const remoteSnapshot = {
    batch: {
      id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      buildCompletedRemoteOrder({
        text: "Avery\nRN",
        status: "in-progress",
        savedSettingsSignature: null,
        completedSettingsSignature: null,
        source: {
          listingId: "1884223710",
          listingTitle: "Linked preset listing",
          buyerName: "Avery",
          customerFontSelections: [
            { lineIndex: 0, name: "Candlepin" },
          ],
        },
        settings: {
          text: "Avery\nRN",
          presetId: "preset-a1f4c8e2b601",
          boundingSizePresetId: "size-2-2x1-5",
          backingMm: 3.1,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      }),
    ],
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });

  await page.goto("/production-batch");

  await expect(page.locator("#presetInput")).toHaveValue("preset-c3e8a1d7f520");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("candlepin");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
});

test("applies a pending Etsy line-two font when the operator adds the second text line", async ({ page }) => {
  // Break caught: a new line gets its preset default instead of the stored Etsy selection.
  await installSupabaseSession(page);
  await page.route("**/api/fonts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        fonts: [
          ...SEEDED_FONT_RECORDS,
          {
            id: "super-boys",
            display_name: "Super Boys",
            family_name: "SuperBoys",
            public_url: "public/fonts/Somekind.ttf",
            file_format: "ttf",
            version: 1,
          },
        ],
      }),
    });
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "remote-order-1",
    fontAliases: [{
      id: "alias-super-boy",
      aliasName: "Super Boy",
      normalizedAlias: "super boy",
      fontId: "super-boys",
      font: { id: "super-boys", displayName: "Super Boys", archivedAt: null, deletedAt: null },
    }],
    orderItems: [
      buildCompletedRemoteOrder({
        text: "Kiara  MA",
        status: "in-progress",
        savedSettingsSignature: null,
        completedSettingsSignature: null,
        source: {
          marketplace: "etsy",
          listingTitle: "Production-shaped pending font order",
          buyerName: "Kiara",
          customerFontSelections: [
            { lineIndex: 0, name: "Candlepin" },
            { lineIndex: 1, name: "Super Boy" },
          ],
        },
        settings: {
          text: "Kiara  MA",
          presetId: "preset-c3e8a1d7f520",
          boundingSizePresetId: "size-2-2x1-5",
          backingMm: 3.1,
          weldExportedDesign: true,
          lines: [{
            fontId: "candlepin",
            bridgeMm: 0.5,
            lineBridgeMm: 0.5,
            offsetXMm: 0,
            fontSizeMm: 34,
            horizontalScale: 1,
            verticalScale: 1,
            lockTextHeight: false,
          }],
        },
      }),
    ],
  });
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({ json: buildMockAnalysisResponse() });
  });

  await page.goto("/production-batch");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("candlepin");
  await expect(page.locator('.line-control-card[data-line-index="1"]')).toHaveCount(0);

  await page.locator("#textInput").fill("Kiara\nMA");

  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("super-boys");
});

test("maps an active marketplace font line transactionally without saving unrelated edits", async ({ page }) => {
  // Break caught: mapping either skips the active-line transaction or marks unrelated draft controls as saved.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7,
    designId: "design-1",
    designRevision: 11,
    text: "Avery",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "114-0000000-0000001", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false }] },
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id,
    fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "candlepin", revision: 3, font: { id: "candlepin", displayName: "Candlepin Laser", archivedAt: null, deletedAt: null } }],
    orderItems: [remoteOrder],
  });
  await page.route("**/api/font-aliases", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 3, orderItemId: "remote-order-1", designId: "design-1", lineIndex: 0, expectedOrderRevision: 7, expectedDesignRevision: 11 });
    await route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 4, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "candlepin", displayName: "Candlepin Laser", archivedAt: null, deletedAt: null },
      line: { lineIndex: 0, kind: "text", text: "Avery", fontId: "skywalk", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, offsetYMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false, fixedDesignId: null, fixedDesignVersion: null, svgSizeMm: 32, backingBorder: false },
      orderRevision: 8, designRevision: 12,
    } });
  });
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: buildMockAnalysisResponse() }));

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator("#backingInput").dispatchEvent("input");
  await page.getByRole("button", { name: "Change font mapping" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  const dialog = page.getByRole("dialog", { name: "Map Marketplace Font" });
  await expect(dialog.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Candlepin Laser. Replace this mapping with Skywalk Laser?");
  await expect(dialog.locator("#fontAliasConfirmButton")).toHaveText("Replace Mapping");
  await dialog.locator("#fontAliasConfirmButton").click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");
  await expect(page.locator("#customerFontSelections")).toContainText("Lemonade (Skywalk Laser)");
  await expect(page.locator("#cancelDesignButton")).toBeEnabled();
});

test("reconciles authoritative font changes by invalidating completed export state", async ({ page }) => {
  // Break caught: a mapped font changes text geometry while the browser still exports its stale completed build.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7,
    designId: "design-completed",
    designRevision: 11,
    text: "Avery",
    source: { marketplace: "amazon", orderNumber: "COMPLETE-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: {
      text: "Avery",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [{ fontId: "candlepin", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false }],
    },
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: remoteOrder.id,
    fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "candlepin", revision: 3, font: { id: "candlepin", displayName: "Candlepin Laser", archivedAt: null, deletedAt: null } }],
    orderItems: [remoteOrder],
  });
  await page.route("**/api/font-aliases", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      aliasName: "Lemonade",
      fontId: "skywalk",
      expectedAliasRevision: 3,
      orderItemId: remoteOrder.id,
      designId: "design-completed",
      lineIndex: 0,
      expectedOrderRevision: 7,
      expectedDesignRevision: 11,
    });
    await route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 4, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "candlepin", displayName: "Candlepin Laser" },
      line: { lineIndex: 0, kind: "text", text: "Avery", fontId: "skywalk", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, offsetYMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false },
      orderRevision: 8,
      designRevision: 12,
      designStateInvalidated: true,
      productionStatus: "in_progress",
    } });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await page.getByRole("button", { name: "Change font mapping" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).not.toBeVisible();
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator("#downloadButton")).toBeDisabled();
  await expect(page.locator("#copyButton")).toBeDisabled();
  await expect(page.locator("#orderList .order-status")).toHaveText("In progress");
  await expect(page.locator("#cancelDesignButton")).toBeDisabled();
});

test("reconciles a delayed font mapping only into its original order draft", async ({ page }) => {
  // Break caught: a delayed response reads the newly active order controls and corrupts both order drafts.
  await installSupabaseSession(page);
  const firstOrder = buildCompletedRemoteOrder({
    id: "order-a", revision: 7, designId: "design-a", designRevision: 11,
    text: "Avery", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "A-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  const secondOrder = buildCompletedRemoteOrder({
    id: "order-b", revision: 4, designId: "design-b", designRevision: 6,
    text: "Blair", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "B-1" },
    settings: { text: "Blair", presetId: "preset-a1f4c8e2b601", backingMm: 2.7, weldExportedDesign: true, lines: [{ fontId: "somekind" }] },
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: firstOrder.id,
    fontAliases: [], orderItems: [firstOrder, secondOrder],
  });
  let releaseMapping;
  const mappingReleased = new Promise((resolve) => { releaseMapping = resolve; });
  let mappingRequested;
  const mappingRequestStarted = new Promise((resolve) => { mappingRequested = resolve; });
  await page.route("**/api/font-aliases", async (route) => {
    mappingRequested();
    await mappingReleased;
    await route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: null,
      line: { lineIndex: 0, kind: "text", text: "Avery", fontId: "skywalk", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0, offsetYMm: 0, fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false },
      orderRevision: 8, designRevision: 12,
    } });
  });

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator("#backingInput").dispatchEvent("input");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await mappingRequestStarted;
  await expect(page.locator("#fontAliasFontSelect")).toBeDisabled();
  await expect(page.locator("#fontAliasSearchInput")).toBeDisabled();
  await expect(page.locator("#cancelFontAliasDialogButton")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).toBeVisible();

  await page.evaluate(() => {
    const nextOrder = document.querySelectorAll("#orderList .order-item")[1];
    if (!(nextOrder instanceof HTMLButtonElement)) throw new Error("Second order was not rendered");
    nextOrder.click();
  });
  await expect(page.locator("#textInput")).toHaveValue("Blair");
  releaseMapping();
  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).not.toBeVisible();
  await expect(page.locator("#textInput")).toHaveValue("Blair");
  await expect(page.locator("#backingInput")).toHaveValue("2.7");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("somekind");

  await page.evaluate(() => {
    const firstOrderButton = document.querySelectorAll("#orderList .order-item")[0];
    if (!(firstOrderButton instanceof HTMLButtonElement)) throw new Error("First order was not rendered");
    firstOrderButton.click();
  });
  await expect(page.locator("#textInput")).toHaveValue("Avery");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
});

test("uses design identity returned by ordinary saves for new and updated designs", async ({ page }) => {
  // Break caught: save responses update order revision but leave live design identity stale or missing.
  await installSupabaseSession(page);
  const newDesignOrder = buildCompletedRemoteOrder({
    id: "order-new", revision: 2, designId: null, designRevision: null,
    text: "New", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "NEW-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "New", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  const updatedDesignOrder = buildCompletedRemoteOrder({
    id: "order-existing", revision: 5, designId: "design-existing", designRevision: 8,
    text: "Existing", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "EXISTING-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Existing", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  await page.route("**/api/batch-session", route => route.fulfill({ json: { operator: { id: "user-1", email: "mark@example.com" }, workspace: { id: "workspace-1", name: "Thankful For You" }, batch: { id: "batch-1", workspaceId: "workspace-1" } } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: "order-new", fontAliases: [], orderItems: [newDesignOrder, updatedDesignOrder] } }));
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const snapshot = route.request().postDataJSON().snapshot;
    await route.fulfill({ json: {
      ...snapshot,
      orderItems: snapshot.orderItems.map((order) => order.id === "order-new"
        ? { ...order, revision: 3, designId: "design-new", designRevision: 1 }
        : { ...order, revision: 6, designId: "design-existing", designRevision: 9 }),
    } });
  });
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: buildMockAnalysisResponse() }));
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, json: { error: "Stop after request capture." } });
  });

  await page.goto("/production-batch");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(1);
  expect(mappingBodies[0]).toMatchObject({ orderItemId: "order-new", designId: "design-new", expectedOrderRevision: 3, expectedDesignRevision: 1 });
  await page.locator("#cancelFontAliasDialogButton").click();

  await page.evaluate(() => {
    const nextOrder = document.querySelectorAll("#orderList .order-item")[1];
    if (!(nextOrder instanceof HTMLButtonElement)) throw new Error("Existing order was not rendered");
    nextOrder.click();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toMatchObject({ orderItemId: "order-existing", designId: "design-existing", expectedOrderRevision: 6, expectedDesignRevision: 9 });
});

test("keeps future-line mapping success visible without synthesizing a line", async ({ page }) => {
  // Break caught: alias-only success creates a blank line or gives no durable future-line feedback.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    designId: "design-1", designRevision: 11,
    text: "Avery", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "CONFLICT-1", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  await installRemoteBatchSnapshot(page, { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] });
  await page.route("**/api/font-aliases", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ aliasName: "Lemonade", fontId: "somekind", expectedAliasRevision: null });
    await route.fulfill({ json: { alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 1, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }, previousFont: null, line: null, orderRevision: null, designRevision: null } });
  });

  await page.goto("/production-batch");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("somekind");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping saved for future Line 2. No current design line was changed.");
  await expect(page.locator("#customerFontSelections")).toContainText("Line 2 Font: Lemonade (Somekind)");
  await expect(page.locator('.line-control-card[data-line-index="1"]')).toHaveCount(0);
  await page.locator("#cancelFontAliasDialogButton").click();
  await expect(page.getByRole("button", { name: "Change font mapping" })).toBeFocused();
});

test("applies a future-line mapping to an existing unsaved draft line before save", async ({ page }) => {
  // Break caught: alias-only persistence succeeds before a draft-only line is updated, so its later save keeps the old font.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    designId: "design-future-draft",
    designRevision: 11,
    text: "Avery",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "FUTURE-DRAFT-1", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: remoteOrder.id,
    fontAliases: [],
    orderItems: [remoteOrder],
  });
  const savedSnapshots = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/production-batch") {
      savedSnapshots.push(request.postDataJSON()?.snapshot);
    }
  });
  await page.route("**/api/font-aliases", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      aliasName: "Lemonade",
      fontId: "somekind",
      expectedAliasRevision: null,
    });
    await route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 1, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } },
      previousFont: null,
      line: null,
      orderRevision: null,
      designRevision: null,
      designStateInvalidated: false,
      productionStatus: null,
    } });
  });
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: buildMockAnalysisResponse() }));

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Avery\nRN");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("somekind");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping applied to draft Line 2. Save this design to persist the line.");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
  await page.locator("#cancelFontAliasDialogButton").click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => savedSnapshots.some((snapshot) => (
    snapshot?.orderItems?.find((order) => order.id === remoteOrder.id)?.settings?.lines?.[1]?.fontId === "somekind"
  ))).toBe(true);
});

test("keeps a future draft line mapped through alias conflict recovery and retry", async ({ page }) => {
  // Break caught: recovery marks a draft-only line as server-omitted and then suppresses applying the successful retry to it.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    designId: "design-future-conflict",
    designRevision: 11,
    text: "Avery",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "FUTURE-CONFLICT-1", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: remoteOrder.id,
    fontAliases: [],
    orderItems: [remoteOrder],
  });
  const savedSnapshots = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/production-batch") {
      savedSnapshots.push(request.postDataJSON()?.snapshot);
    }
  });
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    if (mappingBodies.length === 1) {
      return route.fulfill({ status: 409, json: {
        error: "This mapping changed while you were editing it. Refresh and try again.",
        code: "FONT_ALIAS_CONFLICT",
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 2, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
      } });
    }
    return route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 3, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "somekind", displayName: "Somekind" },
      line: null,
      orderRevision: null,
      designRevision: null,
      designStateInvalidated: false,
      productionStatus: null,
    } });
  });
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: buildMockAnalysisResponse() }));

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Avery\nRN");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(page.locator('.line-control-card[data-line-index="1"]')).toHaveCount(1);
  await page.locator("#fontAliasConfirmButton").click();
  await expect(page.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Somekind. Replace this mapping with Skywalk Laser?");
  await page.locator("#fontAliasConfirmButton").click();

  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toEqual({ aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 2 });
  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping applied to draft Line 2. Save this design to persist the line.");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await page.locator("#cancelFontAliasDialogButton").click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => savedSnapshots.some((snapshot) => (
    snapshot?.orderItems?.find((order) => order.id === remoteOrder.id)?.settings?.lines?.[1]?.fontId === "skywalk"
  ))).toBe(true);
});

test("recovers a font alias revision conflict and keeps the selected target for retry", async ({ page }) => {
  // Break caught: a 409 keeps a stale baseline/line, loses draft edits, or retries a removed line mutation.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  let releaseRecovery;
  const recoveryReleased = new Promise((resolve) => { releaseRecovery = resolve; });
  let recoveryRequested;
  const recoveryRequestStarted = new Promise((resolve) => { recoveryRequested = resolve; });
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7, designId: "design-1", designRevision: 11, text: "Avery\nRN", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "CONFLICT-2", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery\nRN", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }, { fontId: "candlepin" }] },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    text: "Avery",
    settings: { ...remoteOrder.settings, text: "Avery", lines: [{ ...remoteOrder.settings.lines[0], fontId: "somekind" }] },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: { operator: { id: "user-1", email: "mark@example.com" }, workspace: { id: "workspace-1", name: "Thankful For You" }, batch: { id: "batch-1", workspaceId: "workspace-1" } } }));
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    if (snapshotReads++ === 0) {
      await route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] } });
      return;
    }
    recoveryRequested();
    await recoveryReleased;
    await route.fulfill({ json: { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: latestOrder.id, fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }], orderItems: [latestOrder] } });
  });
  await page.route("**/api/production-batch", route => route.request().method() === "PUT" ? route.fulfill({ json: route.request().postDataJSON()?.snapshot }) : route.fallback());
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    if (mappingBodies.length === 1) {
      return route.fulfill({ status: 409, json: { error: "This mapping changed while you were editing it. Refresh and try again.", code: "FONT_ALIAS_CONFLICT", fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }] } });
    }
    return route.fulfill({ json: { alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 5, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } }, previousFont: { id: "somekind", displayName: "Somekind" }, line: null, orderRevision: null, designRevision: null } });
  });

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator("#backingInput").dispatchEvent("input");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await recoveryRequestStarted;
  await expect(page.locator("#fontAliasFontSelect")).toBeDisabled();
  await expect(page.locator("#cancelFontAliasDialogButton")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).toBeVisible();
  releaseRecovery();

  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).toBeVisible();
  await expect(page.locator("#fontAliasFontSelect")).toHaveValue("skywalk");
  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  expect(mappingBodies[0]).toEqual({
    aliasName: "Lemonade",
    fontId: "skywalk",
    expectedAliasRevision: null,
    orderItemId: remoteOrder.id,
    designId: "design-1",
    lineIndex: 1,
    expectedOrderRevision: 7,
    expectedDesignRevision: 11,
  });
  await expect(page.locator("#customerFontSelections")).toContainText("Lemonade (Somekind)");
  await expect(page.locator("#textInput")).toHaveValue("Avery");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");
  await expect(page.locator('.line-control-card[data-line-index="1"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  const updatedAction = page.getByRole("button", { name: "Change font mapping" });
  await expect(updatedAction).toBeFocused();

  await updatedAction.click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();
  await expect(page.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Somekind. Replace this mapping with Skywalk Laser?");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toEqual({ aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 4 });
  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping saved for future Line 2. No current design line was changed.");
  await page.locator("#cancelFontAliasDialogButton").click();
  await page.locator("#cancelDesignButton").click();
  await expect(page.locator("#backingInput")).toHaveValue("3.1");
  await expect(page.locator("#textInput")).toHaveValue("Avery");
});

test("preserves selected-line draft layout through font alias conflict recovery and retry", async ({ page }) => {
  // Break caught: 409 recovery and its retry drop unsaved non-font edits on a selected line that still exists.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const originalLine = {
    fontId: "candlepin", bridgeMm: 0.5, lineBridgeMm: 0.5, offsetXMm: 0,
    fontSizeMm: 34, horizontalScale: 1, verticalScale: 1, lockTextHeight: false,
  };
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7, designId: "design-1", designRevision: 11,
    text: "Avery", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "CONFLICT-3", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [originalLine] },
  });
  const latestLine = { ...originalLine, fontId: "somekind", bridgeMm: 0.7, offsetXMm: 0.25, horizontalScale: 1.1 };
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    settings: { ...remoteOrder.settings, lines: [latestLine] },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    if (mappingBodies.length === 1) {
      return route.fulfill({ status: 409, json: {
        error: "This mapping changed while you were editing it. Refresh and try again.",
        code: "FONT_ALIAS_CONFLICT",
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
      } });
    }
    return route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 5, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "somekind", displayName: "Somekind" },
      line: { ...latestLine, lineIndex: 0, kind: "text", text: "Avery", fontId: "skywalk" },
      orderRevision: 9,
      designRevision: 13,
    } });
  });

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator('.line-control-card[data-line-index="0"] [data-setting="bridgeMm"]').fill("0.9");
  await page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]').fill("1.4");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="bridgeMm"]')).toHaveValue("0.9");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]')).toHaveValue("1.4");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");

  await page.locator("#fontAliasConfirmButton").click();
  await expect(page.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Somekind. Replace this mapping with Skywalk Laser?");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toEqual({
    aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 4, orderItemId: remoteOrder.id, designId: "design-1",
    lineIndex: 0, expectedOrderRevision: 8, expectedDesignRevision: 12,
  });
  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).not.toBeVisible();
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="bridgeMm"]')).toHaveValue("0.9");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]')).toHaveValue("1.4");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");

  await page.locator("#cancelDesignButton").click();
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="bridgeMm"]')).toHaveValue("0.7");
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]')).toHaveValue("1.1");
  await expect(page.locator("#backingInput")).toHaveValue("3.1");
});

test("rebases an unrelated draft line across a concurrent line insertion without transplanting it", async ({ page }) => {
  // Break caught: ordinal rebasing copies the old second-line draft onto a newly inserted second line.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const originalLines = [
    { fontId: "candlepin", bridgeMm: 0.5, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.6, horizontalScale: 1.1 },
  ];
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7,
    designId: "design-insertion",
    designRevision: 11,
    text: "Avery\nRN",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "INSERT-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery\nRN", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: originalLines },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    text: "Avery\nNEW\nRN",
    settings: {
      ...remoteOrder.settings,
      text: "Avery\nNEW\nRN",
      lines: [
        { ...originalLines[0], fontId: "somekind" },
        { fontId: "skywalk", bridgeMm: 0.2, horizontalScale: 0.8 },
        { ...originalLines[1], bridgeMm: 0.7, horizontalScale: 1.2 },
      ],
    },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: {
      error: "This mapping changed while you were editing it. Refresh and try again.",
      code: "FONT_ALIAS_CONFLICT",
      fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
    } });
  });

  await page.goto("/production-batch");
  await page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]').fill("0.9");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  expect(mappingBodies[0]).toMatchObject({ expectedAliasRevision: null, lineIndex: 0 });
  await expect(page.locator("#textInput")).toHaveValue("Avery\nNEW\nRN");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]')).toHaveValue("0.2");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]')).toHaveValue("0.8");
  await expect(page.locator('.line-control-card[data-line-index="2"] [data-setting="bridgeMm"]')).toHaveValue("0.9");
  await expect(page.locator('.line-control-card[data-line-index="2"] [data-setting="horizontalScale"]')).toHaveValue("1.2");
});

test("three-way rebases simultaneous local and remote line insertions", async ({ page }) => {
  // Break caught: base-to-latest-only rebasing treats the local inserted line as the old second line and drops the remote insertion.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const originalLines = [
    { fontId: "candlepin", bridgeMm: 0.5, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.6, horizontalScale: 1.1 },
  ];
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7,
    designId: "design-three-way-insertion",
    designRevision: 11,
    text: "Avery\nRN",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "THREE-WAY-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery\nRN", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: originalLines },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    text: "Avery\nREMOTE\nRN",
    settings: {
      ...remoteOrder.settings,
      text: "Avery\nREMOTE\nRN",
      lines: [
        { ...originalLines[0], fontId: "somekind" },
        { fontId: "skywalk", bridgeMm: 0.2, horizontalScale: 0.8 },
        { ...originalLines[1], bridgeMm: 0.7, horizontalScale: 1.2 },
      ],
    },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  await page.route("**/api/font-aliases", route => route.fulfill({ status: 409, json: {
    error: "This mapping changed while you were editing it. Refresh and try again.",
    code: "FONT_ALIAS_CONFLICT",
    fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
  } }));

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Avery\nLOCAL\nRN");
  await page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]').fill("0.4");
  await page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]').fill("0.85");
  await page.locator('.line-control-card[data-line-index="2"] [data-setting="bridgeMm"]').fill("0.9");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(page.locator("#textInput")).toHaveValue("Avery\nREMOTE\nLOCAL\nRN");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]')).toHaveValue("0.2");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]')).toHaveValue("0.8");
  await expect(page.locator('.line-control-card[data-line-index="2"] [data-setting="bridgeMm"]')).toHaveValue("0.4");
  await expect(page.locator('.line-control-card[data-line-index="2"] [data-setting="horizontalScale"]')).toHaveValue("0.85");
  await expect(page.locator('.line-control-card[data-line-index="3"] [data-setting="bridgeMm"]')).toHaveValue("0.9");
  // Inserting LOCAL normalizes the shifted RN line to scale 1 in the draft; that local RN setting follows RN.
  await expect(page.locator('.line-control-card[data-line-index="3"] [data-setting="horizontalScale"]')).toHaveValue("1");
});

test("three-way rebases fixed SVG draft controls during font alias conflict recovery", async ({ page }) => {
  // Break caught: fixed SVG size and backing-border edits were omitted from the conflict merge field list.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const fixedLine = {
    kind: "fixedSvg",
    fixedDesignId: "fixed-design-heart",
    fixedDesignName: "Cardiology Heart",
    fixedDesignVersion: 3,
    svgSizeMm: 28,
    offsetXMm: 0,
    offsetYMm: 0,
    backingBorder: false,
  };
  const textLine = { fontId: "candlepin", bridgeMm: 0.5, horizontalScale: 1 };
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7,
    designId: "design-fixed-three-way",
    designRevision: 11,
    text: "Avery",
    status: "in-progress",
    savedSettingsSignature: null,
    completedSettingsSignature: null,
    cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "FIXED-THREE-WAY-1", customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: {
      text: "Avery",
      presetId: "preset-a1f4c8e2b601",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [textLine, fixedLine],
    },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    settings: {
      ...remoteOrder.settings,
      lines: [
        { ...textLine, fontId: "somekind" },
        { ...fixedLine, svgSizeMm: 31, offsetXMm: 2, offsetYMm: 1.5 },
      ],
    },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  await page.route("**/api/fixed-designs**", route => route.fulfill({ json: { fixedDesigns: [{
    id: "fixed-design-heart",
    workspace_id: "workspace-1",
    display_name: "Cardiology Heart",
    version: 3,
    metadata_json: {},
    deleted_at: null,
  }] } }));
  await page.route("**/api/font-aliases", route => route.fulfill({ status: 409, json: {
    error: "This mapping changed while you were editing it. Refresh and try again.",
    code: "FONT_ALIAS_CONFLICT",
    fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 5, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
  } }));
  await page.route("**/api/layout-analyze", route => route.fulfill({ json: buildMockAnalysisResponse() }));

  await page.goto("/production-batch");
  const fixedCard = page.locator('.line-control-card[data-line-kind="fixedSvg"]');
  await expect(fixedCard).toHaveCount(1);
  await fixedCard.locator('[data-setting="svgSizeMm"]').fill("42");
  await fixedCard.locator('[data-setting="backingBorder"]').check();
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(fixedCard.locator('[data-setting="svgSizeMm"]')).toHaveValue("42");
  await expect(fixedCard.locator('[data-setting="backingBorder"]')).toBeChecked();
  await expect(fixedCard.locator('[data-setting="offsetXMm"]')).toHaveValue("2");
  await expect(fixedCard.locator('[data-setting="offsetYMm"]')).toHaveValue("1.5");
});

test("treats a shifted replacement line as removed during font alias conflict recovery", async ({ page }) => {
  // Break caught: ordinal-only matching rebases deleted-line edits onto a later line and retries against that replacement.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const originalLines = [
    { fontId: "candlepin", bridgeMm: 0.5, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.6, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.3, horizontalScale: 1.2 },
  ];
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7, designId: "design-1", designRevision: 11,
    text: "Avery\nRN\nBSN", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "CONFLICT-4", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery\nRN\nBSN", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: originalLines },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    text: "Avery\nBSN",
    settings: {
      ...remoteOrder.settings,
      text: "Avery\nBSN",
      lines: [originalLines[0], { ...originalLines[2], fontId: "somekind" }],
    },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    if (mappingBodies.length === 1) {
      return route.fulfill({ status: 409, json: {
        error: "This mapping changed while you were editing it. Refresh and try again.",
        code: "FONT_ALIAS_CONFLICT",
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
      } });
    }
    return route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 5, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "somekind", displayName: "Somekind" },
      line: null,
      orderRevision: null,
      designRevision: null,
    } });
  });

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]').fill("0.9");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(page.locator("#textInput")).toHaveValue("Avery\nBSN");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]')).toHaveValue("0.3");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]')).toHaveValue("1.2");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");

  await page.locator("#fontAliasConfirmButton").click();
  await expect(page.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Somekind. Replace this mapping with Skywalk Laser?");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toEqual({ aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 4 });
  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping saved for future Line 2. No current design line was changed.");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
});

test("treats an ordinal-shifted duplicate text line as ambiguous during font alias conflict recovery", async ({ page }) => {
  // Break caught: text equality alone mistakes a later duplicate for the deleted selected line, rebases its draft, and retries with line context.
  await installSupabaseSession(page);
  let snapshotReads = 0;
  const originalLines = [
    { fontId: "candlepin", bridgeMm: 0.5, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.6, horizontalScale: 1 },
    { fontId: "candlepin", bridgeMm: 0.3, horizontalScale: 1.2 },
  ];
  const remoteOrder = buildCompletedRemoteOrder({
    revision: 7, designId: "design-1", designRevision: 11,
    text: "Avery\nRN\nRN", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { marketplace: "amazon", orderNumber: "CONFLICT-5", customerFontSelections: [{ lineIndex: 1, name: "Lemonade" }] },
    settings: { text: "Avery\nRN\nRN", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: originalLines },
  });
  const latestOrder = {
    ...remoteOrder,
    revision: 8,
    designRevision: 12,
    text: "Avery\nRN",
    settings: {
      ...remoteOrder.settings,
      text: "Avery\nRN",
      lines: [originalLines[0], { ...originalLines[2], fontId: "somekind" }],
    },
  };
  await page.route("**/api/batch-session", route => route.fulfill({ json: {
    operator: { id: "user-1", email: "mark@example.com" },
    workspace: { id: "workspace-1", name: "Thankful For You" },
    batch: { id: "batch-1", workspaceId: "workspace-1" },
  } }));
  await page.route("**/api/production-batch?batchId=batch-1", route => route.fulfill({ json: snapshotReads++ === 0
    ? { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] }
    : {
        batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: latestOrder.id,
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
        orderItems: [latestOrder],
      } }));
  await page.route("**/api/production-batch", route => route.request().method() === "PUT"
    ? route.fulfill({ json: route.request().postDataJSON()?.snapshot })
    : route.fallback());
  const mappingBodies = [];
  await page.route("**/api/font-aliases", route => {
    mappingBodies.push(route.request().postDataJSON());
    if (mappingBodies.length === 1) {
      return route.fulfill({ status: 409, json: {
        error: "This mapping changed while you were editing it. Refresh and try again.",
        code: "FONT_ALIAS_CONFLICT",
        fontAliases: [{ id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "somekind", revision: 4, font: { id: "somekind", displayName: "Somekind", archivedAt: null, deletedAt: null } }],
      } });
    }
    return route.fulfill({ json: {
      alias: { id: "alias-1", aliasName: "Lemonade", normalizedAlias: "lemonade", fontId: "skywalk", revision: 5, font: { id: "skywalk", displayName: "Skywalk Laser", archivedAt: null, deletedAt: null } },
      previousFont: { id: "somekind", displayName: "Somekind" },
      line: null,
      orderRevision: null,
      designRevision: null,
    } });
  });

  await page.goto("/production-batch");
  await page.locator("#backingInput").fill("4.2");
  await page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]').fill("0.9");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.locator("#fontAliasStatus")).toContainText("This mapping changed while you were editing it");
  await expect(page.locator("#textInput")).toHaveValue("Avery\nRN");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]')).toHaveValue("0.3");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]')).toHaveValue("1.2");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");

  await page.locator("#fontAliasConfirmButton").click();
  await expect(page.locator("#fontAliasStatus")).toContainText("Lemonade is currently mapped to Somekind. Replace this mapping with Skywalk Laser?");
  await page.locator("#fontAliasConfirmButton").click();
  await expect.poll(() => mappingBodies.length).toBe(2);
  expect(mappingBodies[1]).toEqual({ aliasName: "Lemonade", fontId: "skywalk", expectedAliasRevision: 4 });
  await expect(page.locator("#fontAliasStatus")).toContainText("Mapping saved for future Line 2. No current design line was changed.");
  await expect(page.locator('.line-control-card[data-line-index="1"] [data-setting="bridgeMm"]')).toHaveValue("0.3");
});

test("leaves alias and design state unchanged when font mapping fails", async ({ page }) => {
  // Break caught: a failed request optimistically mutates the line or alias label.
  await installSupabaseSession(page);
  const remoteOrder = buildCompletedRemoteOrder({
    designId: "design-1", designRevision: 11,
    text: "Avery", status: "in-progress", savedSettingsSignature: null, completedSettingsSignature: null, cachedBuild: null,
    source: { customerFontSelections: [{ lineIndex: 0, name: "Lemonade" }] },
    settings: { text: "Avery", presetId: "preset-a1f4c8e2b601", backingMm: 3.1, weldExportedDesign: true, lines: [{ fontId: "candlepin" }] },
  });
  await installRemoteBatchSnapshot(page, { batch: { id: "batch-1", workspaceId: "workspace-1" }, activeOrderItemId: remoteOrder.id, fontAliases: [], orderItems: [remoteOrder] });
  await page.route("**/api/font-aliases", route => route.fulfill({ status: 500, json: { error: "Unable to save this font mapping." } }));

  await page.goto("/production-batch");
  await page.getByRole("button", { name: "Map font" }).click();
  await page.locator("#fontAliasFontSelect").selectOption("skywalk");
  await page.locator("#fontAliasConfirmButton").click();

  await expect(page.getByRole("dialog", { name: "Map Marketplace Font" })).toBeVisible();
  await expect(page.locator("#fontAliasStatus")).toContainText("Unable to save this font mapping.");
  await expect(page.locator("#customerFontSelections")).toContainText("Lemonade (Unmapped)");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("candlepin");
});

test("reapplies imported customer fonts when assigning a preset to a listing", async ({ page }) => {
  await installSupabaseSession(page);

  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      buildCompletedRemoteOrder({
        text: "Avery\nRN",
        status: "in-progress",
        savedSettingsSignature: null,
        completedSettingsSignature: null,
        source: {
          listingId: "customer-font-assignment",
          listingTitle: "Customer font assignment",
          buyerName: "Avery",
          customerFontSelections: [{ lineIndex: 0, name: "Candlepin" }],
        },
        settings: {
          text: "Avery\nRN",
          presetId: "preset-a1f4c8e2b601",
          lines: [{ fontId: "candlepin" }, { fontId: "candlepin" }],
        },
      }),
    ],
  });

  await page.goto("/production-batch");

  await page.locator("#presetInput").selectOption("preset-c3e8a1d7f520");
  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("skywalk");
  await page.locator(".preset-tools-toggle").click();
  await page.getByRole("button", { name: "Assign Preset to Listing" }).click();

  await expect(page.locator('.line-control-card[data-line-index="0"] select[data-setting="fontId"]')).toHaveValue("candlepin");
  await expect(page.locator('.line-control-card[data-line-index="1"] select[data-setting="fontId"]')).toHaveValue("somekind");
});

test("synchronizes a stale size guide from a listing preset", async ({ page }) => {
  await installSupabaseSession(page);

  const presetSnapshot = {
    version: 1,
    defaultPresetId: "preset-custom-size-guide",
    sizePresets: [{
      id: "size-custom-guide",
      label: "Custom guide",
      max: { widthIn: 2.4, heightIn: 1.6 },
      min: { widthIn: 1.6, heightIn: 1.1 },
    }],
    presets: [{
      schemaVersion: 1,
      id: "preset-custom-size-guide",
      name: "Custom size guide",
      globalDefaults: {
        boundingSizePresetId: "size-custom-guide",
        backingMm: 3.1,
        weldExportedDesign: true,
      },
      lineDefaults: {
        fontId: "candlepin",
        bridgeMm: 0.5,
        lineBridgeMm: 0.5,
        offsetXMm: 0,
        fontSizeMm: 34,
        horizontalScale: 1,
        verticalScale: 1,
        lockTextHeight: false,
      },
      lineRules: [],
      listingAssignments: [{
        listingId: "stale-size-guide-listing",
        name: "Stale size guide listing",
      }],
    }],
  };

  await installRemoteBatchSnapshot(page, {
    batch: { id: "batch-1", workspaceId: "workspace-1" },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      buildCompletedRemoteOrder({
        text: "Avery",
        status: "in-progress",
        savedSettingsSignature: null,
        completedSettingsSignature: null,
        source: {
          listingId: "stale-size-guide-listing",
          listingTitle: "Stale size guide listing",
          buyerName: "Avery",
        },
        settings: {
          text: "Avery",
          presetId: "preset-custom-size-guide",
          boundingSizePresetId: "size-2-2x1-5",
          backingMm: 3.1,
          weldExportedDesign: true,
          lines: [{ fontId: "candlepin" }],
        },
      }),
    ],
  }, presetSnapshot);

  await page.goto("/production-batch");

  await expect(page.locator("#boundingSizePresetInput")).toHaveValue("size-custom-guide");
});

test("discarding a conflicted local draft reloads the production batch without a follow-up recovery alert", async ({ page }) => {
  await installSupabaseSession(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-05-26T15:30:00.000Z",
      updatedBy: {
        name: "Avery",
        email: "avery@example.com",
      },
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        updatedAt: "2026-05-26T15:30:00.000Z",
        updatedBy: {
          name: "Avery",
          email: "avery@example.com",
        },
        text: "Remote Shared",
        status: "in-progress",
        settings: {
          text: "Remote Shared",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };
  const productionBatchSavePayloads = [];

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    productionBatchSavePayloads.push(route.request().postDataJSON()?.snapshot);
    await route.fulfill({
      status: 409,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: "Revision conflict",
        details: {
          orderId: "remote-order-1",
          revision: 4,
          updatedAt: "2026-05-26T15:45:00.000Z",
          updatedBy: {
            name: "Avery",
            email: "avery@example.com",
          },
        },
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");

  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => productionBatchSavePayloads.length, { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator("#importStatus")).toContainText("A newer version of this design has been saved.");
  await expectWorkflowAlertFloatingToast(page);

  await page.getByRole("button", { name: "Load Latest Design", exact: true }).click();
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");
  await expect(page.locator("#productionBatchBanner")).toHaveCount(0);
});

test("retries save when a conflict only changes revision metadata", async ({ page }) => {
  await installSupabaseSession(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  const initialOrder = buildCompletedRemoteOrder({
    revision: 3,
    text: "Remote Shared",
    settings: {
      text: "Remote Shared",
      presetId: "preset-a1f4c8e2b601",
      boundingSizePresetId: "size-2-2x1-5",
      backingMm: 3.1,
      weldExportedDesign: true,
      lines: [
        {
          fontId: "candlepin",
          bridgeMm: 0.5,
          lineBridgeMm: 0.5,
          offsetXMm: 0,
          fontSizeMm: 34,
          horizontalScale: 1,
          verticalScale: 1,
          lockTextHeight: false,
        },
      ],
    },
  });
  const revisionOnlyOrder = {
    ...initialOrder,
    revision: 4,
    updatedAt: "2026-07-12T10:05:00.000Z",
    updatedBy: { email: "mark@example.com" },
  };
  const savedOrder = buildCompletedRemoteOrder({
    revision: 5,
    text: "Remote Shared Updated",
    settings: {
      ...initialOrder.settings,
      text: "Remote Shared Updated",
      lines: [
        {
          ...initialOrder.settings.lines[0],
          text: "Remote Shared Updated",
        },
      ],
    },
  });
  const productionBatchSavePayloads = [];
  let latestGetRequested = false;

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    latestGetRequested = latestGetRequested || productionBatchSavePayloads.length > 0;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "remote-order-1",
        orderItems: [latestGetRequested ? revisionOnlyOrder : initialOrder],
      }),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    productionBatchSavePayloads.push(route.request().postDataJSON()?.snapshot);
    if (productionBatchSavePayloads.length === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          error: "Revision conflict",
          details: { orderItemId: "remote-order-1", revision: 4 },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        batch: { id: "batch-1", workspaceId: "workspace-1" },
        activeOrderItemId: "remote-order-1",
        orderItems: [savedOrder],
      }),
    });
  });

  await page.goto("/production-batch");
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");

  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => productionBatchSavePayloads.length, { timeout: 15000 }).toBe(2);
  expect(productionBatchSavePayloads[1]?.orderItems?.[0]?.revision).toBe(4);
  await expect(page.locator("#importStatus")).not.toContainText("A newer version of this design has been saved.");
});
test("shows stale design alerts only on the affected design", async ({ page }) => {
  await installSupabaseSession(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-05-27T20:02:00.000Z",
      updatedBy: {
        email: "mspeich@gmail.com",
      },
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        updatedAt: "2026-05-27T20:02:00.000Z",
        updatedBy: {
          email: "mspeich@gmail.com",
        },
        text: "Conflict Design",
        status: "in-progress",
        settings: {
          text: "Conflict Design",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
      {
        id: "remote-order-2",
        revision: 2,
        updatedAt: "2026-05-27T19:55:00.000Z",
        updatedBy: {
          email: "avery@example.com",
        },
        text: "Stable Design",
        status: "in-progress",
        settings: {
          text: "Stable Design",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  let saveAttemptCount = 0;
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    saveAttemptCount += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: "Revision conflict",
        details: {
          revision: 4,
          updatedAt: "2026-05-27T20:02:00.000Z",
          updatedBy: {
            email: "mspeich@gmail.com",
          },
        },
      }),
    });
  });

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Conflict Design Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator("#importStatus")).toContainText("A newer version of this design has been saved.");
  await expectWorkflowAlertFloatingToast(page);

  const stableRow = page.locator("#orderList .order-row").filter({ hasText: "Stable Design" });
  await stableRow.locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");
  await expect(page.locator("#productionBatchBanner")).toHaveCount(0);
  await expect(page.locator("#importStatus")).toBeHidden();
  await page.waitForTimeout(500);
  expect(saveAttemptCount).toBe(1);

  await page.locator("#textInput").fill("Stable Design Local Edit");
  await page.waitForTimeout(500);
  expect(saveAttemptCount).toBe(1);

  const conflictRow = page.locator("#orderList .order-row").filter({ hasText: "Conflict Design" });
  await conflictRow.locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(page.locator("#importStatus")).toContainText("A newer version of this design has been saved.");
});

test("keeps autosave conflict alerts tied to the stale design after switching rows", async ({ page }) => {
  await installSupabaseSession(page);
  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        text: "Conflict Design",
        status: "in-progress",
        settings: {
          text: "Conflict Design",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
      {
        id: "remote-order-2",
        revision: 2,
        text: "Stable Design",
        status: "in-progress",
        settings: {
          text: "Stable Design",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  let conflictSaveCount = 0;
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    await page.waitForTimeout(250);
    conflictSaveCount += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: "Revision conflict",
        details: JSON.stringify({
          orderId: "remote-order-1",
          revision: 4,
        }),
      }),
    });
  });

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Conflict Design Draft");
  const stableRow = page.locator("#orderList .order-row").filter({ hasText: "Stable Design" });
  await stableRow.locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");
  await expect.poll(() => conflictSaveCount).toBeGreaterThan(0);
  await expect(page.locator("#importStatus")).toBeHidden();

  const conflictRow = page.locator("#orderList .order-row").filter({ hasText: "Conflict Design Draft" });
  await conflictRow.locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(page.locator("#importStatus")).toContainText("A newer version of this design has been saved.");
});

test("cancel restores the last saved shared design state", async ({ page }) => {
  await installSupabaseSession(page);
  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        updatedAt: "2026-05-27T20:10:00.000Z",
        updatedBy: {
          email: "mspeich@gmail.com",
        },
        text: "Saved Shared",
        status: "in-progress",
        settings: {
          text: "Saved Shared",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };
  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.goto("/production-batch");
  await expect(page.locator("#cancelDesignButton")).toBeDisabled();

  await page.locator("#textInput").fill("Draft Change");
  await expect(page.locator("#cancelDesignButton")).toBeEnabled();

  await page.locator("#cancelDesignButton").click();
  await expect(page.locator("#textInput")).toHaveValue("Saved Shared");
  await expect(page.locator("#cancelDesignButton")).toBeDisabled();
});

test("does not re-autosave immediately after a successful manual save merges revision metadata", async ({ page }) => {
  await installSupabaseSession(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        text: "Remote Shared",
        status: "in-progress",
        settings: {
          text: "Remote Shared",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };
  const productionBatchSavePayloads = [];

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    const requestSnapshot = route.request().postDataJSON()?.snapshot;
    productionBatchSavePayloads.push(requestSnapshot);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        ...requestSnapshot,
        orderItems: requestSnapshot.orderItems.map((order) => ({
          ...order,
          revision: 4,
          designId: "design-created-by-save",
          designRevision: 1,
          updatedAt: "2026-05-26T16:05:00.000Z",
          updatedBy: {
            name: "Avery",
            email: "avery@example.com",
          },
        })),
      }),
    });
  });

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => productionBatchSavePayloads.length).toBe(1);
  await page.waitForTimeout(500);
  await expect.poll(() => productionBatchSavePayloads.length).toBe(1);
});

test("save confirmation renders as a floating toast without entering the editor layout", async ({ page }) => {
  await installSupabaseSession(page);
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  const remoteSnapshot = {
    batch: { id: "batch-1",
      workspaceId: "workspace-1",
    },
    activeOrderItemId: "remote-order-1",
    orderItems: [
      {
        id: "remote-order-1",
        revision: 3,
        text: "Remote Shared",
        status: "in-progress",
        settings: {
          text: "Remote Shared",
          presetId: "preset-oval",
          backingMm: 2.2,
          weldExportedDesign: true,
          lines: [
            {
              fontId: "candlepin",
              bridgeMm: 0.5,
              lineBridgeMm: 0.5,
              offsetXMm: 0,
              fontSizeMm: 34,
              horizontalScale: 1,
              verticalScale: 1,
              lockTextHeight: false,
            },
          ],
        },
      },
    ],
  };

  await page.route("**/api/batch-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        batch: { id: "batch-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/production-batch?batchId=batch-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/production-batch", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    const requestSnapshot = route.request().postDataJSON()?.snapshot;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(requestSnapshot),
    });
  });

  await page.goto("/production-batch");
  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator("#importStatus")).toContainText("Production batch saved");
  await expectWorkflowAlertFloatingToast(page);
});

