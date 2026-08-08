import { expect, test } from "playwright/test";
import { installSeededFontRoute } from "./font-test-routes.js";

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

