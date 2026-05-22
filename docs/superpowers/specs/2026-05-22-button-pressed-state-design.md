# Button Pressed State Design

## Summary

Add a visible pressed state to the app's command buttons so operators get immediate confirmation when a button is actively being clicked or tapped.

This should be a shared interaction-language improvement across the existing command button families rather than a one-off patch for a single button.

## Goals

- Make button presses feel responsive and intentional during production use.
- Keep the feedback subtle and practical rather than decorative.
- Centralize the interaction language so command buttons behave consistently across the workspace.
- Preserve existing hover, focus-visible, and disabled affordances.

## Non-Goals

- Redesigning the button color system.
- Restyling neutral row-selection buttons such as queue row selectors.
- Adding long or playful button animations.
- Changing button copy, layout, or action ordering.

## Approved Product Decisions

- The pressed state should apply to the main command button families already using the shared button color system.
- The pressed state should be visually clear but restrained: darker background, slightly stronger border or inset feel, and a subtle downward movement.
- Focus-visible should remain distinct so keyboard users still get a dedicated accessibility cue.
- Neutral row-selection buttons stay out of scope for this pass.

## Current Baseline

The current stylesheet defines hover, focus-visible, and disabled states for command buttons such as `.editor-action-button` and `.queue-tool-button`, but does not define a pressed/active state. As a result, pointer clicks do not give tactile confirmation beyond the browser's default event timing.

## Recommended Approach

Use shared pressed-state tokens and selectors rather than per-component hand tuning.

The existing button language already relies on shared variables such as `--button-enabled`, `--button-enabled-hover`, `--button-border`, and `--button-border-hover`. The pressed state should extend that system with a small set of shared pressed tokens, then apply them consistently to the main command button selectors.

This keeps the fix centralized and makes later refinement easier if the shop wants a slightly firmer or softer tactile feel.

## Visual Design

The pressed state should combine three small cues:

- a darker pressed background than hover
- a slightly stronger pressed border or inset feel
- a `translateY(1px)` style movement to suggest button travel

These cues should be fast and calm. The interaction should feel responsive, not animated for its own sake.

## Scope

### In Scope

- `.editor-action-button`
- `.queue-tool-button`
- destructive command buttons that follow the same command-button interaction language

### Out Of Scope

- `.order-item` queue row selection buttons
- passive structural controls that do not behave like command buttons

## CSS Design

The preferred shape is:

- add shared pressed tokens such as `--button-enabled-pressed` and `--button-border-pressed`
- add matching destructive pressed treatment where destructive buttons already override the base command colors
- add `:active:not(:disabled)` rules to the command button selectors
- include `transform` in the button transition list if movement is added

If a subtle inset shadow is used, it should remain small enough that the button still matches the calm production-workspace aesthetic.

## Testing Design

Add a focused browser test that verifies the pressed-state hook exists for representative command buttons. If computed-style assertions are practical and stable, check at least:

- one editor action button
- one queue tool button

If computed-style assertions prove too brittle in Playwright, a lighter fallback is acceptable: verify the selectors and active-state style rules remain present in a targeted stylesheet-oriented test. The goal is to catch accidental removal of the pressed state, not to overspecify exact pixels.

## Risks

- A pressed color that is too close to hover may still feel invisible.
- A pressed translation that is too strong can make the interface feel toy-like.
- Applying the state too broadly could affect neutral buttons that are intentionally not part of the command-button language.

## Implementation Notes For Planning

- Prefer extending the existing shared button token system over duplicating values directly into each selector.
- Keep the change scoped to command buttons only.
- Verify both pointer behavior and keyboard focus behavior so the pressed state does not blur accessibility feedback.
