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

`npm run test:e2e` now defaults to the current checkout's local dev server URL. It uses the same shared port helper as `npm start`, so each worktree targets its own local server automatically.

Or run both:

```powershell
npm test
```

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
