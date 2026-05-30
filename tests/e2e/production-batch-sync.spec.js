import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

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

test("discarding a conflicted local draft reloads the production batch without a follow-up recovery alert", async ({ page }) => {
  await installSupabaseSession(page);
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

  await page.goto("/");
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

test("shows stale design alerts only on the affected design", async ({ page }) => {
  await installSupabaseSession(page);
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

  await page.goto("/");
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

  await page.goto("/");
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
  await page.goto("/");
  await expect(page.locator("#cancelDesignButton")).toBeDisabled();

  await page.locator("#textInput").fill("Draft Change");
  await expect(page.locator("#cancelDesignButton")).toBeEnabled();

  await page.locator("#cancelDesignButton").click();
  await expect(page.locator("#textInput")).toHaveValue("Saved Shared");
  await expect(page.locator("#cancelDesignButton")).toBeDisabled();
});

test("does not re-autosave immediately after a successful manual save merges revision metadata", async ({ page }) => {
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

  await page.goto("/");
  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => productionBatchSavePayloads.length).toBe(1);
  await page.waitForTimeout(500);
  await expect.poll(() => productionBatchSavePayloads.length).toBe(1);
});

test("save confirmation renders as a floating toast without entering the editor layout", async ({ page }) => {
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

  await page.goto("/");
  await page.locator("#textInput").fill("Remote Shared Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator("#importStatus")).toContainText("Production batch saved");
  await expectWorkflowAlertFloatingToast(page);
});

