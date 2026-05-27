import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

function installSupabaseSession(page) {
  return page.addInitScript(({ providedSession }) => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    window.__TFU_TEST_SHARED_QUEUE_ACCESS_TOKEN__ = providedSession.access_token;
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

test("shows a recovery banner when a newer shared revision already exists", async ({ page }) => {
  await installSupabaseSession(page);
  const remoteSnapshot = {
    queue: {
      id: "queue-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-05-26T15:30:00.000Z",
      updatedBy: {
        name: "Avery",
        email: "avery@example.com",
      },
    },
    activeOrderId: "remote-order-1",
    orders: [
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
  const sharedQueueSavePayloads = [];

  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: {
          id: "queue-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/shared-queue", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    sharedQueueSavePayloads.push(route.request().postDataJSON()?.snapshot);
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

  await expect.poll(() => sharedQueueSavePayloads.length).toBe(1);
  await expect(page.locator("#sharedQueueBanner")).toContainText("Another browser or user updated this design first.");
  await expect(page.locator("#sharedQueueBanner")).toContainText("Last updated by Avery");

  await page.reload();

  await expect(page.locator("#sharedQueueBanner")).toContainText("Local recovery draft available");
  await page.reload();
  await expect(page.locator("#sharedQueueBanner")).toContainText("Local recovery draft available");
  await page.getByRole("button", { name: "Review Local Draft", exact: true }).click();
  await expect(page.locator("#textInput")).toHaveValue("Remote Shared Updated");
  await expect(page.locator("#sharedQueueBanner")).toContainText("Review this local draft");
  await expect(page.locator("#sharedQueueBanner")).not.toContainText("Shared queue connected");
});

test("does not re-autosave immediately after a successful manual save merges revision metadata", async ({ page }) => {
  await installSupabaseSession(page);
  const remoteSnapshot = {
    queue: {
      id: "queue-1",
      workspaceId: "workspace-1",
    },
    activeOrderId: "remote-order-1",
    orders: [
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
  const sharedQueueSavePayloads = [];

  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: {
          id: "queue-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });
  await page.route("**/api/shared-queue", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    const requestSnapshot = route.request().postDataJSON()?.snapshot;
    sharedQueueSavePayloads.push(requestSnapshot);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        ...requestSnapshot,
        orders: requestSnapshot.orders.map((order) => ({
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

  await expect.poll(() => sharedQueueSavePayloads.length).toBe(1);
  await page.waitForTimeout(500);
  await expect.poll(() => sharedQueueSavePayloads.length).toBe(1);
});

test("does not show recovery UI for ordinary mirrored local cache", async ({ page }) => {
  await installSupabaseSession(page);
  const localSnapshot = {
    version: 1,
    orderSequence: 2,
    queue: {
      id: "queue-1",
      workspaceId: "workspace-1",
    },
    activeOrderId: "remote-order-1",
    orders: [
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
  const remoteSnapshot = {
    queue: {
      id: "queue-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-05-26T15:30:00.000Z",
      updatedBy: {
        name: "Avery",
        email: "avery@example.com",
      },
    },
    activeOrderId: "remote-order-1",
    orders: [
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

  await page.addInitScript(({ storageKey, snapshot }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, {
    storageKey: "thankfulforyou.designQueue",
    snapshot: localSnapshot,
  });
  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: {
          id: "queue-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });

  await page.goto("/");

  await expect(page.locator("#sharedQueueBanner")).toContainText("Shared queue connected");
  await expect(page.locator("#sharedQueueBanner")).not.toContainText("Local recovery draft available");
  await expect(page.getByRole("button", { name: "Review Local Draft", exact: true })).toHaveCount(0);
});

test("does not show recovery UI for a stale recovery marker from another shared queue", async ({ page }) => {
  await installSupabaseSession(page);
  const localSnapshot = {
    version: 1,
    orderSequence: 2,
    queue: {
      id: "queue-999",
      workspaceId: "workspace-999",
    },
    recoveryDraftMeta: {
      reason: "shared-queue-conflict",
      preservedAt: "2026-05-26T15:50:00.000Z",
      conflictOrderId: "remote-order-1",
      queueId: "queue-999",
      workspaceId: "workspace-999",
    },
    activeOrderId: "remote-order-1",
    orders: [
      {
        id: "remote-order-1",
        revision: 4,
        text: "Recovered Draft",
        status: "in-progress",
        settings: {
          text: "Recovered Draft",
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
  const remoteSnapshot = {
    queue: {
      id: "queue-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-05-26T15:30:00.000Z",
      updatedBy: {
        name: "Avery",
        email: "avery@example.com",
      },
    },
    activeOrderId: "remote-order-1",
    orders: [
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

  await page.addInitScript(({ storageKey, snapshot }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, {
    storageKey: "thankfulforyou.designQueue",
    snapshot: localSnapshot,
  });
  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: {
          id: "queue-1",
          workspaceId: "workspace-1",
        },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(remoteSnapshot),
    });
  });

  await page.goto("/");

  await expect(page.locator("#textInput")).toHaveValue("Remote Shared");
  await expect(page.locator("#sharedQueueBanner")).toContainText("Shared queue connected");
  await expect(page.locator("#sharedQueueBanner")).not.toContainText("Local recovery draft available");
  await expect(page.getByRole("button", { name: "Review Local Draft", exact: true })).toHaveCount(0);
});
