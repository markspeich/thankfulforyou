import { defineConfig } from "playwright/test";

const LOCAL_BASE_URL = "http://127.0.0.1:4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || LOCAL_BASE_URL;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const bypassCookieMode = process.env.VERCEL_BYPASS_COOKIE_MODE || "true";
const extraHTTPHeaders = {};

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
        url: LOCAL_BASE_URL,
        reuseExistingServer: true,
        timeout: 15000,
      }
    : undefined,
});
