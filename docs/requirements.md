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
- The `Presets` dropdown must offer exactly these production presets: `All Candlepin`, `Skywalk, Somekind`, and `Skywalk, Candlepin`.
- The `All Candlepin` preset must set every text line to the Candlepin font.
- The `Skywalk, Somekind` preset must set the first text line to Skywalk and every subsequent line to Somekind.
- The `Skywalk, Candlepin` preset must set the first text line to Skywalk and every subsequent line to Candlepin.
- Selecting a preset must overwrite all current per-line settings for the order so every line resets to the preset's predefined values, including font, letter bridge, line bridge where applicable, horizontal offset, and text height.
- Allow font selection per line of text.
- Provide one control group per text line.
- Each per-line control group must include a Font dropdown, Letter Bridge slider, Horizontal Offset slider, and Text Height slider.
- Each per-line control group after the first must also include a Line Bridge slider for controlling the connection to the line above it.
- Add or remove per-line control groups automatically as the user adds or removes text lines.
- Remove the current non-functional `Font (Line 1)` and `Font (Line 2)` dropdowns from below the order text field once the per-line control groups exist.
- Allow controlled overlap between adjacent letters.
- Treat 0.5 mm as the current default target for the connecting tab or bridge between neighboring letters in Candlepin layouts.
- Allow controlled overlap or contact between multiple text lines.
- Treat 0.5 mm as the current default target for the connecting bridge between neighboring lines in Candlepin layouts.
- For multi-line Candlepin layouts, slide each lower line upward until the actual visible line shapes overlap by the configured line-bridge target.
- Center multi-line layouts by each line's actual visible shape bounds, not by rough text boxes or font advance widths.
- The rendered text geometry must fit within 2.2 inches in width and 1.5 inches in height.
- Scale the text proportionally to make the best use of the available size limit, scaling up or down as needed so the text fills as much of the allowed space as possible while still staying within 2.2 inches wide and 1.5 inches tall.
- The backing border does not need to fit within the 2.2 inch by 1.5 inch text guide limit and may extend beyond it.
- Detect whether text geometry is connected as a single piece.
- Show a visual preview of the text and backing layer.
- Keep the live on-screen preview fast and responsive while the user types or adjusts controls.
- The live editing preview may use a faster browser-rendered path than the export pipeline, as long as it stays visually trustworthy for layout decisions.
- Connectedness checks and other heavier geometry analysis may run asynchronously in the background so they do not block interactive editing.
- When a design's settings have not changed, the app should reuse its most recently analyzed export-ready geometry for queue revisit and SVG export instead of recomputing the same layout and paths again.
- Add a `Weld Exported Design` checkbox directly below the order text field.
- The `Weld Exported Design` checkbox must default to checked.
- The preview area should include a non-exported 2.2 inch by 1.5 inch background guide box, and the rendered design should be centered within that box on screen.
- The preview guide should include a non-exported 1.25 inch dashed circle centered inside the 2.2 inch by 1.5 inch guide box, matching the box guide style.
- The preview should center the visible text geometry within the guide box, even when the backing border extends beyond the guide area.
- The 2.2 inch by 1.5 inch preview guide box should remain visible even when there is no active text.
- The preview guide box should show static dimension labels outside the box: `2.2"` centered above and `1.5"` on the right side.
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
- Browser-based UI verification is required for any user-facing layout, control, preview, queue, import, save, or export interaction that was changed.
- Browser UI verification should confirm both behavior and presentation, including control visibility, control state changes, preview updates, and basic usability of the modified flow.
- Browser UI verification may be supported by automated browser tests, manual browser checks, or both, but some direct browser validation is required whenever UI changes are made.
- If browser-based UI verification cannot be completed for a UI change, that limitation must be reported clearly along with the reason it could not be performed.

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
- Show which orders are not started, in progress, saved, or exported so a batch of orders can be completed without losing track.
- Allow saved orders to be reopened for adjustment without losing their previously saved settings.
- The active order editor should include a button for exporting the selected design as an SVG.
- The active order editor should also include a button near `Export This Design` for copying the current design's generated SVG to the clipboard.
- The left-side order navigation should include a button above the order list for exporting all queued designs that have text entered.
- The left-side order navigation should also include a button near `Export All Designs` for copying the generated batch SVG for all queued designs with text to the clipboard.
- Batch export should export every queued order that has text entered, even if it has not been explicitly saved first.
- Batch export should skip blank orders rather than producing empty geometry for them.
- Export should treat imported Etsy quantity as the number of copies to place in the SVG output for that design.
- When quantity is greater than `1`, the export should repeat that design the requested number of times, stacked vertically using the same production pitch as other exported designs.
- Support importing Etsy order data from a seller orders page export so production sessions do not require manual retyping.
- The first Etsy import target should accept an Etsy orders HTML save exported from the browser.
- The repository docs folder includes a sample Etsy orders HTML export at `docs/Orders - Etsy.html` for import development and testing.
- The import pipeline should extract at minimum the Etsy order number, the Etsy listing ID, and every Personalization text value present on each order line item.
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
- The current preset mapping must include Etsy listing ID `4465975709` to `Skywalk, Candlepin`.
- Etsy listing ID `4465975709` must also apply a listing-specific per-line default of `21 mm` text height on line 2 while keeping the rest of the `Skywalk, Candlepin` preset defaults unchanged.
- Imported Etsy data should create one queue row per personalized Etsy line item rather than one row per Etsy order.
- Because one Etsy order may create multiple queue rows, user-facing queue and editor language should refer to designs or queue items rather than assuming one row always equals one Etsy order.
- Imported Etsy queue rows should display as exactly four text lines: line 1 the Etsy order number, line 2 the recipient or buyer name, line 3 the Etsy listing ID, and line 4 the personalization text.
- Re-importing a later Etsy batch must preserve any queue items already present in the current design queue instead of overwriting them.
- During import, any Etsy line item that already exists in the current design queue should be skipped so the operator can import only newly arrived orders into the same working batch.
- Imported queue items and subsequent design edits should persist across a browser refresh in local browser storage during the current batch workflow.
- Persisted queue-item data should include enough information to restore the queue, the selected design, imported Etsy metadata, current text, current per-line settings, backing border, weld toggle, and saved/exported status after refresh.
- In the selected-order editor, show the imported Etsy color as a read-only label directly below the `Design Text` field whenever imported color metadata is available.
- In the selected-order editor, show the imported Etsy quantity as a read-only label directly below the `Color` label whenever imported quantity metadata is available.
- If the imported color name contains the word `White`, highlight that displayed color name in the editor.
- The app should provide a queue action to delete a single design without affecting the rest of the current batch.
- The app should provide a batch-reset action to clear all queued and persisted designs when the operator is ready to start a new batch.
- Clearing all designs should also clear the corresponding persisted browser storage for that batch data.
- In the selected-order editor, when imported listing title and 75 by 75 image data are available, show the listing title above the listing image and place both above the main text-entry controls.
- SVG export should place the face text layer and offset backing layer side by side, with the backing layer to the right of the text layer.
- In batch export SVG output, each order's face and backing paths should appear below the previous order's paths in a single vertically stacked file.
- In batch export SVG output, each design should start about `2.03 inches` below the top of the previous design so stacked exports use a tighter, more consistent vertical pitch.
- In batch export SVG output, each order's text path should be grouped separately from its backing path so the name can be selected as one group without including the backing border.
- The exported backing layer should be an actual outline path for LightBurn, not only a filled shape or SVG stroke effect. The path can be imported and manually assigned to a LightBurn cut layer.
- Exported face-layer paths should also be welded/unioned so overlapping letters do not create internal cut lines.
- Exported cut paths should be smooth enough for laser production and should avoid visibly pixelated/stair-stepped contours.

## Later-Phase Workflow Enhancements

- Consider adding automatic bridge or spacing suggestions after enough production examples exist to validate them.
- Consider more granular overlap controls than the current per-line settings if real jobs show consistent edge cases.
- Consider broader import or export helpers beyond the current SVG-first LightBurn workflow once the first production flow is stable.

## Current Assumptions And Pending Decisions

- The first production export target is SVG for LightBurn-oriented laser workflows.
- The first production font formats are OTF and TTF, matching the currently available Candlepin, Skywalk, and Somekind assets.
- The current production workflow is manual-control-first. Automatic optimization may be added later, but operators must be able to adjust letter bridge, line bridge, per-line font, horizontal offset, text height, and backing border directly.
- The current implementation target is global per-line controls rather than per-character-pair tuning. More granular overlap controls may be considered later if real production jobs require them.
- Multi-line layouts should support intentional contact between lines, and for Candlepin layouts each lower line should slide upward until the visible outlines reach the configured line-bridge target.
- The backing layer should be generated automatically as an offset silhouette in the production tool rather than remaining a preview-only approximation.
- The 2.2 inch by 1.5 inch guide box defines the text fitting target, not the total finished backing size limit.
- A production-safe minimum bridge width for 1/8 inch acrylic still needs explicit shop confirmation. Until confirmed otherwise, use 0.5 mm as the working default bridge target for Candlepin letter and line connections.

## Open Questions

- Beyond the current 2.2 inch by 1.5 inch text guide area, what maximum finished badge reel face plate dimensions should the tool enforce?
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
- In the selected-order editor, the render/preview should occupy the top of the right side of the screen and the order editor controls should sit at the bottom.
- The selected-order controls should be organized as a stack of per-line control groups followed by one global `Backing Border` control.
- Each per-line control group should clearly map to a specific entered text line and should appear or disappear as the number of entered lines changes.
- The first text line should not show a `Line Bridge` control because there is no line above it to connect to.
- The selected-order header should hold the primary order actions, including `Save` and `Export This Design`, to reduce the height of the control area.

The selected UI direction is the Production Queue layout. Use `docs/mockups/production-queue-ui-mockup-preview-top-controls-bottom.png` as the primary visual reference for the next UI implementation pass. The mockup intent is a left-side order queue with a batch export button above the order list, and a right-side selected-order editor with the selected order preview at the top, controls docked at the bottom, and an Export This Design button. Sample renders should use a white raised text layer over a blue backing silhouette.

For batch Etsy order sessions, the preferred workflow is:

1. Click Add Order to create a new blank order row in the order queue.
2. Enter or paste the customer text in the selected-order editor. The order text may contain multiple lines.
3. Adjust the text layout using the existing preview and sliders.
4. Save the layout for that order, saving both text and slider settings.
5. Automatically advance to the next unsaved order.
6. Review the order list before export.
7. Export the active order SVG from the editor.
8. Export all queued orders with text from the order navigation when a batch SVG is needed.
9. Delete a single queue item when it should be excluded from the batch.
10. Clear the full queue and its saved local batch state when starting a new batch.
