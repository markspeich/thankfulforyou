# Shared Queue Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production Supabase operator authentication and server-side shared-queue authorization so shared queue access works across browsers with invite-only email/password sign-in and no local-only fallback.

**Architecture:** Extend the existing shared-queue flow rather than replacing it. The browser will own Supabase session state, shared queue API requests will attach bearer tokens, and the server will verify those tokens and resolve workspace membership into `req.auth` before existing shared queue handlers run.

**Tech Stack:** Vanilla JS frontend, Node HTTP dev server, Supabase Auth, Supabase admin client, Vitest, Playwright

---

## File Map

- `src/auth-session.js`
  Browser Supabase client helpers, sign-in/sign-out helpers, access-token lookup, and auth-state subscription.
- `src/shared-queue-api.js`
  Shared queue fetch helpers that attach the current bearer token and surface auth failures clearly.
- `src/app.js`
  Startup auth gating, blocked-config state, sign-in UI wiring, expired-session handling, and shared queue resume behavior.
- `index.html`
  Minimal operator sign-in shell and configuration-error surface.
- `src/styles.css`
  Practical styling for the auth/config state without disturbing the production workspace layout.
- `api/_lib/shared-queue-auth.js`
  New helper to extract bearer tokens, verify Supabase users, resolve workspace membership, and build `req.auth`.
- `api/_lib/shared-queue-store.js`
  Small support changes if needed for deterministic workspace selection and operator lookup.
- `api/shared-session.js`
  Wrap the existing handler with verified auth resolution.
- `api/shared-queue.js`
  Wrap the existing handler with verified auth resolution.
- `tools/dev_server.mjs`
  Local route shim for shared-session/shared-queue handlers so the browser can hit real auth-aware API code during local development.
- `tests/unit/shared-queue-api.test.js`
  Extend client-side auth helper and bearer-token request coverage.
- `tests/unit/shared-queue-auth.test.js`
  New unit coverage for bearer token parsing, Supabase verification, and workspace authorization decisions.
- `tests/unit/shared-session-route.test.js`
  New route-level coverage for `401`, `403`, and happy-path shared session responses.
- `tests/unit/shared-queue-route.test.js`
  New route-level coverage for authenticated shared queue reads and writes.
- `tests/e2e/shared-queue-auth.spec.js`
  New Playwright coverage for config-missing, sign-in-required, and re-auth flows using browser/API mocks.
- `README.md`
  Update operator setup instructions for Supabase auth config and invite-only account provisioning.

### Task 1: Expand browser auth helpers and authenticated shared API requests

**Files:**
- Modify: `src/auth-session.js`
- Modify: `src/shared-queue-api.js`
- Test: `tests/unit/shared-queue-api.test.js`

- [ ] **Step 1: Write the failing auth-helper and bearer-token tests**

```js
it("signs in with email and password through the browser supabase client", async () => {
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: { session: { access_token: "token-1" } },
    error: null,
  });
  createClientMock.mockReturnValue({
    auth: {
      signInWithPassword,
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  });
  vi.stubGlobal("window", {
    __APP_CONFIG__: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    },
  });

  const { signInWithPassword: signIn } = await import("../../src/auth-session.js");

  await expect(signIn("mark@example.com", "secret-pass")).resolves.toEqual({ access_token: "token-1" });
  expect(signInWithPassword).toHaveBeenCalledWith({
    email: "mark@example.com",
    password: "secret-pass",
  });
});

it("attaches the bearer token to shared-session requests", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ operator: { id: "user-1" }, workspace: { id: "workspace-1" }, queue: null }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const { fetchSharedSession } = await import("../../src/shared-queue-api.js");

  await fetchSharedSession("token-1");
  expect(fetchMock).toHaveBeenCalledWith("/api/shared-session", {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer token-1",
    },
  });
});

it("throws an authentication error when shared-session returns 401", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ error: "Authentication required." }),
  }));

  const { fetchSharedSession } = await import("../../src/shared-queue-api.js");

  await expect(fetchSharedSession("expired-token")).rejects.toThrow("Authentication required.");
});
```

- [ ] **Step 2: Run the unit test slice to verify it fails**

Run: `npm run test:unit -- tests/unit/shared-queue-api.test.js`
Expected: FAIL with missing `signInWithPassword` helper and missing `Authorization` header expectations.

- [ ] **Step 3: Implement minimal browser auth and authenticated fetch helpers**

```js
export async function signInWithPassword(email, password) {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  return data.session;
}

export async function signOutBrowserSession() {
  const client = getBrowserSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}

export function subscribeToAuthChanges(onChange) {
  const client = getBrowserSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    onChange(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function getAccessToken() {
  const session = await getSignedInSession();
  return session?.access_token ?? null;
}
```

```js
function buildAuthHeaders(accessToken, extraHeaders = {}) {
  return {
    ...extraHeaders,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export async function fetchSharedSession(accessToken) {
  const response = await fetch("/api/shared-session", {
    headers: buildAuthHeaders(accessToken, {
      Accept: "application/json",
    }),
  });
  const payload = await readJsonOrFallback(response, {});

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the shared queue session.");
  }

  return payload;
}
```

- [ ] **Step 4: Run the same unit test slice to verify it passes**

Run: `npm run test:unit -- tests/unit/shared-queue-api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth-session.js src/shared-queue-api.js tests/unit/shared-queue-api.test.js
git commit -m "feat: add shared queue auth client helpers"
```

### Task 2: Add server-side shared queue auth resolution

**Files:**
- Create: `api/_lib/shared-queue-auth.js`
- Modify: `api/_lib/shared-queue-store.js`
- Create: `tests/unit/shared-queue-auth.test.js`

- [ ] **Step 1: Write the failing server auth helper tests**

```js
it("extracts a bearer token from the authorization header", async () => {
  const { readBearerToken } = await import("../../api/_lib/shared-queue-auth.js");

  expect(readBearerToken({
    headers: { authorization: "Bearer token-1" },
  })).toBe("token-1");
});

it("returns req.auth from a verified user and workspace membership", async () => {
  const getUserMock = vi.fn().mockResolvedValue({
    data: { user: { id: "user-1", email: "mark@example.com" } },
    error: null,
  });
  const membershipQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [{ workspace_id: "workspace-1" }],
      error: null,
    }),
  };
  supabaseFactoryMock.mockReturnValue({
    auth: {
      getUser: getUserMock,
    },
    from: vi.fn(() => membershipQuery),
  });

  const { resolveSharedQueueAuth } = await import("../../api/_lib/shared-queue-auth.js");

  await expect(resolveSharedQueueAuth({
    headers: { authorization: "Bearer token-1" },
  })).resolves.toEqual({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
});

it("throws a 403-style error when the verified user has no workspace membership", async () => {
  supabaseFactoryMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  });

  const { resolveSharedQueueAuth } = await import("../../api/_lib/shared-queue-auth.js");

  await expect(resolveSharedQueueAuth({
    headers: { authorization: "Bearer token-1" },
  })).rejects.toMatchObject({
    statusCode: 403,
    message: "Shared workspace access denied.",
  });
});
```

- [ ] **Step 2: Run the auth-helper test slice to verify it fails**

Run: `npm run test:unit -- tests/unit/shared-queue-auth.test.js`
Expected: FAIL because `api/_lib/shared-queue-auth.js` does not exist yet.

- [ ] **Step 3: Implement the minimal shared queue auth resolver**

```js
import { createSupabaseAdminClient } from "./supabase-admin.js";

function createAuthError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true,
  });
}

export function readBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? "";

  if (!/^Bearer\s+/i.test(header)) {
    return null;
  }

  return header.replace(/^Bearer\s+/i, "").trim() || null;
}

export async function resolveSharedQueueAuth(req) {
  const accessToken = readBearerToken(req);

  if (!accessToken) {
    throw createAuthError(401, "Authentication required.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userData?.user?.id) {
    throw createAuthError(401, "Authentication required.");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw membershipError;
  }

  const workspaceId = memberships?.[0]?.workspace_id ?? null;

  if (!workspaceId) {
    throw createAuthError(403, "Shared workspace access denied.");
  }

  return {
    userId: userData.user.id,
    workspaceId,
  };
}
```

- [ ] **Step 4: Run the auth-helper test slice to verify it passes**

Run: `npm run test:unit -- tests/unit/shared-queue-auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/_lib/shared-queue-auth.js api/_lib/shared-queue-store.js tests/unit/shared-queue-auth.test.js
git commit -m "feat: add shared queue auth resolver"
```

### Task 3: Wrap shared API routes with verified auth

**Files:**
- Modify: `api/shared-session.js`
- Modify: `api/shared-queue.js`
- Create: `tests/unit/shared-session-route.test.js`
- Create: `tests/unit/shared-queue-route.test.js`

- [ ] **Step 1: Write the failing authenticated-route tests**

```js
it("returns 401 from shared-session when auth resolution fails", async () => {
  resolveSharedQueueAuthMock.mockRejectedValueOnce(Object.assign(new Error("Authentication required."), {
    statusCode: 401,
    expose: true,
  }));

  await sharedSessionHandler({
    method: "GET",
    headers: {},
  }, res);

  expect(statusCode).toBe(401);
  expect(jsonPayload).toEqual({ error: "Authentication required." });
});

it("injects req.auth before loading shared queue", async () => {
  resolveSharedQueueAuthMock.mockResolvedValueOnce({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  loadSharedQueueMock.mockResolvedValueOnce({
    queue: { id: "queue-1", workspaceId: "workspace-1" },
    activeOrderId: "order-1",
    orders: [],
  });

  await sharedQueueHandler({
    method: "GET",
    headers: { authorization: "Bearer token-1" },
    query: { queueId: "queue-1" },
  }, res);

  expect(loadSharedQueueMock).toHaveBeenCalledWith({
    queueId: "queue-1",
    workspaceId: "workspace-1",
  });
  expect(statusCode).toBe(200);
});
```

- [ ] **Step 2: Run the route unit test slice to verify it fails**

Run: `npm run test:unit -- tests/unit/shared-session-route.test.js tests/unit/shared-queue-route.test.js`
Expected: FAIL because the routes do not currently call the auth resolver.

- [ ] **Step 3: Implement the auth wrapper in both routes**

```js
import { resolveSharedQueueAuth } from "./_lib/shared-queue-auth.js";
import { getSessionContext } from "./_lib/shared-queue-store.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    req.auth = await resolveSharedQueueAuth(req);
    const context = await getSessionContext(req.auth);
    res.status(200).json(context);
  } catch (error) {
    if (error?.statusCode && error?.expose) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: "Unable to load the shared queue session.",
    });
  }
}
```

- [ ] **Step 4: Run the route unit test slice to verify it passes**

Run: `npm run test:unit -- tests/unit/shared-session-route.test.js tests/unit/shared-queue-route.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/shared-session.js api/shared-queue.js tests/unit/shared-session-route.test.js tests/unit/shared-queue-route.test.js
git commit -m "feat: secure shared queue routes"
```

### Task 4: Add auth-gated startup and sign-in UI to the app shell

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing Playwright auth-state tests**

```js
test("shows an operator sign-in screen when no shared session exists", async ({ page }) => {
  await page.addInitScript(() => {
    window.__APP_CONFIG__ = {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
    };
  });
  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: "Authentication required." }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in to shared queue" })).toBeVisible();
  await expect(page.locator("#workspace")).not.toBeVisible();
});

test("shows a blocked configuration error when Supabase config is missing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Shared queue configuration is missing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});
```

- [ ] **Step 2: Run the e2e auth-state slice to verify it fails**

Run: `npx playwright test tests/e2e/shared-queue-auth.spec.js`
Expected: FAIL because the app still attempts shared queue restore and local recovery without an auth gate.

- [ ] **Step 3: Implement the minimal sign-in/configuration shell in the app**

```html
<section id="sharedQueueAuthGate" class="shared-auth-gate" hidden>
  <div class="shared-auth-card">
    <h1 id="sharedQueueAuthTitle">Sign in to shared queue</h1>
    <p id="sharedQueueAuthMessage">Use your invited operator account to continue.</p>
    <form id="sharedQueueSignInForm">
      <label>
        <span>Email</span>
        <input id="sharedQueueEmail" type="email" autocomplete="username" required />
      </label>
      <label>
        <span>Password</span>
        <input id="sharedQueuePassword" type="password" autocomplete="current-password" required />
      </label>
      <button id="sharedQueueSignInButton" type="submit">Sign In</button>
    </form>
    <p id="sharedQueueAuthError" role="alert" hidden></p>
  </div>
</section>
```

```js
async function bootstrapSharedQueueAccess() {
  let session = null;

  try {
    session = await getSignedInSession();
  } catch (error) {
    showSharedQueueConfigError(error);
    return null;
  }

  if (!session?.access_token) {
    showSharedQueueSignIn();
    return null;
  }

  hideSharedQueueAuthGate();
  return session.access_token;
}
```

- [ ] **Step 4: Run the e2e auth-state slice to verify it passes**

Run: `npx playwright test tests/e2e/shared-queue-auth.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.js src/styles.css tests/e2e/shared-queue-auth.spec.js
git commit -m "feat: add shared queue sign-in gate"
```

### Task 5: Connect authenticated startup, expiry handling, and local dev routing

**Files:**
- Modify: `src/app.js`
- Modify: `tools/dev_server.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing session-expiry and local-dev route tests**

```js
test("pauses shared queue writes and returns to sign-in when the session expires", async ({ page }) => {
  let saveAttemptCount = 0;

  await page.route("**/api/shared-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        operator: { id: "user-1", email: "mark@example.com" },
        workspace: { id: "workspace-1", name: "Thankful For You" },
        queue: { id: "queue-1", workspaceId: "workspace-1" },
      }),
    });
  });
  await page.route("**/api/shared-queue?queueId=queue-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        queue: { id: "queue-1", workspaceId: "workspace-1" },
        activeOrderId: "order-1",
        orders: [{ id: "order-1", revision: 1, text: "Remote Shared", settings: { text: "Remote Shared", lines: [] } }],
      }),
    });
  });
  await page.route("**/api/shared-queue", async (route) => {
    saveAttemptCount += 1;
    await route.fulfill({
      status: 401,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: "Authentication required." }),
    });
  });

  await page.goto("/");
  await page.locator("#textInput").fill("Expired Session");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => saveAttemptCount).toBe(1);
  await expect(page.getByRole("heading", { name: "Sign in to shared queue" })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused auth and shared-queue verification slices to verify failure**

Run: `npm run test:unit -- tests/unit/shared-queue-api.test.js tests/unit/shared-queue-auth.test.js tests/unit/shared-session-route.test.js tests/unit/shared-queue-route.test.js`
Expected: PASS from prior tasks

Run: `npx playwright test tests/e2e/shared-queue-auth.spec.js tests/e2e/shared-queue-sync.spec.js`
Expected: FAIL on expired-session handling and any local dev auth routing assumptions.

- [ ] **Step 3: Implement authenticated startup resume, expiry fallback, and dev routing**

```js
async function fetchAuthenticatedSharedSession() {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("Authentication required.");
  }

  return fetchSharedSession(accessToken);
}

async function saveSharedQueueWithAuth(snapshot, options) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("Authentication required.");
  }

  return saveSharedQueueSnapshot(snapshot, {
    ...options,
    accessToken,
  });
}
```

```js
if (requestUrl.pathname === "/api/shared-session" || requestUrl.pathname === "/api/shared-queue") {
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const body = request.method === "PUT" ? JSON.parse(await readRequestBody(request) || "{}") : undefined;
  const req = {
    method: request.method,
    headers,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    body,
  };
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

  const modulePath = requestUrl.pathname === "/api/shared-session"
    ? "../api/shared-session.js"
    : "../api/shared-queue.js";
  const { default: handler } = await import(modulePath);
  await handler(req, res);
  return;
}
```

- [ ] **Step 4: Run the focused unit and e2e slices to verify they pass**

Run: `npm run test:unit -- tests/unit/shared-queue-api.test.js tests/unit/shared-queue-auth.test.js tests/unit/shared-session-route.test.js tests/unit/shared-queue-route.test.js`
Expected: PASS

Run: `npx playwright test tests/e2e/shared-queue-auth.spec.js tests/e2e/shared-queue-sync.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.js tools/dev_server.mjs README.md tests/e2e/shared-queue-auth.spec.js
git commit -m "feat: wire shared queue auth through startup"
```

## Self-Review

- Spec coverage: this plan covers browser auth, invite-only sign-in surface, authenticated shared API requests, server verification, workspace membership resolution, expired-session handling, and setup docs.
- Placeholder scan: all tasks include exact files, concrete tests, concrete commands, and implementation snippets.
- Type consistency: the plan uses one auth shape throughout: `Authorization: Bearer <token>` in the browser, `resolveSharedQueueAuth(req)` on the server, and `req.auth = { userId, workspaceId }` in the shared queue routes.
