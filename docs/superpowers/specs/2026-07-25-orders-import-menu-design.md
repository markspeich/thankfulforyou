# Orders Import Menu Design

## Goal

Prevent Orders header actions from overflowing at narrow viewport widths by moving the Etsy and Amazon import actions into the existing Orders ellipsis menu.

## Layout

The always-visible Orders header actions will contain:

1. `Paste`
2. The existing Orders ellipsis menu

The ellipsis menu will contain two groups in this order:

1. `Import`
   - `Import Etsy`
   - `Import Amazon`
2. `Orders`
   - `Add Checked to Production Batch`
   - `Skip Orders`
   - `Reopen Orders`

Import actions will use the same full-width menu-action styling as the existing Orders actions. The compact popover will remain content-sized.

## Behavior

- The Etsy import action will retain its current authentication, popup, loading, disabled, and feedback behavior.
- The Amazon import action will retain its current progress dialog, loading, mutual-exclusion, completion, and error behavior.
- While either import is active, both import actions remain mutually disabled as they are today.
- Moving the buttons must not change the behavior of `Paste` or any existing Orders action.

## Testing

- Update browser tests to assert that the header contains only `Paste` and the ellipsis menu.
- Assert that `Import Etsy` and `Import Amazon` appear in the menu in the approved order.
- Retain the existing import lifecycle and mutual-exclusion coverage using the relocated controls.
- Verify the ellipsis remains visible at the narrow viewport represented by the reported screenshot.

