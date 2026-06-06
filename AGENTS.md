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

## Standard Local App Startup

### Local Supabase Shorthand

When the user says `local up`, treat it as shorthand for:

`Initialize this worktree's local Supabase environment, then start the local app server. Follow AGENTS.md exactly and report the app URL, test user, test password, and Supabase Studio URL.`

For `local up`, do not run raw `supabase start`, edit `supabase/config.toml`, or guess ports.

Run from the repository root:

`npm run prepare:local`

This command:

- Generates this worktree's git-ignored Supabase workdir under `.local/supabase/<worktree-id>`.
- Starts the isolated local Supabase stack.
- Resets schema and seed data.
- Initializes `test.operator@example.com`.
- Prints the app URL, test password, and Supabase Studio URL.

After that, start the app with:

`npm run start:local`

Whenever reporting a started server, include:

- App URL.
- Test user: `test.operator@example.com`.
- Test password: `TestOperator123!`.
- Local Supabase Studio URL.

When the user asks to start the app, start a server, or initialize the app, follow this exact local workflow unless they explicitly ask for remote:

1. Read `AGENTS.md` and `docs/requirements.md` if they have not already been read this turn.
2. When the worktree needs its own local Supabase environment prepared or refreshed, run `npm run prepare:local` from the repository root. This reusable command generates the per-worktree Supabase workdir, starts that isolated stack, resets local schema and seed data, initializes the test operator/workspace/batch, and prints the local Supabase env.
3. Start the local dev server from the repository root with `npm run start:local`.
4. In Windows Codex worktrees, prefer a visible persistent PowerShell window for the server:
   `Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-Command','cd "<repo root>"; npm run start:local')`
5. Do not use detached hidden server launches or redirected-log background launches for the dev server unless the user explicitly asks for a background-only server.
6. Read the printed `Badge reel layout tool: http://localhost:...` line and use that exact URL.
7. Verify the server with `(Invoke-WebRequest -UseBasicParsing '<printed URL>/').StatusCode`.
8. If `localhost` resolves to IPv6 and fails in scripted checks, retry verification with `http://127.0.0.1:<port>`.
9. For `Initialize app`, run `npm run initialize:local` when the local Supabase stack is already prepared; run `npm run prepare:local` when the worktree needs the full local stack start/reset/init sequence.
10. Verify initialization by signing in as `test.operator@example.com` and calling `<printed URL>/api/batch-session` with the access token.
11. Whenever starting or reporting a local server, include the server URL, the test login `test.operator@example.com`, the test password `TestOperator123!`, and the local Supabase Studio URL for this worktree.
12. Report the server URL, HTTP status, operator, workspace, batch, test login, test password, and Supabase Studio URL.

- When the user says `start a server`, start the local dev server unless they explicitly ask for remote.
- To start the local dev server in this worktree, run `npm run start:local` from the repository root.
- To prepare or refresh this worktree's isolated local Supabase environment, run `npm run prepare:local` from the repository root.
- To start the remote-backed dev server, run `npm run start:remote` only when the user explicitly asks for remote.
- Use `npm run start:local` or `npm run start:remote` as the canonical dev entrypoints for this app instead of invoking `node` directly with a guessed script.
- `npm run start:local` and `npm run start:remote` first run through `tools/run_with_supabase_env.mjs`, which selects the requested Supabase environment before launching the dev server.
- `npm run prepare:local` runs through `tools/prepare_local_env.mjs`, which uses the generated per-worktree Supabase workdir instead of rewriting the tracked `supabase/config.toml`.
- Plain `npm start` is an alias for the per-worktree local startup path and should resolve Supabase settings through `tools/run_with_supabase_env.mjs --env local`, not through `.env.local`.
- Keep `C:\Users\Mark\CodexProjects\thankfulforyou\.env.local.shared` out of git. It is only a machine-local seed for explicitly remote Supabase workflows that need missing `.env.local` secrets, especially `SUPABASE_SERVICE_ROLE_KEY`.
- The dev server should consume Supabase settings injected by `npm run start:local`, `npm run start:remote`, or another explicit wrapper. It should not load `.env.local` implicitly during local startup.
- Do not use `npm run start:remote`, `tools/run_with_supabase_env.mjs --env remote`, `.env.local`, or Vercel env pulls as proof that a command is targeting the live production database. Worktree env files can point at local Supabase.
- For order-data database administration, use the explicit admin scripts:
  - `npm run db:local:orders:count`
  - `npm run db:local:orders:purge -- --dry-run`
  - `npm run db:local:orders:purge -- --execute`
  - `npm run db:prod:orders:count`
  - `npm run db:prod:orders:purge -- --dry-run`
  - `npm run db:prod:orders:purge -- --execute --confirm=oezjskcygvfyezvoulzw`
- Production order-data admin scripts are guarded to the live Supabase project ref `oezjskcygvfyezvoulzw`; they re-link the Supabase CLI before running SQL and destructive production runs require the project ref confirmation token.
- Before and after any destructive database operation, report counts for `order_items`, `batch_items`, `designs`, `design_lines`, `design_analysis_cache`, and `production_batches.active_order_item_id` references.
- When shared queue auth or shared queue API routes must work from Codex, start the chosen dev server command with escalated/network permissions. A sandboxed dev server can serve the frontend but fail Supabase token verification, which appears to the user as an expired shared queue session.
- The dev server port is determined by `tools/dev_port.mjs`. Do not hardcode or guess a worktree URL from `AGENTS.md`.
- Each worktree should keep a stable app server port in `.local/dev-server.json`; once assigned, reuse that port whenever starting the server in that worktree unless `PORT` is explicitly set.
- To stop this worktree's local dev server, run `npm run stop:local` from the repository root. Do not stop servers by killing every process whose command line contains `tools/dev_server.mjs`, because that can stop servers from other worktrees.
- After starting the server, read the printed `Badge reel layout tool: http://localhost:...` line and use that exact URL.
- The dev server startup banner prints the server URL, test login, test password, and local Supabase Studio URL. Include those values in the response whenever you start or restart the server for the user.
- If the URL is needed before launch, compute it from the helper with `node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl())"`.
- If a different port is needed, set it explicitly in PowerShell with `$env:PORT = "4801"` and then run the chosen startup command.
- Keep the dev server running in a foreground or other persistent terminal session. In this Windows Codex worktree setup, detached hidden launches can exit early and leave the browser unable to connect.
- Do not assume `node_modules` must already exist before launching the dev server. In this repo, the HTTP dev server can start without an install, though tests and other tooling may still require dependencies.
- After launch, verify the server with a quick HTTP request instead of trusting process startup alone.

### Testing And Port Isolation

- Automated tests that start or target the web app must follow the same per-worktree port discipline as manual dev-server startup.
- Use `npm run test:e2e` for local browser/e2e tests. That script runs `tools/run_playwright.mjs`, resolves this checkout's dev-server URL, and exports `PLAYWRIGHT_BASE_URL` and `PORT` for the test process.
- Use `npm run test:e2e:raw` or direct `npx playwright test` only when you explicitly need to bypass the safe runner, and only after setting `PLAYWRIGHT_BASE_URL` and `PORT` yourself.
- Before running Playwright, e2e tests, or any test that may start `tools/dev_server.mjs`, resolve this worktree's URL with:
  `node --input-type=module -e "import { resolveDevBaseUrl } from './tools/dev_port.mjs'; console.log(resolveDevBaseUrl())"`
- Pass that resolved URL to browser/e2e test commands with `PLAYWRIGHT_BASE_URL` instead of letting a test process guess or bind a shared/default port.
- If verifying from a different checkout or worktree, resolve and use that checkout's own `tools/dev_port.mjs` result. Do not reuse a URL printed by another worktree.
- Do not run `npm test`, `npm run test:e2e`, `npx playwright test`, or ad hoc Playwright scripts from a different checkout unless you have first resolved and exported that checkout's own test URL.
- Never stop or kill a process merely because it owns the port a test wanted. First determine whether that process belongs to the current worktree. If it belongs to another worktree, leave it running and choose this worktree's resolved test URL or set an explicit non-conflicting `PORT` for the current command.
- If a test fails with `EADDRINUSE`, treat it as a test setup error, not as permission to kill the port holder. Resolve the current worktree URL, set `PLAYWRIGHT_BASE_URL`/`PORT` consistently for the retry, and report the collision.
- When the user says `Initialize app`, initialize local app test data unless they explicitly ask for remote: create or update the local Supabase test operator `test.operator@example.com` with password `TestOperator123!`, ensure `Primary Workspace` exists with id `11111111-1111-4111-8111-111111111111`, ensure the operator has an `operator` membership in that workspace, ensure `Primary Batch` exists with id `22222222-2222-4222-8222-222222222222`, and refresh that batch's `updated_at` so it is the current active batch returned by `/api/batch-session`.
- For `Initialize app`, run commands through `node tools/run_with_supabase_env.mjs --env local -- ...` by default so local Supabase URL and keys are used. Verify initialization by signing in as the test operator and calling the running local server's `/api/batch-session` endpoint with the access token; report the resolved operator, workspace, and batch.
- Remember that the geometry API routes depend on Python. A running frontend server does not guarantee that export and analysis requests will succeed.
- Prefer bash commands and examples over PowerShell unless PowerShell is absolutely necessary for the task or environment.
- In this Windows worktree environment, `git` commands that touch worktree metadata such as `merge`, `add`, `commit`, and conflict resolution staging may require escalated permissions because `.git/worktrees/...` lockfiles can be blocked otherwise.
- Do not assume `bash` is available here. The bundled `bash` path may route to WSL, and this machine currently has no installed WSL distribution.
- In PowerShell, do not use `&&` as a command separator. Run git steps as separate commands or use a PowerShell-safe alternative.
- When referring to stash entries in PowerShell, quote refs like `"stash@{0}"` so brace parsing does not corrupt the argument.
- If adding dependencies, choose well-maintained libraries that handle font parsing, vector geometry, boolean operations, or SVG export reliably.
