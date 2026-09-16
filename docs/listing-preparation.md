# Preparing Amazon listings from Etsy

This first phase prepares saved drafts. It does not create, update, or activate Amazon listings yet.

## Setup

- Apply the checked-in `supabase/migrations/20260915214638_listing_preparation_workspace.sql` migration to the database serving the app before deploying the feature. It adds draft, image, and operation storage; it does not change orders or designs.
- Connect the business's Etsy shop using the existing Etsy connection flow.
- Optionally configure the copy and background-removal services described in [provider setup](listing-provider-setup.md). Their keys are separate from Amazon SP-API credentials.

## Workflow

1. Open **Listings** and paste an Etsy listing URL or numeric ID from the connected shop.
2. Review the imported facts and photos. Reimporting the same listing opens its saved draft.
3. Edit the title, description, and five bullet points. The default price is **$19.99 for the topper only**. Reel surcharges belong in the Amazon customization template.
4. Select the gallery images and main image. If configured, prepare a white-background image; otherwise upload a prepared replacement. Check lettering, product contours, and clear straps before approving an image.
5. Save edits, then approve the reviewed copy and images. Content or image-role changes require renewed approval.

Keep Amazon customization templates as the manual handoff for this phase. The product-ID exemption, exact product type, inactive listing behavior, and final image acceptance will be validated against the seller account once SP-API access is available.

## Verification boundary

### Amazon sandbox connection

The local sandbox credentials are stored in the Git-ignored `.local/amazon-sp-api.sandbox.env` file. Run `node tools/amazon_sp_api_sandbox.mjs` to verify them. The check explicitly reads that file, requires `AMAZON_SP_API_ENVIRONMENT=sandbox`, exchanges the refresh token with Login with Amazon, and calls the North America static sandbox. It prints only status results. It does not enable listing submission or expose credentials to the browser.

Verified on 2026-09-15: authentication succeeded and Amazon's documented read-only sandbox test returned HTTP 200. Five focused unit tests also passed. The sandbox check follows [Amazon's onboarding example](https://developer-docs.amazon.com/sp-api/docs/onboarding-step-5-make-your-first-call-to-the-sp-api-sandbox); its canned responses do not verify seller-specific product definitions, GTIN exemption, or real listing acceptance.

Automated tests use controlled Etsy and generation responses. They do not prove live marketplace acceptance or background-removal quality. Test a real owned listing and inspect the reference-photo result after configuring the corresponding services.

### Sandbox listing workflow

The sandbox panel requires `supabase/migrations/20260916000736_amazon_sandbox_listing_attempts.sql` in addition to the preparation migration. It adds attempt history and serialized submission claims. Both migrations have been verified locally; production migration/application remains a separate deployment step.

When local sandbox credentials are configured, saved drafts show an **Amazon sandbox** panel. Approve the saved copy and all selected images, run the preview test, then submit the same revision to the sandbox. Changing the draft requires another preview. An uncertain submission blocks resending and offers a status check. Static responses cannot resolve actual persistence, so these checks remain unconfirmed.

The provisional product-only payload includes reviewed copy and image URLs, `Generic`, and the declared GTIN exemption. It omits offers, price, quantity, and the reference ASIN. The stable SKU is `TFY-` plus the draft UUID without hyphens. Production product definitions, durable image delivery, exemption eligibility, and inactive-listing behavior still require seller-account verification.

Run `node tools/check_amazon_listings_sandbox.mjs` for synthetic Listings protocol checks. It uses documented static validation fixtures and a synthetic submission. These responses cannot establish that a real product is valid or create a Seller Central listing. See [Amazon's Listings Items API guide](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-use-case-guide).

Verified on 2026-09-15 with the configured sandbox credentials: Listings `VALIDATION_VALID` returned `VALID`, `VALIDATION_INVALID` returned `INVALID` with the documented canned issues, and a synthetic submission returned `ACCEPTED`. This is protocol verification only.

Local Etsy OAuth: the local startup wrapper allowlists Etsy credentials and ETSY_REDIRECT_URI from the ignored .local/etsy.env file. Start authorization from the registered HTTPS origin so the callback receives its host-bound OAuth cookie. Tailscale Serve provides private HTTPS; it does not change the local database target.
