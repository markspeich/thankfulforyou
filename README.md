# Thankful For You Badge Reel Layout Tool

This workspace is for a new website that will help prepare custom acrylic badge reel designs for production.

The app focuses on laying out text from a font so the letters overlap enough to reduce disconnected acrylic pieces while staying readable.

The planned control model is line-driven: the number of text lines comes directly from the user's entered text, each line gets its own Font, Letter Bridge, Line Bridge, Horizontal Offset, and Text Height controls, and `Backing Border` remains a single global control below those per-line groups.

See `docs/requirements.md` for the living requirements document.

## Run The App

The current app runs locally.

```powershell
npm start
```

`npm start` uses the existing remote-compatible worktree setup: it prepares `.env.local` from the machine-local shared seed when needed, then serves the app with those environment variables.

To explicitly run the app against the Supabase CLI local stack:

```powershell
npm run start:local
```

To explicitly run the app against the remote Supabase environment from `.env.local` or the machine-local shared seed:

```powershell
npm run start:remote
```

The local dev server picks a deterministic port for each worktree. In this worktree, the default URL is `http://127.0.0.1:4710`.

To force a different port:

```powershell
$env:PORT = "4801"
npm start
```

On Windows in this Codex worktree setup, keep the dev server running in a foreground or other persistent terminal session. A detached hidden launch can exit early and leave the in-app browser unable to connect even if the first health check passed.

## Run Tests

The project now has fast mocked unit tests, local database integration tests, and browser tests for the live preview.

```powershell
npm run test:unit
npm run test:db
npm run test:e2e
```

`npm run test:unit` does not hit Supabase or Postgres. Database-facing unit coverage uses mocks so the unit lane stays fast and does not require Docker.

`npm run test:db` and `npm run test:db:local` reset the local Supabase database from `supabase/migrations` and `supabase/seed.sql`, then run the tests in `tests/db`. These commands require Docker Desktop and the local Supabase stack. They are intentionally separate from `npm test` so ordinary test runs do not unexpectedly reset local database state.

`npm run test:db:remote` runs the same DB integration tests against the remote Supabase environment from `.env.local` or the machine-local shared seed. It does not reset the remote database. The tests refuse to run against a non-local Supabase URL unless you explicitly set `TFY_ALLOW_REMOTE_DB_TESTS=1` for that command.

`npm run test:e2e` now defaults to the current checkout's local dev server URL. It uses the same shared port helper as `npm start`, so each worktree targets its own local server automatically.

Or run the default unit and browser suites:

```powershell
npm test
```

## Production Batch Setup

The production batch rollout uses Supabase for authenticated workspace access and production batch persistence.

Set these environment variables for local and hosted environments:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` preferred for browser auth bootstrap
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The browser session bootstrap reads:

- `window.__APP_CONFIG__.supabaseUrl`
- `window.__APP_CONFIG__.supabaseAnonKey`

The app now populates `window.__APP_CONFIG__` from `/app-config.js`.

- `npm start` loads `.env.local` when present, then serves `/app-config.js` dynamically from environment variables
- `npm start` first prepares `.env.local` for Codex worktrees by merging missing production-batch Supabase keys from the machine-local seed file at `C:\Users\Mark\CodexProjects\thankfulforyou\.env.local.shared`
- `npm run build` loads `.env.local` when present, then writes `dist/app-config.js` from the same environment variables
- the browser key prefers `SUPABASE_PUBLISHABLE_KEY` and falls back to `SUPABASE_ANON_KEY`

## Database Admin Commands

Use the explicit database admin scripts for order-data maintenance instead of reusing app startup env modes. The scripts report counts and destructive operations default to dry-run.

```powershell
npm run db:local:orders:count
npm run db:local:orders:purge -- --dry-run
npm run db:local:orders:purge -- --execute

npm run db:prod:orders:count
npm run db:prod:orders:purge -- --dry-run
npm run db:prod:orders:purge -- --execute --confirm=oezjskcygvfyezvoulzw
```

Production order purge is guarded to the live Supabase project ref `oezjskcygvfyezvoulzw`. It re-links the Supabase CLI to that project before running SQL, clears `production_batches.active_order_item_id`, deletes `order_items`, and relies on database cascades for `batch_items`, `designs`, `design_lines`, and `design_analysis_cache`.

Operators sign in through the app with invite-only email-and-password Supabase Auth accounts. The app does not expose self-service sign-up for production batch access.

If browser Supabase config is missing or the current production batch session expires, the app shows a blocking sign-in or configuration state instead of falling back to local-only batch persistence.

The server-side production batch routes read:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Local production-batch sign-in requires the dev server process to reach Supabase from Node. In restricted agent sandboxes, start `npm start` with network permission; otherwise token verification can fail even after the browser sign-in succeeds.

The production batch implementation expects these Supabase resources:

- `workspaces`
- `workspace_memberships`
- `production_batches`
- `batch_items`
- `order_items`
- `designs`
- `design_lines`
- `presets`
- `preset_line_rules`
- `preset_listing_assignments`
- `size_guides`

The first backend bootstrap for this repo uses a minimal production shape:

- relational `workspaces`, `workspace_memberships`, production batch, order item, design, preset, and size-guide tables
- one seeded `Primary Workspace`
- one seeded `Primary Batch`
- canonical batch, order item, design, and design line records stored in relational tables

The seeded records currently use these identifiers:

- workspace id: `11111111-1111-4111-8111-111111111111`
- batch id: `22222222-2222-4222-8222-222222222222`

The production batch save path assumes the backend returns canonical production batch snapshots with:

- `batch`
- `activeOrderItemId`
- `orderItems`

Each shared design record should preserve audit and revision metadata so stale writes can be detected:

- `revision`
- `updatedAt`
- `updatedBy`

If the Supabase project has no auth users yet, create or invite an operator account first, then insert a `workspace_memberships` row for that user before testing the production batch sign-in flow. A seeded workspace and batch alone are not enough to grant access.

For local verification of production batch behavior, authenticate with a Supabase user that belongs to the target workspace before testing cross-browser restore, save conflicts, or recovery flows.

The local `npm start` dev server now serves the browser auth module graph directly from `node_modules` for the unbundled app shell, so production batch sign-in and authenticated batch requests can be exercised locally against a real Supabase project.

### Local Supabase Stack

This repo is configured to run a local Supabase stack for development and future integration tests. The stack uses Docker through the Supabase CLI and applies the versioned schema in `supabase/migrations`.

Start the local stack from the repo root:

```powershell
npx supabase start
```

After startup, inspect the local URLs and keys:

```powershell
npx supabase status
```

The local-mode scripts read the printed values automatically through `npx supabase status --output env`:

- `SUPABASE_URL`: local API URL, usually `http://127.0.0.1:54321`
- `SUPABASE_PUBLISHABLE_KEY`: local anon key from `supabase status`
- `SUPABASE_ANON_KEY`: same local anon key, when needed for compatibility
- `SUPABASE_SERVICE_ROLE_KEY`: local service role key from `supabase status`

Run the app against the local stack:

```powershell
npm run start:local
```

To rebuild the local database from committed migrations and seed data:

```powershell
npx supabase db reset --local
```

`npm run test:db` and `npm run test:db:local` run this reset automatically before executing DB integration tests.

The local seed creates the `Primary Batch` documented above. Auth users are not seeded automatically; create a local operator user through local Studio or the Auth API, then insert a `workspace_memberships` row for workspace `11111111-1111-4111-8111-111111111111` before exercising authenticated production-batch flows.

### Playwright Targeting

Use these commands depending on what you want to verify:

```powershell
# Local current checkout or worktree
npm run test:e2e

# Protected Vercel preview, explicitly opt-in
npm run test:e2e:preview
```

Targeting precedence is:

1. `PLAYWRIGHT_BASE_URL` if you set it explicitly for a command.
2. Otherwise the local worktree-aware dev URL.
3. The preview URL from `.env.local` only when preview targeting is explicitly requested.

This means normal local runs no longer get silently redirected to a preview deployment just because `.env.local` contains `PLAYWRIGHT_BASE_URL`.

If you need a one-off override, set it only for that command:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4801"
npm run test:e2e
```

Avoid leaving a shared `PLAYWRIGHT_BASE_URL` set in your shell session when you are working across multiple worktrees.

The production-oriented build expects these deployable font files in `public/fonts`:

- `Candlepin-Laser.otf`
- `SkywalkLaserRegular.otf`
- `Somekind.ttf`

## Build Static Assets

The Vercel deployment serves static frontend files from `dist`.

```powershell
npm run build
```

This copies `index.html`, `src`, and `public` into `dist`. The API routes stay in `api/` and call the same Python geometry pipeline used locally.

## Deploy To Vercel

The project is configured for Vercel with:

- `vercel.json` for the build command, output directory, and Python function bundle exclusions.
- `.python-version` to align with Vercel's Python 3.14 runtime.
- `pyproject.toml` and `requirements.txt` for the Python geometry runtime and lightweight dependencies.
- `api/layout_analyze.py` for hosted connectedness and path analysis.
- `api/export_svg.py` for hosted SVG export.

Recommended Vercel project settings:

- Framework Preset: `Other`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

For preview deployments that exercise production batch auth and persistence safely, use a non-production Supabase environment when possible. The preferred long-term setup is:

- a Git branch deployed to a Vercel Preview deployment
- a matching Supabase preview branch or separate staging project
- preview-only Vercel environment variables pointing at that non-production Supabase environment

For production batch preview deployments, configure these Vercel environment variables at minimum:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The preview deployment uses `SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY` to generate `dist/app-config.js` during `npm run build`, and the server routes in `api/` use `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` at runtime.

## Supabase Branching Setup

Supabase preview branches are the preferred way to test production batch schema and auth changes remotely without pointing Vercel Preview at production data or production credentials.

This repo should keep its Supabase schema in `supabase/migrations`. Supabase branching depends on migration history to reproduce the backend shape reliably across preview branches and merges.

Recommended setup flow:

1. Initialize the local Supabase project files once with `npx supabase init`.
2. Link the repo to the hosted project with `npx supabase link --project-ref <project-ref>`.
3. Pull the current remote production schema into versioned migrations with `npx supabase db pull <migration-name> --linked`.
4. Commit the resulting `supabase/` files.
5. Create or connect a Supabase preview branch for the Git branch you want to test.
6. Point the Vercel Preview environment variables at that branch's `SUPABASE_URL`, publishable key, and service role key.

If the repo has no migration history yet, create it before relying on Supabase preview branches for remote testing. Otherwise a new branch may not reproduce the current production batch schema cleanly.

The hosted preview, analysis, and export all use these same real font files so layout decisions and SVG output stay consistent between local and Vercel environments.

## Vercel Preview Smoke Test

Run this on the Vercel preview URL before promoting to production:

1. Open the deployed app and confirm the design tool loads.
2. Add a design with multiple text lines.
3. Confirm Candlepin, Skywalk, and Somekind load from the font dropdowns.
4. Click `Complete` and confirm the connectedness status updates.
5. Click `Export This Design` and confirm an SVG downloads.
6. Add a second completed design and confirm `Export All Designs` downloads a batch SVG.
7. Open the SVG in LightBurn and confirm the face layer, backing layer, and color label objects are selectable as expected.

## Protected Vercel Preview Automation

The initial production authorization plan uses Vercel Deployment Protection rather than an in-app login system.

To run Playwright against a protected Vercel preview, keep the preview URL and bypass secret in `.env.local`, generate a Protection Bypass for Automation secret in the Vercel project, and then run:

```powershell
npm run test:e2e:preview
```

For a one-off preview target that is different from `.env.local`:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://your-preview-url.vercel.app"
$env:VERCEL_AUTOMATION_BYPASS_SECRET = "your-bypass-secret"
npm run test:e2e:preview
```

The Playwright config automatically sends:

- `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`
- `x-vercel-set-bypass-cookie: true`

This keeps Deployment Protection enabled while still allowing automated preview smoke tests to load the app and call the same protected API routes.
