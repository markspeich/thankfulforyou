# Shared Queue Backend Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the first Supabase shared-queue backend so the existing app auth and shared queue routes have real tables and an RPC to talk to.

**Architecture:** Use a minimal Supabase schema that matches the current app contract. Keep workspace ownership and queue identity relational, but store the canonical queue snapshot in `design_queues` for this first production pass so the current frontend and API code can ship without another storage-model rewrite.

**Tech Stack:** Supabase Auth, Postgres, Supabase MCP, Vercel-style server routes, JSONB queue snapshots

---

### Task 1: Document the approved backend shape

**Files:**
- Create: `docs/superpowers/plans/2026-05-27-shared-queue-backend-setup.md`
- Modify: `docs/requirements.md`
- Modify: `README.md`

- [ ] Record the approved assumption that the first shared-queue backend pass uses relational `workspaces`, `workspace_memberships`, and `design_queues`, while persisting the queue snapshot canonically in `design_queues.queue_json` and `design_queues.orders_json`.
- [ ] Add setup notes for the initial Supabase bootstrap, including the seeded primary workspace and queue plus the need to create or invite operator users before adding memberships.

### Task 2: Provision the minimal Supabase schema

**Files:**
- Remote only: connected Supabase project via MCP

- [ ] Create `public.workspaces`.
- [ ] Create `public.workspace_memberships`.
- [ ] Create `public.design_queues`.
- [ ] Enable RLS on all three tables and add safe authenticated read policies.
- [ ] Create `public.save_design_queue_snapshot(...)` as the transactional save path expected by `api/_lib/shared-queue-store.js`.
- [ ] Seed one primary workspace and one primary queue so the first operator membership has a queue to open immediately.

### Task 3: Verify and report the bootstrap state

**Files:**
- Remote only: connected Supabase project via MCP

- [ ] Re-list tables and verify the expected schema exists.
- [ ] Run security advisors and note whether any warnings are newly introduced or pre-existing.
- [ ] Check whether any auth users exist yet and report the next manual step for operator onboarding.
