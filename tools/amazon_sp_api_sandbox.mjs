import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseEnvFile } from "./env_file.mjs";

const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const TEST_URL = "https://sandbox.sellingpartnerapi-na.amazon.com/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=TEST_CASE_200";
const KEYS = ["AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN"];

async function jsonRequest(fetchImpl, url, options, stage, maximum) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { error: stage + " failed (HTTP " + response.status + "). Check the sandbox app credentials and permissions." };
    }
    const reader = response.body?.getReader();
    if (!reader) return { error: stage + " returned an unexpected response." };
    const chunks = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); return { error: stage + " returned an oversized response." }; }
      chunks.push(Buffer.from(value));
    }
    return { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")), status: response.status };
  } catch { return { error: stage + " request failed. Check network access and the sandbox app configuration." }; }
}

export async function checkAmazonSandbox({ env, fetchImpl = fetch }) {
  if (env.AMAZON_SP_API_ENVIRONMENT !== "sandbox") throw new Error("This check requires AMAZON_SP_API_ENVIRONMENT=sandbox.");
  const missing = KEYS.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error("Missing sandbox credentials: " + missing.join(", "));
  const auth = await jsonRequest(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.AMAZON_SP_API_CLIENT_ID, client_secret: env.AMAZON_SP_API_CLIENT_SECRET, refresh_token: env.AMAZON_SP_API_REFRESH_TOKEN }),
  }, "Amazon authentication", 65536);
  if (auth.error) throw new Error(auth.error);
  if (typeof auth.payload?.access_token !== "string" || !auth.payload.access_token) throw new Error("Amazon authentication returned an unexpected response.");
  const test = await jsonRequest(fetchImpl, TEST_URL, {
    method: "GET",
    headers: { "x-amz-access-token": auth.payload.access_token, Accept: "application/json", "User-Agent": "ThankfulForYou-SandboxCheck/1.0" },
  }, "Amazon sandbox request", 1024 * 1024);
  if (test.error) throw new Error(test.error);
  if (!Array.isArray(test.payload?.payload?.Orders)) throw new Error("Amazon sandbox returned an unexpected response.");
  return { environment: "sandbox", authentication: "passed", sandboxRequest: "passed", httpStatus: test.status };
}

async function main() {
  let source;
  try { source = await readFile(new URL("../.local/amazon-sp-api.sandbox.env", import.meta.url), "utf8"); }
  catch { throw new Error("Cannot read .local/amazon-sp-api.sandbox.env."); }
  console.log(JSON.stringify(await checkAmazonSandbox({ env: parseEnvFile(source) }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
