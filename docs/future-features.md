# Future Feature Ideas

This document consolidates future-facing product ideas that are not part of the current production requirements.

Use [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1) as the source of truth for current requirements and production assumptions. Use this file for later-phase ideas, optional workflow enhancements, and larger follow-up features that may be explored after the current production rollout is stable.

## Preset Authoring And Management

The long-term direction is to let operators create and manage reusable presets from inside the app instead of editing JSON files manually.

This future area should include:

- a `Save As Preset` action in the selected-order editor
- a dedicated preset-management page for reviewing, updating, organizing, and possibly renaming saved presets outside the active order editor
- preset serialization that captures reusable layout settings such as preset name, stable preset id, target bounding box size, backing border, weld setting, per-line font choices, bridges, offsets, and text-height defaults
- output that round-trips through the same schema-validated JSON format used by runtime presets
- behavior that excludes one-off order text so preset files stay focused on reusable layout defaults

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)
- [presets.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/presets.md:132)

## Assisted Layout Suggestions

Once the shop has enough validated production examples, the app may add lightweight geometry suggestions that help operators make manufacturable layouts faster without replacing manual control.

Possible directions:

- automatic bridge suggestions
- automatic spacing suggestions
- similar assistive recommendations based on observed production-safe patterns

These ideas should remain optional and subordinate to manual controls for letter bridge, line bridge, per-line font choice, horizontal offset, text height, and backing border.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)

## Granular Overlap Controls

If real production jobs show recurring edge cases that per-line controls cannot solve cleanly, the app may later add more granular overlap tuning than the current per-line model.

Possible directions:

- per-character-pair bridge or spacing adjustments
- targeted overrides for difficult glyph combinations

This should stay behind the simpler global and per-line workflow unless production evidence shows it is necessary.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)

## Alternate Design Boundaries

The current production model uses a freeform text-following backing silhouette. A later feature may let operators choose other finished design boundary styles when a listing calls for a more structured outline.

Possible boundary styles:

- freeform text-following silhouette
- rounded rectangle
- oval
- other listing-specific shapes

Any implementation in this area should keep the text-fitting guide, backing generation, preview, geometry analysis, and export output aligned so the selected boundary style does not drift across the pipeline.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)

## Ruida Direct Transfer

The app may eventually support an internal-production Ruida workflow over USB, but only as a later layer on top of the current SVG-first manufacturing flow.

This future area should be framed as three related capabilities:

- Ruida job generation
- USB transport to the controller
- controller safety and validation

The smallest credible first scope would be:

1. Export one analyzed badge design as Ruida job data for text and backing only.
2. Upload that job over USB without auto-start.
3. Verify that the machine output matches the analyzed SVG geometry.
4. Add operator-visible confirmation around file naming, overwrite handling, and ready-to-run state.

This should not be treated as "replace LightBurn." SVG export should remain the primary production path unless direct transfer proves equally trustworthy.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)
- [ruida-direct-integration-research.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/ruida-direct-integration-research.md:63)

## Broader Import And Export Helpers

After the first SVG-first production workflow is stable, the app may add broader import or export helpers around batch preparation and downstream manufacturing handoff.

This area is still intentionally undefined and should stay secondary to keeping the current geometry and SVG workflow dependable.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)

## App-Level Authentication

The initial hosted deployment should rely on Vercel Deployment Protection. A later phase may add an in-app authentication system if the hosted tool grows beyond the current internal-production use case.

Any future auth work should be treated as a separate product effort rather than a prerequisite for the current production rollout.

Primary references:

- [requirements.md](/C:/Users/Mark/.codex/worktrees/42f4/thankfulforyou/docs/requirements.md:1)
