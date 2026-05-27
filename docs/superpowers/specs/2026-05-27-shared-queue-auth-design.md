# Shared Queue Production Auth Design

## Goal

Complete the shared queue production path by adding real operator authentication and server-side authorization so shared queue access works across browsers and locations without anonymous access or local-only fallback.

## Recommendation

Use Supabase Auth as the single session authority for shared queue access.

The browser should authenticate operators with invite-only email-plus-password accounts managed by Supabase Auth. Shared queue API requests should send the current Supabase access token, and the server should verify that token with Supabase before resolving workspace membership and populating `req.auth`.

This is the best fit for the current codebase because the project already has:

- Supabase browser and admin clients
- shared queue API routes that expect `req.auth`
- a shared workspace and queue data model

The missing work is the auth bridge, not a new identity platform.

## Alternatives Considered

### 1. Supabase Auth direct session verification

Pros:

- extends the current shared queue architecture cleanly
- uses one identity system in browser and server code
- keeps workspace authorization on the server
- supports invite-only accounts without extra application auth tables

Cons:

- requires learning Supabase Auth flows and session handling
- needs a small sign-in surface in the app

### 2. Custom application sessions on top of Supabase data

Pros:

- full control over cookies, session lifetime, and auth flow

Cons:

- more server code and more security-sensitive logic
- duplicates capabilities Supabase Auth already provides
- slows delivery without solving a current product problem

### 3. Separate external auth provider

Pros:

- can make sense later if identity requirements outgrow Supabase

Cons:

- adds another platform and another integration surface
- does not help ship the current shared queue production path faster

## Product Rules

- Shared queue access is not anonymous.
- Shared queue access is invite-only.
- Operators sign in with email and password.
- The operator UI should not expose self-service account creation.
- Missing shared queue config is a blocked application state, not a reason to fall back to local-only persistence.
- Expired or revoked sessions should block further shared queue writes until the operator signs in again.

## Architecture

The production auth path should have five pieces.

### 1. Browser auth client

The frontend should use the existing Supabase browser client helper as the source for:

- sign-in with email and password
- sign-out
- current session lookup
- auth state change notifications

The app should rely on the Supabase session already stored in the browser by the client library rather than inventing a parallel local auth format.

### 2. Invite-only sign-in screen

When shared queue mode is enabled but no valid session is present, the app should show a compact operator sign-in state instead of attempting shared queue restore.

That screen should include:

- email field
- password field
- sign-in action
- sign-out state when applicable
- concise "contact admin for access" copy

It should not include:

- sign-up
- passwordless email link flow
- workspace picker in the first pass

### 3. Authenticated shared queue fetches

Requests to:

- `/api/shared-session`
- `/api/shared-queue`

should include `Authorization: Bearer <access-token>` when a session is present.

This keeps browser identity attached to every shared queue read and write without relying on implicit local state in the server.

### 4. Server token verification and auth context injection

Before shared queue handlers run, the server should:

1. Read the bearer token from the request.
2. Verify the token with Supabase.
3. Extract the authenticated user id.
4. Resolve workspace membership for that operator.
5. Attach `req.auth = { userId, workspaceId }`.

If token verification fails, return `401`.

If the user is valid but has no allowed workspace membership, return `403`.

This preserves the existing shared queue route contract while moving trust to server-verified identity.

### 5. Workspace membership resolution

The first pass should derive one active workspace for the authenticated operator from the database membership rows instead of asking the browser to declare it.

If the product later needs multi-workspace switching, that can be added on top of the same verified identity flow. The first version should keep this simple and deterministic.

## Request And Startup Flow

### Startup

1. Read Supabase browser config.
2. If config is missing, show a blocked configuration error state.
3. Read the current browser session.
4. If there is no valid session, show the sign-in state.
5. If a session exists, call `/api/shared-session` with the bearer token.
6. The server verifies the token, resolves workspace membership, and returns the operator, workspace, and queue context.
7. The app loads the shared queue and proceeds with the existing remote-first restore path.

### Shared queue read or save

1. Read the current access token from the active browser session.
2. Send it in the `Authorization` header.
3. Verify the token in the server bridge.
4. Resolve `req.auth`.
5. Run the existing shared queue load or save handler.

### Session expiry

1. A shared queue request fails because the session is invalid or expired.
2. The app pauses shared autosave.
3. The UI makes the signed-out or expired-session state visible.
4. The operator signs in again.
5. Shared queue reads and writes resume with the renewed session.

## Error Handling

- Missing Supabase browser config should produce a clear blocked configuration state.
- Invalid credentials should show a direct sign-in error without exposing internal Supabase details.
- Missing or invalid bearer tokens should return `401 Authentication required`.
- Valid operators without workspace membership should return `403 Shared workspace access denied`.
- If the auth bridge fails unexpectedly, shared queue routes should fail closed rather than allowing anonymous reads or writes.
- If sign-in state changes while autosave is pending, the app should stop write attempts until a valid session is restored.

## Testing Strategy

Add coverage for:

- browser sign-in state rendering when no session exists
- blocked configuration state when required Supabase config is missing
- bearer token attachment on shared queue API requests
- server token verification success and failure
- workspace membership resolution and `403` denial behavior
- shared queue startup after successful sign-in
- autosave pause and re-auth requirement after expired-session failures

Automated tests can continue using mocks for Supabase session behavior and API responses. Live Supabase smoke testing can remain a separate manual verification path once credentials and invite-only operator accounts are available.

## Rollout Plan

1. Add frontend auth helpers for email/password sign-in, sign-out, and access-token retrieval.
2. Add a minimal sign-in/configuration-error UI state in the app shell.
3. Attach bearer tokens to shared queue API requests.
4. Add server-side token verification and workspace-membership resolution helpers.
5. Inject `req.auth` for shared queue routes before existing handlers run.
6. Add unit and Playwright coverage for sign-in, auth failure, and authenticated shared queue flows.
7. Document required Supabase configuration and invite-only account setup for local and hosted environments.

## Assumptions

- The first production operator auth flow should use Supabase Auth email-plus-password sign-in.
- Operator account creation is invite-only and handled outside the normal in-app queue workflow.
- The first version can assume one active workspace per operator session.
- Shared queue mode should fail closed when auth or config is missing instead of falling back to local-only persistence.
