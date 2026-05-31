# Badge Reel Design Layout Tool Requirements

## Project Objective

Create a website that helps lay out custom badge reel designs for Etsy orders.

The business sells custom badge reels. Each face plate is made from two layers of 1/8 inch acrylic cut by laser and solvent-welded together. The completed face plate is then solvent-welded to a badge reel.

## Primary Problem

The software must lay out customer-provided text in a selected font so the laser-cut acrylic uses as few separate pieces as possible.

The ideal result is that neighboring letters overlap slightly enough to form a single connected acrylic piece, while still preserving legibility and the intended font style.

## Product Stage

The project is now moving from proof of concept into an initial production phase.

The proof-of-concept work established the baseline approach: load real font outlines, overlap neighboring glyphs, evaluate connectedness, preview the resulting acrylic layers, and export vector geometry for laser cutting.

The current goal is to turn that geometry pipeline into a dependable production tool for day-to-day Etsy order work. Production implementation should continue to keep geometry behavior correct and testable while adding the workflow and UI needed for real order throughput.

The initial production rollout starts with the modified Candlepin production font and a default bridge target of 0.5 mm between neighboring acrylic letter pieces. That target should remain adjustable.

The current browser-rendered preview confirms that the modified Candlepin font can be loaded and visually overlapped. However, browser text bounds are only an approximation. Some glyph pairs may appear close by bounding box while still failing to visibly touch. The production geometry pipeline must evaluate neighboring glyphs from actual font outlines rather than rough browser text bounds. A faster browser-rendered path may still be used for live preview only when it remains visually trustworthy and does not replace outline-based geometry checks or export.

## Product Context

- Users are preparing custom badge reel orders from Etsy.
- The designs commonly include short names, titles, credentials, or phrases.
- A production session may include several Etsy orders, each with unique customer text that must be laid out, adjusted, saved, and then revisited or exported later.
- Example layouts may include a raised white text layer over a colored backing silhouette.
- Reference example 1 uses the Candlepin font.
- The Candlepin font has been modified by the business to fix issues encountered when cutting it on the laser.
- Reference example 2 uses two fonts: the top name text uses Skywalk, and the lower credential text uses Somekind.
- Skywalk has also been modified by the business to fix laser-cutting issues.
- The three primary production fonts are modified Candlepin, modified Skywalk, and Somekind.
- The text layer should be manufacturable from acrylic, ideally as one connected piece per text layer.
- When text letters overlap, the overlap should be welded or unioned into one face-layer shape so internal seam lines are removed.
- The backing layer follows the overall silhouette of the design and gives the text support and contrast.
- The backing layer has a rounded offset border around the text silhouette.
- The backing border should default to 3.1 mm.
- The backing border slider should move in 0.1 mm increments.
- The backing border control should allow values down to 0 mm.
- The backing border value is a physical millimeter offset around the final fitted text geometry; automatic text fitting must not shrink the requested backing border on longer text.
- The backing layer should be a solid acrylic silhouette. Enclosed holes created by font counters or tiny gaps in the backing border should be removed from the backing plate.
- Multi-line layouts may intentionally overlap or touch between lines to help unify the design.
- Different lines in the same badge reel design may use different fonts.

## Materials And Manufacturing

- Acrylic thickness: 1/8 inch per layer.
- Process: laser cut acrylic, then solvent-weld layers together.
- Face plate: two acrylic layers welded together.
- Final assembly: face plate welded to a badge reel.
- Manufacturing constraint: small disconnected text pieces are undesirable because they require more cutting, handling, alignment, and welding.

## Current Production Requirements

- Accept text input for a badge reel design.
- Support choosing or loading a font.
- Support the three primary production fonts early: modified Candlepin, modified Skywalk, and Somekind.
- Render text as actual font outlines, not just browser text.
- Allow text to be arranged in one or more lines.
- Treat the number of editable text lines as fully dynamic and derive it directly from the number of lines entered by the user.
- Add a `Presets` dropdown directly below the `Order Text` field.
- The `Preset` control card in the selected-order editor must expose its secondary actions from an ellipses menu in the card header rather than showing them as always-visible buttons.
- The `Presets` dropdown must offer these production presets: `All Candlepin`, `Candlepin, Skywalk`, `Skywalk, Somekind`, and `Skywalk, Candlepin`.
- The app should add a top-level left navigation bar with three items: `Production Batch`, `Presets`, and `Size Guides`.
- The left navigation bar should be collapsible between an expanded icon-plus-label state and a collapsed icon-only state.
- The left navigation bar should remember its expanded or collapsed state across browser refreshes.
- `Production Batch` should open the existing production batch workspace with the production batch and selected-order editor.
- `Presets` should open a dedicated preset editor workspace for viewing, editing, and creating presets.
- `Size Guides` should open a dedicated size guide workspace for viewing, editing, and creating the named guide boxes used to constrain badge reel design sizes.
- The `All Candlepin` preset must set every text line to the Candlepin font.
- The `Candlepin, Skywalk` preset must set the first text line to Candlepin and every subsequent line to Skywalk.
- The `Skywalk, Somekind` preset must set the first text line to Skywalk and every subsequent line to Somekind.
- The `Skywalk, Somekind` preset must set the second text line text height to 23 mm.
- The `Skywalk, Candlepin` preset must set the first text line to Skywalk and every subsequent line to Candlepin.
- Selecting a preset must overwrite all current per-line settings for the order so every line resets to the preset's predefined values, including font, letter bridge, line bridge where applicable, horizontal offset, and text height.
- Production preset definitions should move toward a schema-validated JSON source of truth instead of duplicating preset ids, labels, line rules, and listing-specific overrides across HTML and JavaScript.
- A preset JSON definition should include the preset id, preset name, base line defaults, per-line rules, and any listing-specific overrides that belong to that preset.
- Preset ids should remain stable once in use so saved batch data can continue resolving previously selected presets.
- The app should allow editing an existing preset and saving changes back into Supabase Postgres.
- The `Presets` page should follow the same two-pane production layout style as `Production Batch` and `Size Guides`: preset selection in a left navigation panel, with the preset editor in a right editor panel on desktop-width screens.
- The `Presets` page should use row-based preset selection in the left navigation panel, matching the production batch and size guide row-selection pattern rather than presenting the operator-facing selector as a dropdown.
- The `Presets` page editor panel should contain the preset name, reusable global defaults, reusable line rules, listing assignments, actions, and status for the selected preset.
- Live preset edits should save to Supabase Postgres so changes propagate across sessions and environments.
- On startup, presets should load from Supabase Postgres before falling back to bundled defaults for an empty development database.
- The app should allow creating a new preset from the current design-editor layout state.
- The `Save as New Preset` flow should infer reusable preset structure instead of freezing a one-off order snapshot.
- Shared values across every text line should become preset `lineDefaults`.
- First-line-only differences should become a `first` line rule.
- Shared differences across every line after the first should become a `remaining` line rule.
- Remaining one-off line differences should become `index` line rules.
- Preset creation and editing must not store order-specific text inside preset definitions.
- Per-line preset and saved-order data must persist the `Lock Text Height` setting so reusable presets and restored batch items preserve which lines are protected from automatic fit resizing.
- Allow font selection per line of text.
- Allow horizontal-only stretching per line of text so operators can make a line wider without making it taller.
- Per-line `Horizontal Stretch` controls should allow values up to `200%`.
- Allow vertical-only stretching per line of text so operators can make a line taller without making it wider.
- Provide one control group per text line.
- Each per-line control group must include a Font dropdown, Letter Bridge slider, Horizontal Offset slider, Text Height slider, Horizontal Stretch slider, and Vertical Stretch slider.
- Each per-line control group must also include a `Lock Text Height` control that prevents automatic boundary-fit resizing from changing that line's configured text height.
- The `Lock Text Height` control should appear inline with the rest of the line controls and should not render inside its own bordered subsection.
- Each per-line control group after the first must also include a Line Bridge slider for controlling the connection to the line above it.
- Add or remove per-line control groups automatically as the user adds or removes text lines.
- Remove the current non-functional `Font (Line 1)` and `Font (Line 2)` dropdowns from below the order text field once the per-line control groups exist.
- Allow controlled overlap between adjacent letters.
- Treat 0.5 mm as the current default target for the connecting tab or bridge between neighboring letters in Candlepin layouts.
- Allow controlled overlap or contact between multiple text lines.
- Treat 0.5 mm as the current default target for the connecting bridge between neighboring lines in Candlepin layouts.
- For multi-line Candlepin layouts, slide each lower line upward until the actual visible line shapes overlap by the configured line-bridge target.
- Center multi-line layouts by each line's actual visible shape bounds, not by rough text boxes or font advance widths.
- The rendered text geometry must fit within the active preset's selected maximum bounding rectangle. The current default maximum bounding rectangle is 2.2 inches wide by 1.5 inches tall.
- Scale the text proportionally to make the best use of the active preset's selected maximum bounding rectangle, scaling up or down as needed so the text fills as much of the allowed space as possible while still staying within that rectangle.
- Support additional size guides beyond the current 2.2 inch by 1.5 inch guide.
- Operators must be able to create new size guides from the UI for testing and production setup, without editing source files or redeploying the app.
- Each size guide must define both a maximum rectangle and a minimum rectangle so the preview can show the allowed size range for that badge reel design.
- The size guide editor should live on its own `Size Guides` page rather than inside the preset editor.
- The size guide editor should include a live preview of the max rectangle, min rectangle, dimension labels, and optional centered circle from the fields currently being edited.
- The `Size Guides` page should follow the same two-pane production layout style as `Production Batch`: saved size guide rows in a left navigation panel, with the full size guide editor in a right editor panel on desktop-width screens. The editor panel should contain the number fields, preview, actions, and status.
- Clicking a saved size guide row should load it into the editor directly; size guide rows should not include a separate `Edit` button.
- The `New Guide` action should sit at the top of the left size-guide navigation panel. `Save Guide` and `Delete Guide` should sit at the top right of the size-guide editor panel.
- Size guide editor fields should use compact spacing so production dimensions can be scanned and edited without excessive vertical spread.
- The active size guide must be a global layout setting selected in the `Global Settings` card and saved as part of reusable presets.
- Treat `Text Height` as the authored physical size for each line in millimeters.
- When a line's `Lock Text Height` control is enabled, preserve that line's authored text height during automatic boundary-fit resizing instead of scaling it with the rest of the design.
- Automatic boundary-fit resizing should continue scaling unlocked lines proportionally to make the best use of the active preset's selected maximum guide box.
- `Horizontal Stretch` must remain editable and continue affecting final rendered geometry even when `Lock Text Height` is enabled, because the lock applies only to authored text height.
- `Vertical Stretch` must remain editable and continue affecting final rendered geometry even when `Lock Text Height` is enabled, because the lock applies only to authored text height.
- If one or more locked lines prevent the final design from fitting within the guide box, preserve the locked text height and allow the final design to overflow the guide rather than silently breaking the lock.
- Manual edits to `Text Height` must continue working when `Lock Text Height` is enabled; the lock only prevents automatic fit resizing from changing the line's authored text height.
- Horizontal-only stretch must contribute to the measured text width and connectedness analysis while preserving the intended line height as much as practical.
- Vertical-only stretch must contribute to the measured text height and connectedness analysis while preserving the intended line width as much as practical.
- The backing border does not need to fit within the 2.2 inch by 1.5 inch text guide limit and may extend beyond it.
- Detect whether text geometry is connected as a single piece.
- Show a visual preview of the text and backing layer.
- Keep the live on-screen preview fast and responsive while the user types or adjusts controls.
- The live editing preview may use a faster browser-rendered path than the export pipeline, as long as it stays visually trustworthy for layout decisions.
- The analyzed preview backing silhouette should render in `rgb(255, 0, 0)`.
- Connectedness checks and other heavier geometry analysis should not run during routine typing or slider adjustments; they should run when the operator explicitly clicks `Complete`.
- When a design's settings have not changed since the last save, the app should reuse its most recently saved analyzed export-ready geometry for batch revisit and SVG export instead of recomputing the same layout and paths again.
- Add a `Weld Exported Design` checkbox directly below the order text field.
- The `Weld Exported Design` checkbox must default to checked.
- Add a global `Horizontal Stretch` slider in the Global controls box.
- The global `Horizontal Stretch` slider should allow values up to `200%`.
- The global `Horizontal Stretch` slider must overwrite every current text line's per-line `Horizontal Stretch` value when adjusted.
- When all text lines share the same horizontal stretch value, the global `Horizontal Stretch` slider should display that shared value; when lines differ, its readout should indicate a mixed state until the operator adjusts it.
- Add a global `Vertical Stretch` slider in the Global controls box.
- The global `Vertical Stretch` slider must overwrite every current text line's per-line `Vertical Stretch` value when adjusted.
- When all text lines share the same vertical stretch value, the global `Vertical Stretch` slider should display that shared value; when lines differ, its readout should indicate a mixed state until the operator adjusts it.
- The preview area should include non-exported guide geometry for the active size guide, and the rendered design should be centered within the active maximum rectangle on screen.
- The preview guide should show both the active size guide's maximum rectangle and minimum rectangle, matching the box guide style.
- The preview guide should include a non-exported centered circle only when the active size guide defines a circle diameter. The default 2.2 inch by 1.5 inch guide uses a 1.25 inch circle; guides with no circle diameter should render no circle.
- The preview guide should use thin solid `rgb(12, 150, 217)` strokes instead of dashed strokes.
- The outer preview box, optional centered circle, and inner reference lines should all use a `0.05px` stroke in the on-screen preview.
- The preview guide should include four inner reference lines, with one inset vertical line near each side and one inset horizontal line near the top and bottom, matching the production reference template.
- The two inner vertical guide lines should be 1.6 inches apart.
- The two inner horizontal guide lines should be 1.1 inches apart.
- The preview should center the visible text geometry within the guide box, even when the backing border extends beyond the guide area.
- The active preview guide box should remain visible even when there is no active text.
- The preview guide box should show dimension labels for the active size guide outside the box.
- Preserve legibility while minimizing separate acrylic pieces.
- The `Backing Border` slider must remain a single global control for the whole design rather than a per-line control.
- The global `Backing Border` slider should appear below all per-line control groups.
- Export designs as SVG for current production use.
- SVG export must produce vector path definitions, not embedded raster image data.
- Exported SVG face and backing paths must use a solid fill color of RGB(255, 0, 0).
- When imported Etsy color metadata is available, exported SVG output must add a small `Arial` color-value label to the right of the backing layer for each exported design instance.
- The exported color label should contain only the imported color value, not the word `Color` or any quantity text.
- When `Weld Exported Design` is checked, exported face-layer paths must be welded/unioned so overlapping letters do not create internal cut lines.
- When `Weld Exported Design` is unchecked, SVG export may preserve overlapping letter contours without welding so the overlaps remain visible and editable.
- Keep layout and geometry logic separated from UI code so geometry behavior can be tested independently.
- Represent units explicitly and clearly distinguish inches from millimeters and any internal geometry units.
- Add tests around geometry behavior as implementation matures, especially for connectedness detection and overlap behavior.
- Keep the first screen focused on the layout tool itself rather than a landing page.

## Test Requirements

- Treat testing as a production requirement, not a later cleanup task.
- Keep geometry, layout, and export logic separated from UI code so those behaviors can be tested directly without depending on browser rendering.
- Add automated tests for geometry behavior whenever geometry logic changes in a way that could affect manufacturability, layout correctness, or export output.
- Prioritize automated test coverage for connectedness detection, neighboring glyph overlap behavior, multi-line overlap behavior, backing silhouette generation, explicit unit conversion, and SVG export path correctness.
- Prefer deterministic test inputs and assertions so geometry regressions can be caught reliably across environments.
- When a change affects the UI, the agent must verify the affected workflow in a browser before considering the work complete.
- Browser-based UI verification is required for any user-facing layout, control, preview, batch, import, save, or export interaction that was changed.
- Browser UI verification should confirm both behavior and presentation, including control visibility, control state changes, preview updates, and basic usability of the modified flow.
- Browser UI verification may be supported by automated browser tests, manual browser checks, or both, but some direct browser validation is required whenever UI changes are made.
- If browser-based UI verification cannot be completed for a UI change, that limitation must be reported clearly along with the reason it could not be performed.
- Local Playwright runs should default to the current checkout or worktree's own dev server URL rather than silently inheriting a preview deployment URL from `.env.local`.
- Preview-targeted Playwright runs should be an explicit opt-in workflow so multiple local worktrees can run browser tests on the same machine without colliding or accidentally testing the wrong deployment.

## Current Production Workflow Requirements

- Support entering or pasting multiple Etsy orders into a session so the user can work through them one at a time.
- Support adding Etsy orders one at a time because the Etsy orders page may not provide an easy way to copy all customer names at once.
- Make order boundaries explicit so a two-line order, such as a name plus credentials, cannot be confused with two separate one-line orders.
- Use a left-side order navigation area for the Etsy order list.
- Selecting an order from the left navigation should show that order's text editing screen on the right.
- Show no active order editor before an order has been added.
- Clicking Add Order should immediately add a new row to the left-side order list, select that order, and show the editor on the right.
- The selected-order editor should focus on editable design text and layout settings rather than a separate editable design-label field.
- Allow each order to store its own customer text and layout settings, including letter bridge, line bridge, text height, backing border, and guide visibility.
- Provide a way to save the current preview and settings for the active order before moving to the next order.
- Clicking `Save` should immediately save the active design text and layout settings, mark the batch item complete, and disable both primary save buttons until the design changes again.
- Clicking `Save` should also start face analysis and cache the export-ready geometry tied to that completed state in the background without advancing to another design.
- Clicking `Save & Next` should perform the same save, complete, and background-analysis work as `Save`, then advance immediately to the next batch item that is not already complete or exported when one exists while caching and production-batch persistence continue in the background.
- The selected-order `Save` button state should depend only on whether the active design has unsaved text or layout changes, not on whether background analysis and export-geometry caching have finished.
- Show which orders are not started, in progress, complete, or exported so a batch of orders can be completed without losing track.
- The production batch should show a compact per-design face-analysis indicator: a small spinner while background analysis is running, a checkmark when the completed face layer is one connected piece, or a warning sign with the compact piece count when the completed face layer has multiple disconnected pieces.
- Allow saved orders to be reopened for adjustment without losing their previously saved settings.
- The active order editor should include a button for exporting the selected design as an SVG.
- The active order editor should also include a button near `Export This Design` for copying the current design's generated SVG to the clipboard.
- The left-side order navigation should include a button above the order list for exporting all batched designs that have text entered.
- The left-side order navigation should also include a button near `Export All Designs` for copying the generated batch SVG for all batched designs with text to the clipboard.
- Export and copy actions should use the most recently saved analyzed geometry for each design rather than running fresh analysis implicitly.
- Orders with unsaved layout changes should be completed again before they can be exported or copied.
- Batch export should export every batched order that has text entered after each of those orders has been explicitly completed and analyzed.
- Batch export should skip blank orders rather than producing empty geometry for them.
- Export should treat imported Etsy quantity as the number of copies to place in the SVG output for that design.
- When quantity is greater than `1`, the export should repeat that design the requested number of times, stacked vertically using the same production pitch as other exported designs.
- Support importing Etsy order data from a seller orders page export so production sessions do not require manual retyping.
- The first Etsy import target should accept an Etsy orders HTML save exported from the browser.
- The repository docs folder includes a sample Etsy orders HTML export at `docs/Orders - Etsy.html` for import development and testing.
- The import pipeline should extract at minimum the Etsy order number, the Etsy listing ID, and every Personalization text value present on each order line item.
- The import pipeline should treat Etsy `transaction_id` as the preferred line-item identity when it is available, because one Etsy order can contain multiple personalized line items with the same order number.
- The import pipeline should also extract the Etsy `Color` variation value when it is present on the line item and store it with the imported design metadata.
- The import pipeline should also extract the Etsy line-item quantity when it is present and store it with the imported design metadata.
- The import pipeline should prefer the embedded Etsy page data model when available rather than relying only on visible DOM scraping, because the saved page includes structured order and transaction data.
- The import flow should support a browser-side helper path, such as a User JavaScript and CSS script, that can copy structured order payloads directly from the live Etsy orders page.
- The first import implementation should use a clipboard workflow driven by a User JavaScript and CSS helper on the live Etsy orders page.
- The repository docs folder includes a sample clipboard payload at `docs/sample-clipboard.txt` for clipboard-import development and testing.
- Imported listing IDs should be usable to auto-select the app preset for each imported order.
- Imported Etsy listing metadata should include the listing title and the 75 by 75 listing image URL when those fields are present in the Etsy order data.
- The app should maintain a configurable mapping from Etsy listing ID to production preset name.
- The current preset mapping must include Etsy listing ID `1884223710` to `Skywalk, Somekind`.
- Etsy listing ID `1884223710` must also apply a listing-specific per-line default of `21 mm` text height on line 2 while keeping the rest of the `Skywalk, Somekind` preset defaults unchanged.
- The current preset mapping must include Etsy listing ID `4439916732` to `Candlepin, Skywalk`.
- Etsy listing ID `4439916732` must also apply a listing-specific per-line default of `44 mm` text height on line 1 while keeping the rest of the `Candlepin, Skywalk` preset defaults unchanged.
- The current preset mapping must include Etsy listing ID `4465975709` to `Skywalk, Candlepin`.
- Etsy listing ID `4465975709` must also apply a listing-specific per-line default of `21 mm` text height on line 2 while keeping the rest of the `Skywalk, Candlepin` preset defaults unchanged.
- Imported Etsy data should create one order item per personalized Etsy line item rather than one order item per Etsy order.
- Because one Etsy order may create multiple order items, user-facing batch and editor language should refer to designs, order items, or batch items rather than assuming one row always equals one Etsy order.
- Imported batch items should display as exactly four text lines: line 1 the Etsy order number, line 2 `Buyer: <buyer name>`, line 3 `Listing: <listing title>` truncated when needed, and line 4 `Personalization: <personalization>` using the same row text styling as the other metadata lines except for a larger font size.
- Re-importing a later Etsy batch must preserve any order items already present in the current production batch instead of overwriting them.
- During import, any Etsy line item that already exists in the current production batch should be skipped so the operator can import only newly arrived orders into the same working batch.
- Imported order items and subsequent design edits should persist across a browser refresh through Supabase Postgres during the current batch workflow.
- Batched designs must be automatically available across browsers and locations for authorized users without requiring a manual export or import handoff step.
- Shared batch state should use Supabase Postgres as the source of truth instead of treating browser local storage as a saved record.
- The hosted batch solution should use Supabase Postgres for authentication-aware, structured shared records and a practical path to live multi-browser updates.
- Batch ownership should belong to a shared workspace or operational batch context rather than to an individual user account.
- Authenticated users should control access to shared production batches and provide audit history, but user accounts should not own the batch, order-item, design, preset, or size-guide data model.
- Shared storage should use a Supabase-backed design with shared workspace batches, authenticated access, and room for future realtime updates.
- Shared batch access should require authenticated operator sessions rather than anonymous browser access.
- The first in-app production-batch authentication flow should use Supabase Auth with invite-only operator accounts and email-plus-password sign-in.
- The operator UI should not expose self-service sign-up for production batch access.
- Shared batch API requests should carry the browser's authenticated session token, and server routes should verify that token before loading or saving shared production data.
- Server-side shared batch authorization should resolve the signed-in operator's workspace membership and populate request auth context from verified identity rather than trusting browser-supplied workspace ids directly.
- On startup, the app should load the current production batch, order items, designs, presets, and size guides from Supabase Postgres. Browser local storage must not be used as a source of truth for production data.
- While the app is initially loading shared production data, the production workspace should show an immediate visual loading state, such as skeleton placeholders, so operators can tell Supabase data is still being fetched.
- The browser must not silently prefer stale local batch data over newer shared hosted batch data.
- Ordinary local text and layout edits must not publish to Supabase until the operator explicitly clicks `Save` or `Save & Next`.
- After a shared-batch revision conflict, the operator workflow should present only two paths: save again from the current editor state to overwrite the shared version, or reload the shared version and discard the preserved local draft.
- If required Supabase batch configuration is missing, the app should show a clear blocked configuration error state instead of silently falling back to local-only persistence.
- If no valid authenticated shared-batch session is present, the app should show an operator sign-in state instead of attempting anonymous batch access or local-only fallback.
- When a shared batch session is active, the app should provide a visible operator `Logout` action so the current browser can end its Supabase session.
- If a previously valid authenticated shared-batch session expires or is revoked, shared autosave should pause and the app should require sign-in again before shared writes resume.
- Batch persistence should use first-class shared records for workspaces, production batches, batch items, order items, designs, and design lines so collaboration and audit behavior can evolve cleanly.
- Production data must be stored relationally in Supabase Postgres rather than in browser local storage or JSON snapshot blobs.
- The durable business object is an `order_item`. Each order item has one current `design` that stores its badge-reel artwork/layout state.
- Operators should create a `production_batch` from a subset of order items, produce that batch, and then move on to a new batch.
- A production batch should contain order items through `batch_items` so an order item can appear in later remake, rework, replacement, or test batches without losing its original order-item history.
- Presets and size guides must be stored in Supabase Postgres and shared across environments for the authenticated workspace.
- Presets should be stored as relational preset records plus line-rule records rather than one browser-local or remote JSON snapshot.
- Size guides should be stored as relational size-guide records rather than inside a preset snapshot blob.
- Storage and API contracts should use batch/order-item terminology directly; legacy batch-shaped snapshot contracts should be removed even when that requires recreating presets, size guides, or in-progress batch data from scratch.
- The app should support saving the current production batch to Supabase so the current batch can be restored on another browser.
- Persisted batch-item data should include enough information to restore the batch, the selected design, imported Etsy metadata, current text, current per-line settings, backing border, weld toggle, and saved/exported status after refresh.
- Persisted design data must include the completion state metadata needed to restore a saved design as complete in another browser, including its saved settings signature, completed settings signature, cached analyzed build, previous completed build when relevant, and face-analysis badge state.
- Persisted shared-batch data should also include batch identity, batch membership in a workspace, `updatedAt`, `updatedBy`, and a revision or version field for each design so stale writes can be detected.
- Shared batch editing should support one person creating a batch and another person opening and continuing that same batch later.
- The collaboration model should support multiple authorized users in the future, but the first version may use lightweight edit ownership, presence, or stale-write detection instead of full simultaneous freeform co-editing.
- The UI should show enough shared-state context for operators to avoid accidental overwrites, including at minimum who last updated a design and when.
- Remote pre-production testing should support a Vercel preview deployment paired with a non-production Supabase environment such as a Supabase preview branch or staging project.
- The repository should keep Supabase schema changes in versioned migration files so preview branches and future production promotions can reproduce the production batch backend reliably.
- In the selected-order editor, show the imported Etsy color as a read-only label directly below the `Design Text` field whenever imported color metadata is available.
- In the selected-order editor, show the imported Etsy quantity as a read-only label directly below the `Color` label whenever imported quantity metadata is available.
- If the imported color name contains the word `White`, highlight that displayed color name in the editor.
- The app should provide a batch action to delete a single design without affecting the rest of the current batch.
- The app should provide a batch-reset action to clear all batchd and persisted designs when the operator is ready to start a new batch.
- Clearing all designs should also clear the corresponding hosted saved batch data in Supabase.
- In the selected-order editor, when imported listing title and 75 by 75 image data are available, show the listing title above the listing image and place both above the main text-entry controls.
- SVG export should place the face text layer and offset backing layer side by side, with the backing layer to the right of the text layer.
- In batch export SVG output, each order's face and backing paths should appear below the previous order's paths in a single vertically stacked file.
- In batch export SVG output, each design should start about `2.03 inches` below the top of the previous design so stacked exports use a tighter, more consistent vertical pitch.
- In batch export SVG output, each order's text path should be grouped separately from its backing path so the name can be selected as one group without including the backing border.
- Copied and exported SVG output should emit each design instance as three separate top-level selectable objects: one grouped name object, one backing-border path object, and one color-label text object when color metadata is present.
- The exported backing layer should be an actual outline path for LightBurn, not only a filled shape or SVG stroke effect. The path can be imported and manually assigned to a LightBurn cut layer.
- Exported face-layer paths should also be welded/unioned so overlapping letters do not create internal cut lines.
- Exported cut paths should be smooth enough for laser production and should avoid visibly pixelated/stair-stepped contours.
- Exported cut paths should also avoid excessive vertex counts by applying conservative path simplification that reduces tiny traced stair-steps without materially changing the underlying outline shape.
- Layout analysis and export should not fail when a batched text token contains more than one Unicode code point; when direct outline lookup cannot represent a token, the export pipeline should fall back to traced token geometry instead of crashing the design row.

## Later-Phase Workflow Enhancements

Future-facing product ideas and optional later-phase workflow enhancements are tracked in [future-features.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/future-features.md:1).

## Current Assumptions And Pending Decisions

- The first production export target is SVG for LightBurn-oriented laser workflows.
- The current shop connection to the OmTech Polar is USB, not Ethernet.
- The first production font formats are OTF and TTF, matching the currently available Candlepin, Skywalk, and Somekind assets.
- The current production workflow is manual-control-first. Operators must be able to adjust letter bridge, line bridge, per-line font, horizontal offset, text height, and backing border directly.
- Operators will sometimes need to increase a line's apparent height without increasing its width. Treat that as a per-line geometry setting rather than a preview-only effect so preview, analysis, and SVG export stay aligned.
- The current implementation target is global and per-line controls rather than per-character-pair tuning.
- Preset configuration should be maintainable by editing data files with a well-defined schema rather than updating multiple hardcoded branches.
- Multi-line layouts should support intentional contact between lines, and for Candlepin layouts each lower line should slide upward until the visible outlines reach the configured line-bridge target.
- The backing layer should be generated automatically as an offset silhouette in the production tool rather than remaining a preview-only approximation.
- The active maximum guide box defines the text fitting target, not the total finished backing size limit. The current default maximum guide box is 2.2 inches by 1.5 inches.
- The active minimum guide box is a visual/design constraint for the selected size guide and should be shown in preview alongside the maximum guide box.
- A production-safe minimum bridge width for 1/8 inch acrylic still needs explicit shop confirmation. Until confirmed otherwise, use 0.5 mm as the working default bridge target for Candlepin letter and line connections.
- If direct Ruida support is pursued, prefer USB as the first transport path for this shop because the machine is currently USB-connected and because the current production workflow does not need to depend on Ruida Ethernet/UDP behavior.
- The initial hosted deployment target is Vercel.
- Vercel Deployment Protection may remain enabled as an outer deployment guard, but it must not substitute for in-app operator authentication on production batch routes.
- The first shared-backend bootstrap may seed one primary workspace and one primary batch so the first invited operator membership has an immediately usable shared batch to open.
- A production deployment must include the real production font assets used for preview, analysis, and export. A deployment flow that omits those font files is not production-ready.
- The production font assets are allowed to be included in the deployed app and served from the deployed `public/fonts` path.
- Production deployment must preserve the geometry analysis and SVG export pipeline in a way that remains deterministic between local use and hosted use.
- If the hosted runtime cannot reliably execute the current Python-based geometry pipeline with its required dependencies, the deployment plan must move that pipeline to a supported service or rewrite it into a Vercel-supported runtime before launch.

## Deployment Readiness

- Treat the client editor, font assets, geometry analysis endpoint, and SVG export endpoint as one production system. Deployment is only ready when all four work together in the hosted environment.
- Hosted preview must load the production fonts successfully so layout decisions match the real manufacturing fonts.
- Hosted analysis and export must run against the same production font files used by the preview so connectedness checks and exported paths stay trustworthy.
- The initial Vercel deployment shape is static frontend assets served from a `dist` build output plus Python API functions for `/api/layout-analyze` and `/api/export-svg`.
- The Vercel Python runtime should be aligned explicitly with Python 3.14 unless Vercel project settings support selecting an older Python runtime reliably.
- The Python runtime compatibility range should be declared in both `.python-version` and `pyproject.toml` because Vercel's current Python builder uses `uv` during dependency installation.
- The Vercel Python function dependency set should stay small enough for serverless bundle limits. The current geometry pipeline depends on `fonttools` and `Pillow`; connectedness and hole filling should avoid heavyweight numeric packages unless the geometry service moves off Vercel Functions.
- Vercel Python functions cannot assume CDN/static font assets are present on the function filesystem. If bundled font lookup fails, the geometry pipeline should fetch the same deployed `/public/fonts/...` asset from the request host and cache it in temporary function storage so hosted analysis and SVG export still use the production fonts.
- When Vercel Deployment Protection is enabled, hosted analysis and export must preserve the request's protection context for any internal font asset fetches so the geometry pipeline does not fail with protected-preview 401 responses.
- Deployment configuration should explicitly define the production install, build, and runtime behavior instead of relying on local-only defaults.
- Production should have a smoke-test flow that verifies font loading, batch persistence, save-triggered analysis, and SVG export in the hosted environment before operators rely on it for Etsy batches.
- Before processing real Etsy order data in production, the hosted app should require in-app authenticated operator access for production batch features.
- For the current internal production rollout, enable in-app operator authentication before processing real Etsy order data, and keep Vercel Deployment Protection enabled if it remains operationally helpful.
- Automated checks against a protected Vercel preview should use Vercel Protection Bypass for Automation so smoke tests can keep Deployment Protection enabled while still exercising the hosted UI and API routes.
- Local development and browser automation should share one deterministic per-worktree port-resolution helper so multiple git worktrees can run in parallel without port collisions or hardcoded test URLs drifting from the local server.
- In the current Windows Codex worktree environment, local server launch workflow should prefer a foreground or otherwise persistent terminal session over a detached hidden process, because detached launches may exit early and break browser connectivity.
- When the operator asks Codex to `finish this worktree`, Codex should treat that as the standard post-feature workflow: merge latest `main` into the current worktree and resolve conflicts, run appropriate verification, commit the worktree changes to the current feature branch, merge that feature branch into `main`, and push `main`.

## Open Questions

- What named size guides should ship first, and what minimum and maximum rectangle dimensions should each guide use?
- Should the minimum rectangle be advisory-only in preview, or should the tool warn when the finished text/backing silhouette is smaller than the minimum rectangle?
- Beyond the active text guide area, what maximum finished badge reel face plate dimensions should the tool enforce?
- What minimum stroke/bridge width is safe for 1/8 inch acrylic after shop validation?
- Do Skywalk and Somekind need different default bridge or scaling presets than Candlepin?
- What additional export conventions, if any, are needed for the exact LightBurn import workflow used in production?
- What exact listing ID to preset mappings should the first import implementation ship with?

## Design Direction

The website should be a practical production tool rather than a marketing site. In the current production phase it should prioritize:

- Fast order entry.
- Batch order workflow for Etsy sessions.
- Clear preview of cut layers.
- Reliable geometry checks.
- Simple controls for adjusting overlap, line spacing, horizontal positioning, scale, and per-line font choice.
- Export-ready output for production use.
- A two-pane master-detail layout, with order navigation on the left and the selected order editor on the right.
- On a standard 1920 by 1080 production monitor, the selected-order editor must keep the preview meaningfully visible while also keeping the first two line-control groups available without hiding the preview below the fold.
- On desktop, the left batch panel should use roughly the leftmost quarter of the screen instead of the previous narrow column, so batch rows can show more order context without taking over the editor workspace.
- The left batch panel should keep only `Complete` and `In Progress` summary counters visible in the main panel; `Not Started` does not need a visible counter in the desktop layout.
- Batch actions should move behind a compact batch-tools affordance beside the `Production Batch` title instead of occupying a permanent full-width button block above the list.
- The batch-tools menu should include a `View Color Counts` action that opens an in-app popup summarizing the entire batchd batch's imported colors in a table, using imported quantity when available and otherwise counting each batched design as one.
- After `Import Clipboard` runs, its status message should appear as a floating toast instead of only inside the batch-tools popup.
- All lightweight workflow alerts, confirmations, warnings, and errors should use a floating toast pattern so they do not insert cards into the editor layout or shift the page.
- Layout-control copy and paste feedback should use that same floating toast pattern instead of introducing a separate notification style.
- Future lightweight workflow confirmations and warnings of this kind should reuse the same floating toast technique so batch actions, copy/paste actions, save confirmations, and similar operator feedback stay visually consistent.
- Production batch stale-design conflicts and shared-sync warnings should use the same floating toast pattern. A stale-design alert should only show for the affected batch row and should say `A newer version of this design has been saved.` with a `Load Latest Design` action. The editor should not show a persistent production-batch status card just to say the batch is connected.
- Once a stale-design conflict is detected, the app must not send any further production-batch saves, including background autosaves caused by row selection, until the operator clicks `Load Latest Design` or otherwise reloads the latest production batch state.
- Under the selected-order header action row on desktop, the content area should split into two main columns.
- The left editor column should contain the imported listing details, imported color and quantity, the `Design Text` field, and the preview with connectedness status.
- In the selected-order editor, the `Design Text` title and textarea should use slightly larger type than the surrounding compact controls so entered personalization is easier to read while editing.
- The right editor column should begin with the `Preset` card, and `Copy Layout` plus `Paste Layout` should live in that card's ellipses menu rather than a separate utility row.
- The selected-order editor should split preset selection and global layout settings into two separate cards titled `Preset` and `Global Settings`.
- The `Preset` card should contain the preset dropdown, while its ellipses menu should contain `Copy Layout`, `Paste Layout`, `Save as New Preset`, `Overwrite`, `Assign Preset to Listing`, and `Reload preset`.
- The preset dropdown label in the `Preset` card should read `Preset Name`.
- The `Preset` card should include a `Reload preset` button at the bottom that reapplies the currently selected preset and overwrites all current layout settings for the active design with that preset's current values.
- The `Global Settings` card should contain `Weld Exported Design`, `Size Guide`, global `Horizontal Stretch`, global `Vertical Stretch`, and `Backing Border`, followed by the per-line controls for `Line 1`, `Line 2`, and any additional lines.
- The selected-order editor should also provide an `Assign Preset to Listing` action when the active order has an imported Etsy listing id.
- The `Assign Preset to Listing` action should assign the currently selected preset to that listing id by updating the preset's listing assignments.
- A preset may be linked to multiple Etsy listing ids.
- A single Etsy listing id should be linked to only one preset at a time.
- When an operator attempts to link an Etsy listing id that is already linked to a different preset, the app must show an explicit confirmation before moving the listing id to the new preset.
- If the operator approves moving a listing id link, the app should remove that listing id from the previous preset and keep the selected preset's other listing assignments intact.
- When the active order's imported listing id is assigned to the selected preset, the `Preset Name` label should show a compact inline `Linked` indicator without adding another row to the preset card.
- When the active order's imported listing id is assigned to a different preset than the currently selected preset, the `Preset Name` label should show a compact inline warning that the listing is assigned elsewhere.
- After `Assign Preset to Listing` succeeds, the app should open a confirmation dialog that clearly states which preset was assigned to which Etsy listing so operators do not need to infer success from subtle status text alone.
- The preset-assignment confirmation dialog should present as an explicit success state, including a green treatment and a visible checkmark.
- In the selected-order workspace, the preview should remain the dominant element in the left column, with connectedness status directly below the preview instead of in a separate full-width row above it.
- The connectedness status card below the preview should show the same left-side face-analysis indicators used in the batch row: spinner while completed-layout analysis is running, checkmark for one connected face piece, and warning plus compact piece count for multiple disconnected face pieces.
- In the selected-order workspace, the per-line controls should sit in a narrower right-side rail and should stack one line card per row instead of showing line cards side by side.
- The right-side control rail should own its own vertical scrolling so additional line-control groups remain reachable as operators add more text lines.
- Each per-line control group should clearly map to a specific entered text line and should appear or disappear as the number of entered lines changes.
- The first text line should not show a `Line Bridge` control because there is no line above it to connect to.
- The left-side production batch should show only meaningful Supabase sync statuses.
- The selected-order header should hold the primary order actions in this order: `Save`, `Save & Next`, and `Cancel`.
- The selected-order header should place `Copy This Design` and `Export This Design` behind a compact ellipsis tools menu instead of keeping them as always-visible primary actions.
- The selected-order header should not hold the layout-copy utility actions; those actions should live in the right controls column above the `Presets` card so they read as layout tools rather than primary order actions.
- The layout-copy utility actions should be labeled `Copy Layout` and `Paste Layout`.
- `Copy Layout` should capture only layout-related settings from the currently selected design.
- `Paste Layout` should apply the copied layout settings to the currently selected design when the selected design is different from the copied source design.
- Copying or pasting layout controls must not copy order text, quantity, buyer metadata, listing metadata, completion state, saved export data, or cached analysis results.
- Pasting layout controls should copy all global layout settings, including preset selection, weld-export setting, backing border, and global stretch settings, plus every existing line's per-line layout settings such as font choice, letter bridge, line bridge, offsets, text height, horizontal stretch, vertical stretch, and `Lock Text Height`.
- When the copied source and target design have different text-line counts, pasted layout controls should apply line by line only for matching line indexes and should leave unmatched target lines unchanged.
- After pasting layout controls, the target design should be treated as changed, any saved completed/export-ready state should be cleared for that design, and the operator should need to complete it again so fresh analysis and export data are produced.
- The preset editor should use the same practical visual language as the existing global and per-line layout controls rather than exposing raw JSON by default.
- The preset editor should use a master-detail workspace: one column for selecting the preset to edit, and one column for editing that preset.
- The `Size Guides` workspace should include a dedicated place to create, view, and edit named maximum and minimum rectangles.
- The preset editor should allow selecting an existing preset, editing its metadata and reusable layout defaults, and saving those changes back to the preset definition.
- Preset ids should be opaque random identifiers generated by the app, remain stable after creation, and not be shown or edited in the operator UI.
- The preset editor should provide a `New Preset` action that starts from a blank or inferred preset draft and can be saved as a new schema-valid preset file and manifest entry.
- The preset editor should represent reusable line settings through operator-friendly sections for `Line Defaults`, `First Line`, `Remaining Lines`, and any exact-index line overrides that exist for that preset.
- The preset editor should show the Etsy listings currently assigned to the selected preset.
- The preset editor should allow unassigning individual listing ids from the selected preset.
- The preset editor should allow deleting a saved preset from the `Presets` workspace.
- Deleting a preset must require an explicit in-app confirmation dialog before the preset is removed.
- The selected-order header action buttons should remain visibly smaller than the preview and top-card content so they do not dominate the editor visually on desktop.
- The app favicon should use bold enlarged white `TFU` lettering with a red outline around the letters themselves, prioritizing legibility in a browser tab at favicon size over decorative detail.
- Command buttons should use one shared enabled color, one shared disabled color, and one shared enabled-hover color across batch tools, editor actions, export/copy/save/complete actions, and destructive actions. Non-command row-selection buttons may remain visually neutral.
- Command buttons should share the same pill-shaped radius as the batch header `Paste` button so the action language stays visually consistent.
- Command buttons should also provide a visible pressed state when clicked or tapped so operators get immediate tactile confirmation that the action was engaged.
- The pressed state should follow the same shared interaction language across batch tools, editor actions, export/copy/save/complete actions, and destructive actions rather than being tuned separately per button family.
- The pressed-state feedback should stay practical and restrained for the production-workspace tone: a darker pressed color, slightly stronger border or inset feel, and a subtle downward movement are preferred over flashy animation.
- Keyboard focus-visible styling should remain distinct from the pressed state so accessibility feedback is not weakened while adding pointer/touch feedback.
- Destructive confirmations such as deleting one batched design or clearing the full batch should use a styled in-app confirmation dialog rather than browser-default confirm popups.

The selected UI direction is the refined B1 Production Batch layout. Use `docs/mockups/layout-option-b-refined.html` as the primary visual reference for the current desktop implementation pass. The mockup intent is a left-side order-item batch panel with compact batch tools and a right-side two-column editor where the left column holds listing details, design text, and preview while the right column holds global controls plus stacked line controls. Sample renders should use a white raised text layer over a red backing silhouette.

For batch Etsy order sessions, the preferred workflow is:

1. Click Add Order to create a new blank order row in the order-item batch panel.
2. Enter or paste the customer text in the selected-order editor. The order text may contain multiple lines.
3. Adjust the text layout using the existing preview and sliders.
4. Save the layout for that order, saving both text and slider settings while analysis continues in the background.
5. Automatically advance to the next unsaved order.
6. Review the order list before export.
7. Export the active order SVG from the editor.
8. Export all batched orders with text from the order navigation when a batch SVG is needed.
9. Delete a single batch item when it should be excluded from the batch.
10. Clear the full batch and its saved local batch state when starting a new batch.

- Clicking `Save` should immediately mark the current design as finished for editing, even if connectedness analysis is still running in the background.
- After clicking `Save`, both `Save` and `Save & Next` should stay disabled for that design until the operator changes the text or layout settings again.
- The selected-order `Cancel` button should stay disabled until the active design has unsaved changes relative to its last saved shared design state.
- Clicking `Cancel` should restore the active design text and layout settings to the last saved shared design state without publishing a new production batch revision.
- The `Save & Next` button should be disabled whenever there are no other batched designs that are still incomplete.
