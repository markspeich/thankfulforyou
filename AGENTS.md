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
- The current UI direction is the Production Queue layout: a left-side order queue and a right-side selected-order editor.
- The selected-order editor should place the preview at the top and the controls at the bottom.
- The left-side order queue should support adding orders, selecting an order to edit, and batch export for queued orders with text.
- The selected-order header should hold the primary order actions, including `Save` and `Export This Design`.
- Prioritize practical controls: text entry, font choice, layer preview, overlap adjustment, line spacing, scale, connectedness status, and export when available.
- Font choice should be available per line of text.
- Organize controls as one control group per text line, followed by one global `Backing Border` control.
- Avoid decorative UI that competes with design inspection.
- Use visual previews that clearly distinguish acrylic layers.

## Collaboration Notes

- Ask for clarification when manufacturing constraints affect geometry decisions.
- Capture assumptions explicitly in `docs/requirements.md`.
- Keep changes scoped and avoid unrelated refactors.
- Prefer bash commands and examples over PowerShell unless PowerShell is absolutely necessary for the task or environment.
- In this Windows worktree environment, `git` commands that touch worktree metadata such as `merge`, `add`, `commit`, and conflict resolution staging may require escalated permissions because `.git/worktrees/...` lockfiles can be blocked otherwise.
- Do not assume `bash` is available here. The bundled `bash` path may route to WSL, and this machine currently has no installed WSL distribution.
- In PowerShell, do not use `&&` as a command separator. Run git steps as separate commands or use a PowerShell-safe alternative.
- When referring to stash entries in PowerShell, quote refs like `"stash@{0}"` so brace parsing does not corrupt the argument.
- If adding dependencies, choose well-maintained libraries that handle font parsing, vector geometry, boolean operations, or SVG export reliably.
