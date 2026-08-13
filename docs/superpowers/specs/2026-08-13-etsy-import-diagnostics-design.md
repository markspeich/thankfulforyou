# Etsy Import Diagnostics Design

## Goal

Preserve a bounded, server-only audit record of how Etsy transaction variations are classified, paired to text lines, and resolved to workspace fonts.

## Design

`normalizeEtsyTransaction` will produce an `etsyImportDiagnostics` object outside normal `source` metadata. It will include sanitized variation identifiers and display values, each variation's classification and reason, final line-to-selection pairings, and font-resolution outcomes. The browser-facing order source and UI remain unchanged.

`order_items` will receive a dedicated `etsy_import_diagnostics` JSONB column, analogous to the existing private Amazon customization diagnostic column. The order store will write it for new Etsy imports and replace it after a successful re-import, without changing the saved design. Normal order and batch read projections will continue to omit this column.

## Constraints

- The diagnostic object must be finite and bounded to the transaction's variation list.
- It must not include OAuth credentials, access tokens, or API request/response envelopes.
- It must not be copied into `source_json`, browser responses, telemetry, or ordinary application logs.
- Existing orders imported before this change cannot be reconstructed; future successful imports provide the audit record.

## Verification

Add unit coverage for classification/pairing diagnostics and store coverage that confirms diagnostics are persisted privately and updated on re-import. Test execution is intentionally deferred at the user's request.
