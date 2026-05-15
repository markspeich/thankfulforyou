# AGENTS.md

## Project

This project is a website for laying out custom acrylic badge reel designs for an Etsy business.

The core technical challenge is text layout for laser-cut acrylic: arrange text from a chosen font so letters overlap slightly and produce as few disconnected acrylic pieces as possible, ideally one connected piece per text layer.

## Current Phase

The project has moved beyond proof of concept and is now entering an initial production phase.

The geometry pipeline remains the technical foundation of the product. Production work should continue to preserve and strengthen that foundation: real font outlines, overlap analysis, connectedness checks, practical previewing, and vector export suitable for laser cutting.

## Domain Notes

- Badge reel face plates are made from two layers of 1/8 inch acrylic.
- Acrylic pieces are laser cut and solvent-welded together.
- The final face plate is solvent-welded to a badge reel.
- Disconnected text pieces increase production effort and should be minimized.
- Legibility matters as much as connectedness.
- The example design has a backing silhouette and raised text, with text arranged across multiple lines.
- The three primary production fonts are modified Candlepin, modified Skywalk, and Somekind.
- Candlepin and Skywalk have been modified by the business to avoid laser-cutting problems.
- A single design may use more than one font, such as Skywalk for a name and Somekind for credentials.

## Requirements Source Of Truth

Keep project requirements in `docs/requirements.md`.

When the user provides new product, workflow, material, manufacturing, design, or export requirements, update that document as part of the work.

## Engineering Guidance

- Prefer a geometry-first approach as the product moves into production.
- Use real font outlines instead of relying on plain DOM text rendering.
- Keep layout logic separated from UI code so geometry can be tested.
- Represent units explicitly. The manufacturing domain uses inches, while many graphics libraries use pixels, points, or arbitrary units.
- Preserve clean vector output paths for future laser cutting.
- Add tests around geometry behavior once implementation begins, especially connectedness detection and overlap behavior.

## Frontend Guidance

- Build the actual layout tool as the first screen, not a landing page.
- The interface should feel like a calm production workspace.
- Prioritize practical controls: text entry, font choice, layer preview, overlap adjustment, line spacing, scale, connectedness status, and export when available.
- Font choice should eventually be available per line of text.
- Avoid decorative UI that competes with design inspection.
- Use visual previews that clearly distinguish acrylic layers.

## Collaboration Notes

- Ask for clarification when manufacturing constraints affect geometry decisions.
- Capture assumptions explicitly in `docs/requirements.md`.
- Keep changes scoped and avoid unrelated refactors.
- If adding dependencies, choose well-maintained libraries that handle font parsing, vector geometry, boolean operations, or SVG export reliably.
