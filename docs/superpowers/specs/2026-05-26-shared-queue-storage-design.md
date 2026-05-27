# Shared Queue Storage Design

## Goal

Replace the current browser-local-first queue persistence model with a shared hosted queue model so authorized users can create designs in one browser or location and continue the same queue in another browser or location without manual handoff.

## Recommendation

Use Supabase as the first production backend for shared queue storage.

Supabase is the recommended fit because this requirement is broader than raw database persistence. The app needs:

- authenticated access
- shared queues that are not owned by one individual user
- structured records for queues and designs
- audit history such as `updatedAt` and `updatedBy`
- a clear path to live multi-browser updates later

Supabase gives us Postgres, Auth, row-level access control, and optional realtime subscriptions in one platform. That reduces the amount of custom backend infrastructure needed for the first shared-storage version while keeping the data relational and portable.

## Alternatives Considered

### 1. Supabase

Pros:

- relational data model fits workspaces, queues, designs, and audit fields well
- built-in auth and row-level security help with shared access control
- optional realtime support gives a clean path to future live updates
- Postgres keeps reporting and operational queries practical later

Cons:

- introduces a new platform the team has not used yet
- requires schema design, auth setup, and permissions work before queue migration

### 2. Firebase or Firestore

Pros:

- strong live sync behavior out of the box
- fast path to "same data everywhere" behavior

Cons:

- document storage is a less natural fit for queue, design, and reporting relationships
- future querying and operational reporting can become less straightforward

### 3. Custom backend plus hosted Postgres

Pros:

- maximum control over auth, sync behavior, and domain modeling
- no platform conventions beyond the database itself

Cons:

- slowest path to a dependable shared queue
- requires more custom server work for auth, access control, and sync behavior

## Product Model

The queue should belong to the business workflow, not to an individual operator.

The core records should be:

- `workspace`: a shared business context such as the shop or a future team scope
- `queue`: a shared batch of designs within a workspace
- `design`: one editable queue item within a queue
- `user`: an authenticated operator with access to one or more workspaces

Users exist for identity, access control, and audit history. They do not own queues. This supports the required workflow where one person creates a queue and another person opens and continues it later.

## Data Model Direction

The current queue persistence stores one serialized snapshot blob. That is convenient for local restore, but it is too coarse for shared editing and audit behavior.

The shared-storage version should evolve toward first-class records:

### Workspace

- `id`
- `name`
- `createdAt`

### Queue

- `id`
- `workspaceId`
- `name` or operator-facing label
- `status`
- `createdAt`
- `updatedAt`
- `updatedBy`

### Design

- `id`
- `queueId`
- `position`
- imported Etsy metadata
- current text
- preset selection
- global layout settings
- per-line layout settings
- completion state
- cached export-ready analysis metadata when valid
- `updatedAt`
- `updatedBy`
- `revision`

The initial migration can still serialize some complex nested layout fields as JSON inside a `design` record if that keeps the first pass manageable. The important change is that the shared system should stop treating the whole queue as one anonymous browser snapshot.

## Source Of Truth

The hosted backend should become the source of truth for shared queue state.

That means:

- browsers load queue data from the backend first
- normal saves write to the backend first
- local browser storage is demoted to cache or recovery use only
- the app must not silently prefer stale local queue data over newer shared backend state

This directly addresses the current failure mode where two browsers can show different queue contents because each browser trusts its own local storage.

## Local Cache Role

Local storage should remain useful, but only in a supporting role.

Recommended uses:

- short-term recovery if the browser refreshes during editing
- temporary offline resilience
- preserving unsent edits long enough to recover from a transient network issue

Local cache should not decide startup state when shared backend data exists. If recovery from unsynced local edits is needed, the UI should surface that clearly as an explicit recovery flow instead of silently overriding the shared queue.

## Collaboration Model

The first shared version should optimize for safe handoff, not full simultaneous collaborative editing.

Recommended initial rules:

- all authorized users can view the shared queue
- one user can create a queue and another can continue it later
- the app shows `last updated by` and `last updated at` for each design
- each design has a `revision` field so stale writes can be rejected or surfaced
- optional lightweight presence can mark a design as currently being edited

This avoids silent overwrites without forcing the project to solve complex real-time co-editing immediately.

## Loading And Saving Flow

### Startup

1. Authenticate the user.
2. Resolve the active workspace and queue.
3. Load the queue and its designs from the backend.
4. Render that shared state in the editor.
5. Only then consider whether any local recovery draft should be surfaced.

### Editing

1. The browser edits the current design in memory.
2. The app persists changes to the backend as the normal save path.
3. The save request includes the design's current `revision`.
4. If the backend revision has advanced, the save is rejected or flagged as a conflict.

### Recovery

If local cache contains unsynced data after a network interruption, the app should show an explicit recovery choice instead of silently replacing shared backend state.

## Realtime Strategy

Realtime updates are desirable, but they do not need to block the first migration.

Recommended rollout:

1. shared backend records and remote-first loading
2. shared remote saves
3. periodic refresh or focused reload after important actions
4. optional Supabase realtime subscriptions for more immediate cross-browser updates

This keeps the first implementation smaller while preserving a clean upgrade path.

## Error Handling

- If authentication fails, the queue should not load shared data anonymously.
- If backend queue load fails, the UI should show a clear shared-storage error state and avoid pretending that stale local cache is authoritative.
- If a save fails because the design revision is stale, the UI should explain that another browser or user updated the design first.
- If backend access is temporarily unavailable, local recovery data may be retained, but the UI should make it clear that the shared queue is not currently synced.

## Testing Strategy

Add coverage for:

- remote-first queue loading
- prevention of stale local queue override on startup
- shared queue restore in a second browser or session
- save behavior with revision checks
- conflict handling when two sessions edit the same design
- access control around shared workspaces and queues
- fallback and recovery behavior when the backend is unavailable

Browser verification should cover at least one handoff flow where a queue created in one session appears in another session and preserves the expected design state.

## Rollout Plan

1. Introduce authenticated users and workspace access.
2. Add shared backend records for workspaces, queues, and designs.
3. Load the active queue from the backend first.
4. Save design changes to the backend as the default path.
5. Retain local storage only as cache or recovery support.
6. Add revision-based stale-write protection.
7. Add presence or realtime updates later if production usage needs it.

## Assumptions

- Shared queue access is a production requirement, not an optional import/export utility.
- Queue ownership belongs to a shared workspace or batch concept rather than to one user.
- The first implementation can prioritize safe handoff and stale-write protection over fully simultaneous live co-editing.
- Supabase is acceptable as the first backend choice even though the team is new to it.
