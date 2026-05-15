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

The current production-oriented build expects these fonts in `public/fonts`:

- `Candlepin-Laser.otf`
- `SkywalkLaserRegular.otf`
- `Somekind.ttf`
