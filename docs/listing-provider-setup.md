# Listing generation providers

Listing drafts work without generation providers. Operators can edit copy and upload or select images manually. The app never presents canned text or a fixture as generated content.

These optional server-only environment variables enable the two adapters:

| Variable | Required for | Notes |
| --- | --- | --- |
| `LISTING_OPENAI_API_KEY` | Copy generation and image preparation | OpenAI API key kept only in the server environment. |
| `LISTING_OPENAI_MODEL` | Copy generation | Explicit Responses API model ID. There is no built-in model default. |
| `LISTING_OPENAI_IMAGE_MODEL` | Image preparation | Optional OpenAI image model ID. Defaults to `gpt-image-2`. |

Restart the server after changing environment variables. Do not expose these values through browser configuration, committed `.env` files, logs, or error messages.

## Copy generation

With both OpenAI variables present, the server calls the Responses API using the configured model and a strict JSON schema. It requests Amazon US copy for the personalized acrylic topper only, with one title, one description, exactly five bullets, and warnings. It excludes Etsy shipping, returns, rush-processing language, shop policies, and links. Source title, description, facts, and existing warnings are supplied as untrusted reference data: instructions embedded in listing text are ignored, and the prompt tells the model not to invent unsupported claims. Output is validated before it reaches a draft:

- title: nonempty, at most 200 UTF-8 bytes
- description: nonempty, at most 2,000 UTF-8 bytes
- bullets: exactly five nonempty items, each at most 500 UTF-8 bytes
- warnings: at most ten nonempty items, each at most 500 UTF-8 bytes

The request disables response storage (`store: false`), uses a 15-second timeout, limits source and response payloads, and accepts only a completed Responses result. An unavailable provider, timeout, upstream status, incomplete response, or malformed response yields a safe error and preserves the existing editable draft.

The request format follows the official [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), which supports structured JSON output and `store: false`.

## Image preparation

With `LISTING_OPENAI_API_KEY` present, the server uploads a JPEG, PNG, or WebP source image to OpenAI's Images Edits API. It uses `POST /v1/images/edits` with multipart `image[]`, `n=1`, `size=1024x1024`, `quality=high`, `output_format=jpeg`, and the configured image model (default `gpt-image-2`). The edit prompt requests a clean white background while preserving the product's original lettering, contours, and clear hardware.

The adapter permits source uploads up to 20 MiB, uses a 150-second timeout, caps decoded output at 25 MiB, and caps the base64 JSON response at 35 MiB. It sends no source URLs, so provider processing cannot fetch an arbitrary URL supplied by a browser request. The returned JPEG is a separate derivative: image generation can alter product details. Review lettering and clear hardware before approving it; use the original or a replacement upload if it is unsuitable.

The request format follows the official [OpenAI Images API reference](https://platform.openai.com/docs/api-reference/images/createEdit): multipart `POST /v1/images/edits` with the server-only API key. The configured copy model is not used for image preparation.

## Capability and error contract

`getListingCapabilities(env)` returns:

```json
{ "amazon": false, "copyGeneration": false, "imagePreparation": false }
```

`copyGeneration` is true only when both `LISTING_OPENAI_API_KEY` and `LISTING_OPENAI_MODEL` are nonempty. `imagePreparation` is true when `LISTING_OPENAI_API_KEY` is nonempty; it uses `LISTING_OPENAI_IMAGE_MODEL` when set and otherwise `gpt-image-2`. `amazon` remains false: these capabilities do not establish Amazon validation, submission, image acceptance, or activation.

`generateListingCopy(...)` returns `{title, description, bullets, warnings}`. `prepareListingImage(...)` returns `{bytes: Buffer, mimeType: "image/jpeg"}`. Missing configuration produces an explicit 503 provider error; provider failures are sanitized and contain no credentials or raw upstream payloads.

## Local provider configuration

For local development, put the OpenAI provider variables in the ignored `.local/listing-providers.env` file. The local startup wrapper reads only the named provider keys and the four sandbox keys from `.local/amazon-sp-api.sandbox.env`; existing process environment values take precedence. Restart after changes. Hosted deployments require server environment variables configured separately.

## Actionable failures

Listing request failures open a dismissible error dialog and retain the inline message and draft. OpenAI error codes are mapped to fixed messages for exhausted credits/project quota, invalid API keys, model availability, access restrictions, and rate limits. Provider authentication errors do not expire the app login. Raw provider messages and credentials are never displayed.
