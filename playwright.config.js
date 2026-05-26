import { defineConfig } from "playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolvePlaywrightRuntimeOptions } from "./tools/playwright_targeting.mjs";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const {
  baseURL,
  extraHTTPHeaders,
  localBaseUrl,
  localPort,
} = resolvePlaywrightRuntimeOptions({
  cwd: CONFIG_DIR,
  env: process.env,
});

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
  webServer: baseURL === localBaseUrl
    ? {
        command: "node tools/dev_server.mjs",
        env: {
          ...process.env,
          PORT: String(localPort),
        },
        url: localBaseUrl,
        reuseExistingServer: true,
        timeout: 15000,
      }
    : undefined,
});
