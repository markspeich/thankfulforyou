import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAmazonSandboxClient, hasAmazonSandboxConfig } from "../api/_lib/amazon-sandbox-client.js";
import { parseEnvFile } from "./env_file.mjs";

const SYNTHETIC_PRODUCT = Object.freeze({
  productType: "PRODUCT",
  requirements: "LISTING_PRODUCT_ONLY",
  attributes: {
    item_name: [{ value: "Sandbox synthetic acrylic test product", marketplace_id: "ATVPDKIKX0DER" }],
    brand: [{ value: "Generic", marketplace_id: "ATVPDKIKX0DER" }],
  },
});

const VALIDATION_VALID = Object.freeze({
  ...SYNTHETIC_PRODUCT,
  attributes: { ...SYNTHETIC_PRODUCT.attributes, condition_type: [{ value: "new_new", marketplace_id: "ATVPDKIKX0DER" }] },
});

const VALIDATION_INVALID = Object.freeze({
  ...SYNTHETIC_PRODUCT,
  attributes: { ...SYNTHETIC_PRODUCT.attributes, condition_type: [{ value: "not-a-real-condition", marketplace_id: "ATVPDKIKX0DER" }] },
});

async function sandboxEnvironment() {
  try {
    return parseEnvFile(await readFile(new URL("../.local/amazon-sp-api.sandbox.env", import.meta.url), "utf8"));
  } catch {
    throw new Error("Cannot read .local/amazon-sp-api.sandbox.env.");
  }
}

export async function checkAmazonListingsSandbox({ env, fetchImpl = fetch } = {}) {
  const sandboxEnv = env ?? await sandboxEnvironment();
  if (!hasAmazonSandboxConfig(sandboxEnv)) throw new Error("Amazon Listings sandbox requires AMAZON_SP_API_ENVIRONMENT=sandbox and all sandbox credentials.");
  const client = createAmazonSandboxClient({ env: sandboxEnv, fetchImpl });
  const validationValid = await client.preview({ sku: "VALIDATION_VALID", payload: VALIDATION_VALID });
  const validationInvalid = await client.preview({ sku: "VALIDATION_INVALID", payload: VALIDATION_INVALID });
  const submission = await client.submit({ sku: "TFY-SANDBOX-SYNTHETIC-SUBMIT", payload: SYNTHETIC_PRODUCT });
  return { environment: "sandbox", validationValid, validationInvalid, submission };
}

async function main() {
  console.log(JSON.stringify(await checkAmazonListingsSandbox(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
