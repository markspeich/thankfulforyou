import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "playwright/test";
import { fileURLToPath } from "node:url";
import { resolveDevBaseUrl, resolveDevPort } from "./tools/dev_port.mjs";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_BASE_URL = resolveDevBaseUrl({ cwd: CONFIG_DIR });
const LOCAL_PORT = resolveDevPort({ cwd: CONFIG_DIR });
const envFileValues = loadEnvFile(path.join(CONFIG_DIR, ".env.local"));
const baseURL = process.env.PLAYWRIGHT_BASE_URL || envFileValues.PLAYWRIGHT_BASE_URL || LOCAL_BASE_URL;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || envFileValues.VERCEL_AUTOMATION_BYPASS_SECRET;
const bypassCookieMode = process.env.VERCEL_BYPASS_COOKIE_MODE || envFileValues.VERCEL_BYPASS_COOKIE_MODE || "true";
const extraHTTPHeaders = {};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const fileText = fs.readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of fileText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

if (bypassSecret) {
  extraHTTPHeaders["x-vercel-protection-bypass"] = bypassSecret;
  extraHTTPHeaders["x-vercel-set-bypass-cookie"] = bypassCookieMode;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1500, height: 1200 },
    extraHTTPHeaders,
  },
  webServer: baseURL === LOCAL_BASE_URL
    ? {
        command: "node tools/dev_server.mjs",
        env: {
          ...process.env,
          PORT: String(LOCAL_PORT),
        },
        url: LOCAL_BASE_URL,
        reuseExistingServer: true,
        timeout: 15000,
      }
    : undefined,
});
