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

The local dev server picks a deterministic port for each worktree. In this worktree, the default URL is `http://127.0.0.1:4710`.

To force a different port:

```powershell
$env:PORT = "4801"
npm start
```

On Windows in this Codex worktree setup, keep the dev server running in a foreground or other persistent terminal session. A detached hidden launch can exit early and leave the in-app browser unable to connect even if the first health check passed.

## Run Tests

The project now has both fast unit tests for layout math and browser tests for the live preview.

```powershell
npm run test:unit
npm run test:e2e
```

The Playwright config uses the same shared local port helper as `npm start`, so browser tests target the matching per-worktree URL automatically unless `PLAYWRIGHT_BASE_URL` is set.

Or run both:

```powershell
npm test
```

## Shared Queue Setup

The shared queue rollout uses Supabase for authenticated workspace access and shared queue persistence.

Set these environment variables for local and hosted environments:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The browser session bootstrap reads:

- `window.__APP_CONFIG__.supabaseUrl`
- `window.__APP_CONFIG__.supabaseAnonKey`

Operators sign in through the app with invite-only email-and-password Supabase Auth accounts. The app does not expose self-service sign-up for shared queue access.

If browser Supabase config is missing or the current shared queue session expires, the app shows a blocking sign-in or configuration state instead of falling back to local-only queue persistence.

The server-side shared queue routes read:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The shared queue implementation expects these Supabase resources:

- `workspaces`
- `workspace_memberships`
- `design_queues`
- an RPC or equivalent transactional save path named `save_design_queue_snapshot`

The shared queue save path assumes the backend returns canonical queue snapshots with:

- `queue`
- `activeOrderId`
- `orders`

Each shared design record should preserve audit and revision metadata so stale writes can be detected:

- `revision`
- `updatedAt`
- `updatedBy`

For local verification of shared queue behavior, authenticate with a Supabase user that belongs to the target workspace before testing cross-browser restore, save conflicts, or recovery flows.

The local `npm start` dev server now serves the browser auth module graph directly from `node_modules` for the unbundled app shell, so shared queue sign-in and authenticated queue requests can be exercised locally against a real Supabase project.

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

To run Playwright against a protected Vercel preview, generate a Protection Bypass for Automation secret in the Vercel project and then run:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://your-preview-url.vercel.app"
$env:VERCEL_AUTOMATION_BYPASS_SECRET = "your-bypass-secret"
npm run test:e2e
```

The Playwright config automatically sends:

- `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`
- `x-vercel-set-bypass-cookie: true`

This keeps Deployment Protection enabled while still allowing automated preview smoke tests to load the app and call the same protected API routes.
