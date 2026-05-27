# Shared Queue Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current browser-local-first queue persistence flow with a Supabase-backed shared queue so authorized users can open the same design queue across browsers and locations.

**Architecture:** Keep the geometry and editor behavior intact while extracting queue persistence into focused shared-queue modules. Introduce a pure shared-queue model layer first, then a Supabase-backed API layer with revision checks, then browser auth/bootstrap and `src/app.js` integration so the UI becomes remote-first while keeping local storage only as a recovery cache.

**Tech Stack:** Vanilla ES modules, Supabase (`@supabase/supabase-js`), Vitest, Playwright, Node HTTP dev server, server API routes in `api/`

---

## File Structure

- Create: `src/shared-queue-model.js`
- Create: `src/shared-queue-api.js`
- Create: `src/auth-session.js`
- Create: `api/_lib/supabase-admin.js`
- Create: `api/_lib/shared-queue-store.js`
- Create: `api/shared-session.js`
- Create: `api/shared-queue.js`
- Create: `tests/unit/shared-queue-model.test.js`
- Create: `tests/unit/shared-queue-api.test.js`
- Create: `tests/unit/shared-session-api.test.js`
- Create: `tests/unit/shared-queue-api-route.test.js`
- Create: `tests/e2e/shared-queue-sync.spec.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/app.js`
- Modify: `src/queue-sync.js`
- Modify: `src/queue-sync-status.js`
- Modify: `tests/unit/queue-sync.test.js`
- Modify: `tests/e2e/preview-layout.spec.js`

### Responsibility Map

- `src/shared-queue-model.js`
  Pure shared-queue helpers for queue/design normalization, revision handling, startup source choice, and local recovery metadata.
- `src/shared-queue-api.js`
  Browser fetch helpers for session bootstrap, queue loading, queue saving, and conflict-aware errors.
- `src/auth-session.js`
  Supabase browser client bootstrap, sign-in state loading, and session event wiring for the app shell.
- `api/_lib/supabase-admin.js`
  Server-side Supabase client creation from environment variables.
- `api/_lib/shared-queue-store.js`
  Server persistence logic for workspace, queue, and design records plus revision-checked writes.
- `api/shared-session.js`
  API endpoint that returns the authenticated operator and current shared workspace/queue context.
- `api/shared-queue.js`
  API endpoint for remote-first queue load/save against the shared store.
- `src/app.js`
  Remote-first queue bootstrap, shared save flow, recovery prompts, status text, and edit conflict handling.
- `src/queue-sync.js` and `src/queue-sync-status.js`
  Shared queue startup/save decision helpers and user-facing sync status language.
- Test files
  Unit coverage for pure helpers and APIs plus Playwright verification for cross-browser/session handoff.

## Task 1: Build pure shared-queue model helpers with TDD

**Files:**
- Create: `src/shared-queue-model.js`
- Create: `tests/unit/shared-queue-model.test.js`
- Modify: `tests/unit/queue-sync.test.js`

- [ ] **Step 1: Write the failing unit tests for remote-first queue selection, revision helpers, and recovery detection**

```javascript
import { describe, expect, it } from "vitest";

import {
  chooseSharedQueueStartupState,
  createSharedQueueSnapshot,
  getNextRevision,
  hasRecoverableLocalDraft,
} from "../../src/shared-queue-model.js";

describe("shared queue model", () => {
  it("prefers the remote queue when it exists", () => {
    const remoteSnapshot = {
      queue: { id: "queue-1", workspaceId: "workspace-1", updatedAt: "2026-05-26T21:00:00.000Z" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 3 }],
    };
    const localCache = {
      queue: { id: "queue-1", workspaceId: "workspace-1", updatedAt: "2026-05-26T20:00:00.000Z" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseSharedQueueStartupState({
      remoteSnapshot,
      localCache,
    })).toEqual({
      source: "remote",
      snapshot: remoteSnapshot,
      recoveryDraft: localCache,
    });
  });

  it("falls back to local cache only when no remote queue exists", () => {
    const localCache = {
      queue: { id: "queue-1", workspaceId: "workspace-1", updatedAt: "2026-05-26T20:00:00.000Z" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 2 }],
    };

    expect(chooseSharedQueueStartupState({
      remoteSnapshot: null,
      localCache,
    })).toEqual({
      source: "local-cache",
      snapshot: localCache,
      recoveryDraft: null,
    });
  });

  it("increments revisions from the current design revision", () => {
    expect(getNextRevision(null)).toBe(1);
    expect(getNextRevision({ revision: 4 })).toBe(5);
  });

  it("flags a local draft as recoverable when it is newer than the remote design revision", () => {
    expect(hasRecoverableLocalDraft({
      remoteOrder: { id: "order-1", revision: 2 },
      localOrder: { id: "order-1", revision: 3 },
    })).toBe(true);
  });

  it("builds a shared queue snapshot with queue metadata and orders", () => {
    expect(createSharedQueueSnapshot({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 1 }],
    })).toEqual({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 1 }],
    });
  });
});
```

- [ ] **Step 2: Run the focused unit tests and verify they fail for the missing shared-queue module**

Run: `npx vitest run tests/unit/shared-queue-model.test.js tests/unit/queue-sync.test.js`

Expected: `FAIL` with an import error for `src/shared-queue-model.js`

- [ ] **Step 3: Write the minimal shared-queue model implementation and align queue-sync helpers to it**

```javascript
function isSnapshotEmpty(snapshot) {
  return !snapshot || !Array.isArray(snapshot.orders) || snapshot.orders.length === 0;
}

export function createSharedQueueSnapshot({ queue, activeOrderId, orders }) {
  return {
    queue: queue || null,
    activeOrderId: activeOrderId || null,
    orders: Array.isArray(orders) ? orders : [],
  };
}

export function getNextRevision(order) {
  const current = Number.isFinite(Number(order?.revision)) ? Number(order.revision) : 0;
  return current + 1;
}

export function hasRecoverableLocalDraft({ remoteOrder, localOrder }) {
  if (!remoteOrder || !localOrder || remoteOrder.id !== localOrder.id) {
    return false;
  }

  return getNextRevision(remoteOrder) <= Number(localOrder.revision || 0);
}

export function chooseSharedQueueStartupState({ remoteSnapshot, localCache }) {
  if (!isSnapshotEmpty(remoteSnapshot)) {
    return {
      source: "remote",
      snapshot: remoteSnapshot,
      recoveryDraft: isSnapshotEmpty(localCache) ? null : localCache,
    };
  }

  if (!isSnapshotEmpty(localCache)) {
    return {
      source: "local-cache",
      snapshot: localCache,
      recoveryDraft: null,
    };
  }

  return {
    source: null,
    snapshot: null,
    recoveryDraft: null,
  };
}
```

```javascript
import {
  chooseSharedQueueStartupState,
  createSharedQueueSnapshot,
} from "./shared-queue-model.js";

export function buildRemoteQueuePayload(snapshot) {
  return {
    queueId: snapshot?.queue?.id || null,
    snapshot: createSharedQueueSnapshot(snapshot),
  };
}

export function chooseInitialQueueSnapshot({ localSnapshot, remoteSnapshot }) {
  const result = chooseSharedQueueStartupState({
    remoteSnapshot,
    localCache: localSnapshot,
  });

  return {
    source: result.source === "local-cache" ? "local" : result.source,
    snapshot: result.snapshot,
  };
}
```

- [ ] **Step 4: Run the focused unit tests and verify they pass**

Run: `npx vitest run tests/unit/shared-queue-model.test.js tests/unit/queue-sync.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/shared-queue-model.js src/queue-sync.js tests/unit/shared-queue-model.test.js tests/unit/queue-sync.test.js
git commit -m "feat: add shared queue model helpers"
```

## Task 2: Add server-side Supabase shared queue persistence with revision checks

**Files:**
- Modify: `package.json`
- Create: `api/_lib/supabase-admin.js`
- Create: `api/_lib/shared-queue-store.js`
- Create: `api/shared-queue.js`
- Create: `tests/unit/shared-queue-api-route.test.js`

- [ ] **Step 1: Write failing API-route tests for queue load, save, and stale revision rejection**

```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSharedQueueMock = vi.fn();
const saveSharedQueueMock = vi.fn();

vi.mock("../../api/_lib/shared-queue-store.js", () => ({
  loadSharedQueue: loadSharedQueueMock,
  saveSharedQueue: saveSharedQueueMock,
}));

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  loadSharedQueueMock.mockReset();
  saveSharedQueueMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared queue api route", () => {
  it("returns a shared queue snapshot for a valid GET request", async () => {
    loadSharedQueueMock.mockResolvedValue({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 3 }],
    });

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "GET",
      query: { queueId: "queue-1" },
      auth: { userId: "user-1", workspaceId: "workspace-1" },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.queue.id).toBe("queue-1");
  });

  it("rejects PUT requests without queue metadata", async () => {
    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      auth: { userId: "user-1", workspaceId: "workspace-1" },
      body: {
        snapshot: { activeOrderId: null, orders: [] },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "snapshot.queue.id and snapshot.queue.workspaceId are required." });
  });

  it("returns 409 when a stale revision save is rejected", async () => {
    saveSharedQueueMock.mockRejectedValue(Object.assign(new Error("Revision conflict"), {
      code: "REVISION_CONFLICT",
      details: { orderId: "order-1" },
    }));

    const { default: handler } = await import("../../api/shared-queue.js");
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      auth: { userId: "user-1", workspaceId: "workspace-1" },
      body: {
        snapshot: {
          queue: { id: "queue-1", workspaceId: "workspace-1" },
          activeOrderId: "order-1",
          orders: [{ id: "order-1", revision: 2 }],
        },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe("Revision conflict");
  });
});
```

- [ ] **Step 2: Run the focused unit tests and verify they fail because the route and store do not exist**

Run: `npx vitest run tests/unit/shared-queue-api-route.test.js`

Expected: `FAIL`

- [ ] **Step 3: Add Supabase dependency, server client creation, shared queue store, and route handler**

```json
{
  "dependencies": {
    "@neondatabase/serverless": "^1.1.0",
    "@supabase/supabase-js": "^2.49.8",
    "a11y-dialog": "^8.1.5"
  }
}
```

```javascript
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

```javascript
import { createSupabaseAdminClient } from "./supabase-admin.js";

function normalizeSnapshotRow(row) {
  return {
    queue: row.queue_json,
    activeOrderId: row.active_order_id,
    orders: row.orders_json,
  };
}

export async function loadSharedQueue({ queueId, workspaceId }) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("design_queues")
    .select("queue_json, active_order_id, orders_json")
    .eq("id", queueId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error) {
    throw error;
  }

  return data ? normalizeSnapshotRow(data) : null;
}

export async function saveSharedQueue({ snapshot, userId }) {
  const supabase = createSupabaseAdminClient();
  const revisions = snapshot.orders.map((order) => ({
    id: order.id,
    revision: order.revision,
  }));

  const { data, error } = await supabase.rpc("save_design_queue_snapshot", {
    p_queue_id: snapshot.queue.id,
    p_workspace_id: snapshot.queue.workspaceId,
    p_active_order_id: snapshot.activeOrderId,
    p_orders_json: snapshot.orders,
    p_revisions_json: revisions,
    p_updated_by: userId,
  });

  if (error?.code === "P0001" && /revision conflict/i.test(error.message)) {
    throw Object.assign(new Error("Revision conflict"), {
      code: "REVISION_CONFLICT",
      details: error.details || null,
    });
  }

  if (error) {
    throw error;
  }

  return data;
}
```

```javascript
import { loadSharedQueue, saveSharedQueue } from "./_lib/shared-queue-store.js";

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

export default async function handler(req, res) {
  try {
    if (!req.auth?.workspaceId || !req.auth?.userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (req.method === "GET") {
      const queueId = typeof req.query?.queueId === "string" ? req.query.queueId.trim() : "";
      if (!queueId) {
        res.status(400).json({ error: "queueId is required." });
        return;
      }

      const snapshot = await loadSharedQueue({
        queueId,
        workspaceId: req.auth.workspaceId,
      });

      if (!snapshot) {
        res.status(404).json({ error: "Shared queue not found." });
        return;
      }

      res.status(200).json(snapshot);
      return;
    }

    if (req.method === "PUT") {
      const { snapshot } = readJsonBody(req);
      if (!snapshot?.queue?.id || !snapshot?.queue?.workspaceId) {
        res.status(400).json({ error: "snapshot.queue.id and snapshot.queue.workspaceId are required." });
        return;
      }

      const saved = await saveSharedQueue({
        snapshot,
        userId: req.auth.userId,
      });

      res.status(200).json(saved);
      return;
    }

    res.setHeader("Allow", "GET, PUT");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      res.status(409).json({
        error: error.message,
        details: error.details || null,
      });
      return;
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected shared queue error.",
    });
  }
}
```

- [ ] **Step 4: Run the focused unit tests and verify they pass**

Run: `npx vitest run tests/unit/shared-queue-api-route.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json api/_lib/supabase-admin.js api/_lib/shared-queue-store.js api/shared-queue.js tests/unit/shared-queue-api-route.test.js
git commit -m "feat: add shared queue supabase api"
```

## Task 3: Add session bootstrap and browser API helpers with TDD

**Files:**
- Create: `src/shared-queue-api.js`
- Create: `src/auth-session.js`
- Create: `api/shared-session.js`
- Create: `tests/unit/shared-queue-api.test.js`
- Create: `tests/unit/shared-session-api.test.js`

- [ ] **Step 1: Write failing tests for browser API helpers and session bootstrap route**

```javascript
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("shared queue api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a shared queue by queue id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        queue: { id: "queue-1", workspaceId: "workspace-1" },
        activeOrderId: "order-1",
        orders: [{ id: "order-1", revision: 1 }],
      }),
    }));

    const { fetchSharedQueueSnapshot } = await import("../../src/shared-queue-api.js");
    const result = await fetchSharedQueueSnapshot("queue-1");

    expect(result.queue.id).toBe("queue-1");
    expect(fetch).toHaveBeenCalledWith("/api/shared-queue?queueId=queue-1", expect.any(Object));
  });

  it("throws a revision conflict error for 409 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Revision conflict", details: { orderId: "order-1" } }),
    }));

    const { saveSharedQueueSnapshot } = await import("../../src/shared-queue-api.js");

    await expect(saveSharedQueueSnapshot({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "order-1",
      orders: [{ id: "order-1", revision: 1 }],
    })).rejects.toMatchObject({
      name: "SharedQueueConflictError",
      details: { orderId: "order-1" },
    });
  });
});
```

```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionContextMock = vi.fn();

vi.mock("../../api/_lib/shared-queue-store.js", () => ({
  getSessionContext: getSessionContextMock,
}));

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  getSessionContextMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared session api", () => {
  it("returns the current operator and shared workspace context", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: "user-1", email: "mark@example.com" },
      workspace: { id: "workspace-1", name: "Thankful For You" },
      queue: { id: "queue-1", workspaceId: "workspace-1" },
    });

    const { default: handler } = await import("../../api/shared-session.js");
    const response = createResponseRecorder();

    await handler({ method: "GET", auth: { userId: "user-1", workspaceId: "workspace-1" } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.workspace.id).toBe("workspace-1");
  });
});
```

- [ ] **Step 2: Run the focused unit tests and verify they fail because the browser API and session route do not exist**

Run: `npx vitest run tests/unit/shared-queue-api.test.js tests/unit/shared-session-api.test.js`

Expected: `FAIL`

- [ ] **Step 3: Implement the shared queue API client, session route, and auth bootstrap helper**

```javascript
export class SharedQueueConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SharedQueueConflictError";
    this.details = details;
  }
}

async function readJsonOrFallback(response, fallback) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function fetchSharedSession() {
  const response = await fetch("/api/shared-session", {
    headers: { Accept: "application/json" },
  });

  const payload = await readJsonOrFallback(response, {});
  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the shared queue session.");
  }
  return payload;
}

export async function fetchSharedQueueSnapshot(queueId) {
  const response = await fetch(`/api/shared-queue?queueId=${encodeURIComponent(queueId)}`, {
    headers: { Accept: "application/json" },
  });

  const payload = await readJsonOrFallback(response, {});
  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the shared queue.");
  }
  return payload;
}

export async function saveSharedQueueSnapshot(snapshot) {
  const response = await fetch("/api/shared-queue", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ snapshot }),
  });

  const payload = await readJsonOrFallback(response, {});
  if (response.status === 409) {
    throw new SharedQueueConflictError(payload.error || "Revision conflict", payload.details || null);
  }
  if (!response.ok) {
    throw new Error(payload.error || "Unable to save the shared queue.");
  }
  return payload;
}
```

```javascript
import { createClient } from "@supabase/supabase-js";

let browserSupabaseClient = null;

export function getBrowserSupabaseClient() {
  if (browserSupabaseClient) {
    return browserSupabaseClient;
  }

  const url = window.__APP_CONFIG__?.supabaseUrl;
  const anonKey = window.__APP_CONFIG__?.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error("Supabase browser config is missing.");
  }

  browserSupabaseClient = createClient(url, anonKey);
  return browserSupabaseClient;
}

export async function getSignedInSession() {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}
```

```javascript
import { getSessionContext } from "./_lib/shared-queue-store.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    if (!req.auth?.workspaceId || !req.auth?.userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const context = await getSessionContext(req.auth);
    res.status(200).json(context);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected shared session error.",
    });
  }
}
```

- [ ] **Step 4: Run the focused unit tests and verify they pass**

Run: `npx vitest run tests/unit/shared-queue-api.test.js tests/unit/shared-session-api.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/shared-queue-api.js src/auth-session.js api/shared-session.js tests/unit/shared-queue-api.test.js tests/unit/shared-session-api.test.js
git commit -m "feat: add shared queue session bootstrap"
```

## Task 4: Integrate remote-first shared queue loading and saving into the app

**Files:**
- Modify: `src/app.js`
- Modify: `src/queue-sync-status.js`
- Modify: `tests/e2e/preview-layout.spec.js`

- [ ] **Step 1: Write the failing browser test for remote-first restore over stale local cache**

```javascript
test("restores the shared queue from the backend before stale local cache", async ({ page }) => {
  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: { id: "queue-1", workspaceId: "workspace-1" },
      }),
    });
  });

  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue: { id: "queue-1", workspaceId: "workspace-1" },
        activeOrderId: "remote-1",
        orders: [{ id: "remote-1", text: "Remote Queue Design", revision: 3, status: "in-progress", settings: { lines: [] } }],
      }),
    });
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("thankfulforyou.designQueue", JSON.stringify({
      queue: { id: "queue-1", workspaceId: "workspace-1" },
      activeOrderId: "local-1",
      orders: [{ id: "local-1", text: "Old Browser Cache", revision: 1, status: "in-progress", settings: { lines: [] } }],
    }));
  });

  await page.goto("/");

  await expect(page.getByText("Remote Queue Design")).toBeVisible();
  await expect(page.getByText("Old Browser Cache")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails with the current local-first queue boot**

Run: `npx playwright test tests/e2e/preview-layout.spec.js -g "restores the shared queue from the backend before stale local cache"`

Expected: `FAIL`

- [ ] **Step 3: Refactor `src/app.js` to bootstrap session context first, load the shared queue remotely, and keep local storage only as recovery cache**

```javascript
import {
  fetchSharedQueueSnapshot,
  fetchSharedSession,
  saveSharedQueueSnapshot,
  SharedQueueConflictError,
} from "./shared-queue-api.js";
import {
  chooseSharedQueueStartupState,
  createSharedQueueSnapshot,
} from "./shared-queue-model.js";

let sharedSession = null;
let activeSharedQueue = null;
let pendingRecoveryDraft = null;

async function restoreInitialQueueState() {
  const localSnapshot = readPersistedQueueState();
  sharedSession = await fetchSharedSession();

  let remoteSnapshot = null;
  if (sharedSession?.queue?.id) {
    remoteSnapshot = await fetchSharedQueueSnapshot(sharedSession.queue.id);
  }

  const startup = chooseSharedQueueStartupState({
    remoteSnapshot,
    localCache: localSnapshot,
  });

  pendingRecoveryDraft = startup.recoveryDraft;
  activeSharedQueue = startup.snapshot?.queue || sharedSession?.queue || null;

  if (!startup.snapshot || !applyPersistedQueueState(startup.snapshot)) {
    updateQueueSyncStatus("empty");
    return { source: null, count: 0 };
  }

  suppressQueueSyncLocalNotice = true;
  persistQueueState();
  suppressQueueSyncLocalNotice = false;

  updateQueueSyncStatus(startup.source === "remote" ? "restored-remote" : "restored-local", {
    count: orders.length,
  });

  if (pendingRecoveryDraft) {
    updateWorkflowAlert("A newer local recovery draft is available for review.", "pending");
  }

  return {
    source: startup.source,
    count: orders.length,
  };
}

async function saveQueueSnapshotToRemote(options = {}) {
  const snapshot = createSharedQueueSnapshot({
    queue: activeSharedQueue,
    activeOrderId,
    orders: buildPersistedQueueState().orders,
  });

  const saved = await saveSharedQueueSnapshot(snapshot);
  activeSharedQueue = saved.queue;
  updateQueueSyncStatus("saved-remote", { count: snapshot.orders.length });
}
```

```javascript
export function buildQueueSyncStatus(kind, options = {}) {
  const count = Number.isFinite(Number(options.count)) ? Number(options.count) : 0;

  switch (kind) {
    case "restored-remote":
      return {
        tone: "ok",
        label: "Shared queue loaded",
        detail: `${count} design${count === 1 ? "" : "s"} loaded from the shared queue.`,
      };
    case "saved-remote":
      return {
        tone: "ok",
        label: "Shared queue saved",
        detail: `${count} design${count === 1 ? "" : "s"} synced to the shared queue.`,
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the focused browser test and the queue sync unit test**

Run: `npx playwright test tests/e2e/preview-layout.spec.js -g "restores the shared queue from the backend before stale local cache"`

Expected: `PASS`

Run: `npx vitest run tests/unit/queue-sync.test.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add src/app.js src/queue-sync-status.js tests/e2e/preview-layout.spec.js tests/unit/queue-sync.test.js
git commit -m "feat: make queue restore remote first"
```

## Task 5: Add revision-conflict handling, recovery prompts, and audit context

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `tests/e2e/shared-queue-sync.spec.js`

- [ ] **Step 1: Write the failing browser test for conflict handling when another session has already saved a newer revision**

```javascript
import { expect, test } from "@playwright/test";

test("shows a shared queue conflict message when a stale save is rejected", async ({ page }) => {
  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: { id: "queue-1", workspaceId: "workspace-1" },
      }),
    });
  });

  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue: { id: "queue-1", workspaceId: "workspace-1" },
        activeOrderId: "order-1",
        orders: [{ id: "order-1", text: "Morgan", revision: 2, status: "in-progress", settings: { lines: [] } }],
      }),
    });
  });

  await page.route("**/api/shared-queue", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Revision conflict",
        details: { orderId: "order-1", updatedBy: "warehouse@example.com" },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Another browser or user updated this design first.")).toBeVisible();
});
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails because conflict messaging is not rendered**

Run: `npx playwright test tests/e2e/shared-queue-sync.spec.js -g "shows a shared queue conflict message when a stale save is rejected"`

Expected: `FAIL`

- [ ] **Step 3: Add conflict-aware UI state, recovery messaging, and last-updated metadata rendering**

```html
<div id="sharedQueueBanner" class="shared-queue-banner" hidden>
  <p id="sharedQueueBannerLabel" class="shared-queue-banner-label"></p>
  <p id="sharedQueueBannerDetail" class="shared-queue-banner-detail"></p>
</div>

<p id="activeOrderAuditMeta" class="active-order-audit-meta" aria-live="polite"></p>
```

```javascript
function renderActiveOrderAuditMeta(order) {
  if (!order?.updatedAt || !order?.updatedBy) {
    activeOrderAuditMeta.textContent = "";
    return;
  }

  activeOrderAuditMeta.textContent = `Last updated by ${order.updatedBy} at ${new Date(order.updatedAt).toLocaleString()}`;
}

function showSharedQueueBanner(label, detail, tone = "warning") {
  sharedQueueBanner.hidden = false;
  sharedQueueBanner.dataset.tone = tone;
  sharedQueueBannerLabel.textContent = label;
  sharedQueueBannerDetail.textContent = detail;
}

async function saveQueueSnapshotToRemote(options = {}) {
  try {
    const saved = await saveSharedQueueSnapshot(buildSharedQueueSnapshotForSave());
    mergeSavedQueueMetadata(saved);
  } catch (error) {
    if (error instanceof SharedQueueConflictError) {
      showSharedQueueBanner(
        "Shared queue update blocked",
        "Another browser or user updated this design first.",
        "warning",
      );
      updateWorkflowAlert("Save blocked by a newer shared queue revision.", "error");
      return;
    }

    throw error;
  }
}
```

```css
.shared-queue-banner {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #d9b24c;
  background: #fff8df;
  color: #6f5312;
}

.active-order-audit-meta {
  margin: 0;
  font-size: 12px;
  color: var(--muted-text);
}
```

- [ ] **Step 4: Run the targeted browser verification**

Run: `npx playwright test tests/e2e/shared-queue-sync.spec.js`

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/app.js tests/e2e/shared-queue-sync.spec.js
git commit -m "feat: add shared queue conflict handling"
```

## Task 6: Add setup docs, environment guidance, and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/requirements.md`

- [ ] **Step 1: Add setup documentation for Supabase environment variables, required tables/RPC, and local auth expectations**

```md
## Shared Queue Setup

Set these environment variables for local and hosted environments:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The shared queue rollout requires:

- a `workspaces` table
- a `design_queues` table
- a `workspace_memberships` table
- a `save_design_queue_snapshot` RPC or equivalent transactional save path that rejects stale design revisions

For local development, authenticate with a real Supabase user that belongs to the target workspace before verifying shared queue behavior across browsers.
```

- [ ] **Step 2: Run the full verification set**

Run: `npm run test:unit`

Expected: `PASS`

Run: `npx playwright test tests/e2e/shared-queue-sync.spec.js tests/e2e/preview-layout.spec.js`

Expected: `PASS`

- [ ] **Step 3: Commit**

```bash
git add README.md docs/requirements.md
git commit -m "docs: add shared queue setup notes"
```

## Self-Review

### Spec coverage

- Supabase as the first backend choice: covered by Tasks 2 and 6
- Shared workspace queue ownership instead of per-user ownership: covered by Tasks 2, 3, and 6
- Remote-first queue loading: covered by Tasks 1 and 4
- Local storage as recovery/cache only: covered by Tasks 1 and 4
- Revision-based stale-write protection: covered by Tasks 2 and 5
- Safe multi-browser handoff and audit context: covered by Tasks 4 and 5

### Placeholder scan

- No `TBD`, `TODO`, or vague “handle appropriately” steps remain
- Every task names exact files and concrete commands
- Code-changing steps include concrete code to anchor implementation

### Type consistency

- Shared queue terms remain consistent across tasks: `queue`, `workspaceId`, `revision`, `updatedAt`, `updatedBy`
- Browser API helper names stay consistent:
  `fetchSharedSession`
  `fetchSharedQueueSnapshot`
  `saveSharedQueueSnapshot`
  `SharedQueueConflictError`
- Server-side store names stay consistent:
  `loadSharedQueue`
  `saveSharedQueue`
  `getSessionContext`
