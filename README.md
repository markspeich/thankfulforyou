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

Then open `http://localhost:4173`.

## Run Tests

The project now has both fast unit tests for layout math and browser tests for the live preview.

```powershell
npm run test:unit
npm run test:e2e
```

Or run both:

```powershell
npm test
```

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
