# Supabase Environment Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local and remote Supabase execution explicit for app startup and database tests.

**Architecture:** Add a shared Node helper that resolves Supabase environment variables for either `local` or `remote` mode. Local mode reads the Supabase CLI local stack output; remote mode uses the existing `.env.local` and worktree seed workflow.

**Tech Stack:** Node.js ES modules, npm scripts, Supabase CLI, Vitest, README documentation.

---

### Task 1: Shared Supabase Env Helper

**Files:**
- Create: `tools/supabase_env.mjs`
- Create: `tests/unit/supabase-env.test.js`

- [x] Write failing unit tests for parsing `supabase status --output env`, validating required keys, and resolving remote env without overwriting explicit shell values.
- [x] Implement `parseSupabaseStatusEnv`, `buildLocalSupabaseEnv`, `validateSupabaseEnv`, `resolveRemoteSupabaseEnv`, and command spawning helpers.
- [x] Run the focused unit test and verify it passes.

### Task 2: Command Runners And Scripts

**Files:**
- Create: `tools/run_with_supabase_env.mjs`
- Modify: `tools/run_db_tests.mjs`
- Modify: `package.json`

- [x] Add a general `run_with_supabase_env.mjs` wrapper with `--env local|remote -- <command...>`.
- [x] Update DB tests so `test:db` defaults to local mode and `test:db:remote` runs without local reset unless explicitly allowed by the existing remote guard.
- [x] Add app scripts for `start:local` and `start:remote` while preserving `npm start` as the existing remote-compatible default.

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`

- [x] Update app and testing documentation with local vs remote Supabase commands.
- [x] Run unit tests for the new helper.
- [x] Run the DB test lane against local Supabase when the local stack and permissions are available.
