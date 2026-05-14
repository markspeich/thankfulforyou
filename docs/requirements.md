# Badge Reel Design Layout Tool Requirements

## Project Objective

Create a website that helps lay out custom badge reel designs for Etsy orders.

The business sells custom badge reels. Each face plate is made from two layers of 1/8 inch acrylic cut by laser and solvent-welded together. The completed face plate is then solvent-welded to a badge reel.

## Primary Problem

The software must lay out customer-provided text in a selected font so the laser-cut acrylic uses as few separate pieces as possible.

The ideal result is that neighboring letters overlap slightly enough to form a single connected acrylic piece, while still preserving legibility and the intended font style.

## Product Stage

The application is moving forward as a production tool for preparing acrylic badge reel layouts while continuing to improve the geometry pipeline that drives layout accuracy and export quality.

The current product must support:

- Loading text outlines from a font and converting them into laser-friendly geometry.
- Adjusting letter positions so adjacent letters slightly overlap.
- Evaluating connectedness so the software can tell whether the text cuts as one piece or multiple pieces.
- Previewing the result in a way that resembles the final acrylic face plate.
- Exporting geometry suitable for laser cutting.

The initial production rollout starts with the modified Candlepin production font and a default bridge target of 0.5 mm between neighboring acrylic letter pieces. That target should remain adjustable.

The current browser-rendered preview confirms that the modified Candlepin font can be loaded and visually overlapped. However, browser text bounds are only an approximation. Some glyph pairs may appear close by bounding box while still failing to visibly touch. The layout engine should therefore evaluate neighboring glyphs by their actual visible shape, and eventually by vector outlines.

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
- The backing border should default to the metric equivalent of 0.125 inch, which is 3.175 mm.
- The backing layer should be a solid acrylic silhouette. Enclosed holes created by font counters or tiny gaps in the backing border should be removed from the backing plate.
- Multi-line layouts may intentionally overlap or touch between lines to help unify the design.
- Different lines in the same badge reel design may use different fonts.

## Materials And Manufacturing

- Acrylic thickness: 1/8 inch per layer.
- Process: laser cut acrylic, then solvent-weld layers together.
- Face plate: two acrylic layers welded together.
- Final assembly: face plate welded to a badge reel.
- Manufacturing constraint: small disconnected text pieces are undesirable because they require more cutting, handling, alignment, and welding.

## Early Functional Requirements

- Accept text input for a badge reel design.
- Support entering or pasting multiple Etsy orders into a session so the user can work through them one at a time.
- Support adding Etsy orders one at a time because the Etsy orders page may not provide an easy way to copy all customer names at once.
- Make order boundaries explicit so a two-line order, such as a name plus credentials, cannot be confused with two separate one-line orders.
- Use a left-side order navigation area for the Etsy order list.
- Selecting an order from the left navigation should show that order's text editing screen on the right.
- Show no active order editor before an order has been added.
- Clicking Add Order should immediately add a new row to the left-side order list, select that order, and show the editor on the right.
- The order label and order text should be editable only in the selected-order editor, not in the left-side order navigation.
- Allow each order to store its own customer text and layout settings, including letter bridge, line bridge, text height, backing border, and guide visibility.
- Provide a way to save the current preview and settings for the active order before moving to the next order.
- Show which orders are not started, in progress, saved, or exported so a batch of orders can be completed without losing track.
- Allow saved orders to be reopened for adjustment without losing their previously saved settings.
- Support choosing or loading a font.
- Support the three primary production fonts early: modified Candlepin, modified Skywalk, and Somekind.
- Render text as actual font outlines, not just browser text.
- Allow text to be arranged in one or more lines.
- Allow font selection per line of text.
- Allow controlled overlap between adjacent letters.
- Treat 0.5 mm as the current default target for the connecting tab or bridge between neighboring letters in Candlepin layouts.
- Allow controlled overlap or contact between multiple text lines.
- Treat 0.5 mm as the current default target for the connecting bridge between neighboring lines in Candlepin layouts.
- For multi-line Candlepin layouts, slide each lower line upward until the actual visible line shapes overlap by the configured line-bridge target.
- Center multi-line layouts by each line's actual visible shape bounds, not by rough text boxes or font advance widths.
- The rendered text geometry must fit within 2 inches in width and 1.5 inches in height.
- Scale the text proportionally to make the best use of the available size limit, scaling up or down as needed so the text fills as much of the allowed space as possible while still staying within 2 inches wide and 1.5 inches tall.
- The backing border does not need to fit within the 2 inch by 1.5 inch text guide limit and may extend beyond it.
- Detect whether text geometry is connected as a single piece.
- Show a visual preview of the text and backing layer.
- The preview area should include a non-exported 2 inch by 1.5 inch background guide box, and the rendered design should be centered within that box on screen.
- The 2 inch by 1.5 inch preview guide box should remain visible even when there is no active text.
- The preview guide box should show static dimension labels outside the box: `2"` centered above and `1.5"` on the right side.
- Preserve legibility while minimizing separate acrylic pieces.
- Prepare for future laser-cut export, likely SVG or another vector format.
- SVG export must produce vector path definitions, not embedded raster image data.
- The active order editor should include a button for exporting the selected order as an SVG.
- The left-side order navigation should include a button above the order list for exporting all queued orders that have text entered.
- Batch export should export every queued order that has text entered, even if it has not been explicitly saved first.
- Batch export should skip blank orders rather than producing empty geometry for them.
- SVG export should place the face text layer and offset backing layer side by side, with the backing layer to the right of the text layer.
- In batch export SVG output, each order's face and backing paths should appear below the previous order's paths in a single vertically stacked file.
- In batch export SVG output, each order's text path should be grouped separately from its backing path so the name can be selected as one group without including the backing border.
- The exported backing layer should be an actual outline path for LightBurn, not only a filled shape or SVG stroke effect. The path can be imported and manually assigned to a LightBurn cut layer.
- Exported face-layer paths should also be welded/unioned so overlapping letters do not create internal cut lines.
- Exported cut paths should be smooth enough for laser production and should avoid visibly pixelated/stair-stepped contours.

## Open Questions

- What font formats must be supported first?
- What laser cutter/software format is required for production output?
- What maximum badge reel face plate dimensions should the tool enforce?
- What minimum stroke/bridge width is safe for 1/8 inch acrylic?
- Should the app optimize automatically, or expose manual controls first?
- Should overlap be per-character-pair, global, or both?
- How should multi-line layouts be handled when lines need to connect to each other?
- Does the backing plate need automatic offset/outline generation in the current release?

## Design Direction

The website should be a practical production tool rather than a marketing site. It should prioritize:

- Fast order entry.
- Batch order workflow for Etsy sessions.
- Clear preview of cut layers.
- Reliable geometry checks.
- Simple controls for adjusting overlap, line spacing, and scale.
- Export-ready output for production use.
- A two-pane master-detail layout, with order navigation on the left and the selected order editor on the right.
- In the selected-order editor, the render/preview should occupy the top of the right side of the screen and the order editor controls should sit at the bottom.

The selected UI direction is the Production Queue layout. Use `docs/mockups/production-queue-ui-mockup-preview-top-controls-bottom.png` as the primary visual reference for the next UI implementation pass. The mockup intent is a left-side order queue with a batch export button above the order list, and a right-side selected-order editor with the selected order preview at the top, controls docked at the bottom, and an Export This Order button. Sample renders should use a white raised text layer over a blue backing silhouette.

For batch Etsy order sessions, the preferred workflow is:

1. Click Add Order to create a new blank order row in the order queue.
2. Enter or paste the order label and customer text in the selected-order editor. The order text may contain multiple lines.
3. Adjust the text layout using the existing preview and sliders.
4. Save the layout for that order, saving both text and slider settings.
5. Automatically advance to the next unsaved order.
6. Review the order list before export.
7. Export the active order SVG from the editor.
8. Export all queued orders with text from the order navigation when a batch SVG is needed.
