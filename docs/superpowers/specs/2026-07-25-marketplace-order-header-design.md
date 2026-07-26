# Marketplace Order Header Design

## Goal

Make imported Amazon and Etsy orders use the same compact selected-order header structure while keeping the source marketplace immediately recognizable.

## Selected-order header

- Imported orders show a compact marketplace icon followed by `Order <order number>`.
- Amazon is identified by an Amazon icon and Etsy by an Etsy icon.
- Each icon has an accessible marketplace name even though the visible treatment is icon-only.
- The metadata line continues to show buyer name when available, ship-by date when available, item count, and active-batch membership.
- The lifecycle status remains below the metadata line.
- Genuine manual orders keep the existing `Manual Order: <design text>` title and do not receive a marketplace icon.

## Marketplace and order-number resolution

- An order is Amazon when one of its items has `source.marketplace` equal to `amazon`, case-insensitively.
- An imported order without an explicit marketplace marker is treated as Etsy when it has an imported order number. This preserves compatibility with existing Etsy records, whose source metadata predates the marketplace field.
- The displayed order number first uses the grouped order's `orderNumber`, then falls back to an item-level `orderNumber`, then to an item source `orderNumber`.
- Orders without an imported order number remain manual orders.

## Presentation

- Marketplace icons are small inline SVG marks rendered beside the heading text.
- The icon and title form one heading and wrap cleanly on narrow screens.
- Icons use restrained marketplace-specific colors without changing the surrounding production-workspace header styling.

## Testing

- Browser coverage verifies that an Etsy imported order renders the Etsy icon and order-number title.
- Browser coverage verifies that an Amazon order whose order number is available only in item source metadata renders the Amazon icon and the imported order number rather than a manual-order title.
- Existing manual-order coverage continues to verify the manual title fallback.

## Scope

This change affects only selected-order header presentation and its requirements/tests. It does not change import persistence, grouped order rows, database schema, or order-item cards.
