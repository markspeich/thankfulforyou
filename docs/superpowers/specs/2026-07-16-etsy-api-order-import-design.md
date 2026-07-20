# Etsy API Order Import Design

## Summary

Add an on-demand `Import from Etsy` workflow to the Orders workspace. The app will use Etsy Open API v3 directly, retrieve paid and unshipped receipts for the connected seller shop, and persist only Etsy transactions that have not already been imported.

This replaces ShipStation as the intended Etsy import source. Amazon customization import is out of scope and will receive a separate design because ShipStation does not expose Amazon customization details reliably.

## Goals

- Import open Etsy orders without copying data from the Etsy website.
- Create one app order item for each Etsy transaction.
- Preserve personalization, variations, quantity, listing metadata, and source identifiers.
- Make repeated imports safe and avoid overwriting operator work.
- Keep Etsy application credentials and OAuth tokens out of browser code.
- Give the operator clear progress and a useful result summary.

## Non-goals

- Importing Amazon orders or Amazon customization archives.
- Importing shipped, cancelled, or unpaid Etsy receipts.
- Automatically adding imported items to the active production batch.
- Writing shipment, tracking, listing, or order data back to Etsy.
- Replacing the existing clipboard importer in the first release.
- Running scheduled or webhook-driven background synchronization.

## Recommended Approach

Use an operator-initiated server-side import. The Orders workspace button starts a protected app API request. The server authenticates to Etsy, retrieves and normalizes receipts and transactions, and passes normalized items to the existing `importWorkspaceOrderItems` persistence path with the `orders` target.

This approach matches the requested workflow and is simpler to operate than webhook or scheduled synchronization. The Etsy client and normalization boundary should remain independent so a later webhook can reuse them.

## User Experience

The Orders toolbar has one Etsy action whose state reflects the connection:

- `Connect Etsy Shop` when the workspace has no usable Etsy authorization.
- `Import from Etsy` when the shop is connected.
- `Importing…` while a run is active.
- `Reconnect Etsy Shop` when authorization has expired or been revoked.

While importing, the UI must show a visible progress indicator and accessible text status. It should use determinate progress when the server can report a total, such as `Importing 6 of 14 order items`, and staged or indeterminate progress while discovering pages, such as `Fetching Etsy receipts…`. The button remains disabled for the active run, and the progress UI must not rely on animation alone to communicate state.

At completion, show counts for newly imported order items, order items already present, imported items that need customization review, and failed items.

An imported item with missing or unusable customization remains editable and displays a `Customization needed` warning on its Orders card.

## Authentication and Secrets

Use Etsy OAuth 2.0 Authorization Code with PKCE. Request only `transactions_r` and `shops_r`.

The authorization flow must generate a high-entropy, single-use OAuth state and PKCE verifier, keep temporary authorization context in secure server-controlled state, validate state in the HTTPS callback, exchange the authorization code server-side, identify the authorized seller shop, and return the operator to Orders with a clear result.

Store the Etsy Keystring and Shared Secret only in server environment variables. Store workspace connection metadata in a new `etsy_connections` table. Encrypt access and refresh tokens with AES-GCM before writing them to Postgres; keep the encryption key only in a server environment variable. Browser clients and ordinary authenticated database roles must never be able to select token ciphertext.

Etsy access tokens last one hour and refresh tokens have a longer 90-day lifetime. Refresh server-side when needed, save updated token material and expiration data, and require reconnection when refresh fails or authorization is revoked. Reconnection must not affect previously imported orders.

The schema addition requires a checked-in Supabase migration and local migration verification.

## Import Retrieval

Use Etsy Open API v3 `getShopReceipts` and the receipt transaction endpoint.

For an initial connection, search a bounded 90-day lookback. For later runs, begin from the last successful high-water timestamp with a small overlap window. Pagination continues until all receipts in the requested interval have been inspected.

The server retains only receipts where `is_paid` is true, `is_shipped` is false, and the receipt is not cancelled. The timestamp is an optimization, not the deduplication authority. Etsy `transaction_id` is the final identity check.

Limit request concurrency, impose timeouts, honor Etsy rate-limit responses with bounded retries, and prevent concurrent imports for the same workspace. An import lock must expire safely if a process terminates unexpectedly.

## Data Mapping

Each Etsy transaction becomes one app order item:

| Etsy value | App value |
| --- | --- |
| `receipt_id` | order number and grouping key |
| `transaction_id` | order-item identity and deduplication key |
| `listing_id` | listing identity and preset lookup |
| receipt recipient name | buyer name |
| transaction quantity | quantity |
| listing title and thumbnail | listing metadata |
| ordinary variation named `Color` | imported color |
| transaction variations with `property_id: 54` | personalization responses |
| relevant raw identifiers, variations, and timestamps | `source_json` |

The Etsy adapter normalizes this data into the existing imported-item contract rather than introducing a second persistence pipeline.

### Personalization

- Do not assume that the formatted name is `Personalization`.
- Accept multiple variation objects with `property_id: 54`.
- Preserve each question label and returned value in `source_json`.
- Put usable text responses into initial design text in Etsy's returned order, one value per line.
- Put every non-empty, non-URL value with `property_id: 54`, including dropdown responses, into design text.
- Preserve file-upload URLs as customization references, but do not insert URLs into design text.
- Keep ordinary variations such as font, badge-reel type, and color in source metadata unless an explicit mapping handles them.

If the importer cannot derive usable design text, it still creates the order item and draft design with a customization warning.

## Persistence and Idempotency

Call `importWorkspaceOrderItems` with `target: "orders"`. Do not create `batch_items` during this workflow.

Use `transaction:<transaction_id>` as the imported order-item ID, consistent with current behavior. Existing transaction IDs count as already present. A repeated import must not overwrite an existing order item or a design that an operator has edited, saved, completed, analyzed, or exported.

Save the last successful reconciliation timestamp only after all requested pages have been handled. Partial item failures are recorded and reported without discarding successfully imported items.

## Failure Handling

- An image or listing enrichment failure does not block an otherwise valid transaction.
- Missing customization imports the item with a warning.
- One receipt or transaction failure does not roll back unrelated successful items.
- Authentication failure, invalid shop authorization, or failure to retrieve a receipt page stops the affected run and presents a reconnect or retry action.
- Rate limiting produces a bounded retry and a readable failure if the retry budget is exhausted.
- Logs identify Etsy receipt and transaction IDs without logging OAuth tokens, secrets, or unnecessary customer data.

## Components

- Etsy OAuth start and callback routes.
- Workspace Etsy connection store and token encryption helper.
- Etsy Open API v3 client with refresh, pagination, timeout, and rate-limit handling.
- Etsy receipt/transaction normalizer that produces the existing import contract.
- Protected Orders import endpoint and progress protocol.
- Orders workspace connection, import, progress, result, and warning UI.
- Supabase migration for connection and synchronization state.

The import endpoint sends newline-delimited progress events over its response stream. Events identify the current stage, discovered total when known, processed count, and final result counts. If the stream or request fails, the UI stops the indicator and presents a retry action; transaction-level idempotency makes retry safe.

## Verification

Automated coverage must include OAuth state and PKCE validation; server-only secret handling; token encryption, refresh, expiration, revocation, and reconnection; receipt pagination and filtering; high-water overlap; workspace concurrency control; transaction deduplication and design protection; all supported personalization forms; metadata and preset lookup; partial failures and result counts; progress and accessibility states; route authorization and workspace isolation; and migration behavior against a fresh local Supabase database.

Browser verification must exercise the Orders connection and import flow with mocked Etsy responses before a small read-only live-shop validation. Live validation must not modify Etsy orders, listings, shipments, or tracking.

## Deployment and Credential Setup

Before live verification:

1. register the exact production HTTPS OAuth callback in the Etsy seller app;
2. add the Keystring, Shared Secret, and token-encryption key to server environment configuration;
3. apply the additive Supabase migration to the intended database after explicit approval;
4. authorize the seller shop through the app;
5. run a small read-only import and compare a sample against Etsy Shop Manager.

Credentials must never be pasted into chat, committed to Git, exposed in browser JavaScript, or written to logs.

## Future Work

- Etsy webhook-triggered synchronization using the same client and normalizer.
- Scheduled reconciliation if operations require it.
- A separate Amazon customization-import design.
- Retirement of the clipboard importer after the API workflow is proven reliable.
