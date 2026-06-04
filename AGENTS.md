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
- When the user says `finish this worktree`, complete the standard post-feature workflow: merge latest `main` into the current worktree and resolve conflicts, run appropriate verification, commit the worktree changes to the current feature branch, merge that feature branch into `main`, push `main`, and delete the finished feature branch.
- When the user says `start a server`, start the local dev server unless they explicitly ask for remote.
- To start the local dev server in this worktree, run `npm run start:local` from the repository root.
- To start the remote-backed dev server, run `npm run start:remote` only when the user explicitly asks for remote.
- Use `npm run start:local` or `npm run start:remote` as the canonical dev entrypoints for this app instead of invoking `node` directly with a guessed script.
- `npm run start:local` and `npm run start:remote` first run through `tools/run_with_supabase_env.mjs`, which selects the requested Supabase environment before launching the dev server.
- Plain `npm start` is not the default Codex startup command for this worktree unless the user specifically asks for the generic start script.
- `npm start` first runs `tools/setup_worktree_env.mjs`, which fills missing shared-queue Supabase keys in the worktree `.env.local` from the machine-local seed file at `C:\Users\Mark\CodexProjects\thankfulforyou\.env.local.shared`.
- Keep `C:\Users\Mark\CodexProjects\thankfulforyou\.env.local.shared` out of git. It is the local source of truth for secrets that Vercel CLI cannot pull into new worktrees, especially `SUPABASE_SERVICE_ROLE_KEY`.
- `npm start` loads `.env.local` automatically when present, so do not wrap it in a custom env-loading command unless a specific task needs different values.
- When shared queue auth or shared queue API routes must work from Codex, start the chosen dev server command with escalated/network permissions. A sandboxed dev server can serve the frontend but fail Supabase token verification, which appears to the user as an expired shared queue session.
- The dev server port is determined by `tools/dev_port.mjs`. Do not hardcode or guess a worktree URL from `AGENTS.md`.
- After starting the server, read the printed `Badge reel layout tool: http://localhost:...` line and use that exact URL.
- If the URL is needed before launch, compute it from the helper with `node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl())"`.
- If a different port is needed, set it explicitly in PowerShell with `$env:PORT = "4801"` and then run the chosen startup command.
- Keep the dev server running in a foreground or other persistent terminal session. In this Windows Codex worktree setup, detached hidden launches can exit early and leave the browser unable to connect.
- Do not assume `node_modules` must already exist before launching the dev server. In this repo, the HTTP dev server can start without an install, though tests and other tooling may still require dependencies.
- After launch, verify the server with a quick HTTP request instead of trusting process startup alone.
- When the user says `Initialize app`, initialize local app test data unless they explicitly ask for remote: create or update the local Supabase test operator `test.operator@example.com` with password `TestOperator123!`, ensure `Primary Workspace` exists with id `11111111-1111-4111-8111-111111111111`, ensure the operator has an `operator` membership in that workspace, ensure `Primary Batch` exists with id `22222222-2222-4222-8222-222222222222`, and refresh that batch's `updated_at` so it is the current active batch returned by `/api/batch-session`.
- For `Initialize app`, run commands through `node tools/run_with_supabase_env.mjs --env local -- ...` by default so local Supabase URL and keys are used. Verify initialization by signing in as the test operator and calling the running local server's `/api/batch-session` endpoint with the access token; report the resolved operator, workspace, and batch.
- Remember that the geometry API routes depend on Python. A running frontend server does not guarantee that export and analysis requests will succeed.
- Prefer bash commands and examples over PowerShell unless PowerShell is absolutely necessary for the task or environment.
- In this Windows worktree environment, `git` commands that touch worktree metadata such as `merge`, `add`, `commit`, and conflict resolution staging may require escalated permissions because `.git/worktrees/...` lockfiles can be blocked otherwise.
- Do not assume `bash` is available here. The bundled `bash` path may route to WSL, and this machine currently has no installed WSL distribution.
- In PowerShell, do not use `&&` as a command separator. Run git steps as separate commands or use a PowerShell-safe alternative.
- When referring to stash entries in PowerShell, quote refs like `"stash@{0}"` so brace parsing does not corrupt the argument.
- If adding dependencies, choose well-maintained libraries that handle font parsing, vector geometry, boolean operations, or SVG export reliably.
