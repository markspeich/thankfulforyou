import fs from "node:fs";
import path from "node:path";

import { resolveDevBaseUrl, resolveDevPort } from "./dev_port.mjs";

export function loadEnvFile(filePath) {
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

export function resolvePlaywrightRuntimeOptions({
  cwd,
  env = process.env,
  envFileValues = loadEnvFile(path.join(cwd, ".env.local")),
} = {}) {
  const localBaseUrl = resolveDevBaseUrl({ cwd, env });
  const localPort = resolveDevPort({ cwd, env });
  const previewBaseUrl = envFileValues.PLAYWRIGHT_BASE_URL || "";
  const explicitBaseUrl = env.PLAYWRIGHT_BASE_URL || "";
  const usePreviewTarget = !explicitBaseUrl && env.PLAYWRIGHT_TARGET === "preview" && Boolean(previewBaseUrl);
  const baseURL = explicitBaseUrl || (usePreviewTarget ? previewBaseUrl : localBaseUrl);
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET || envFileValues.VERCEL_AUTOMATION_BYPASS_SECRET;
  const bypassCookieMode = env.VERCEL_BYPASS_COOKIE_MODE || envFileValues.VERCEL_BYPASS_COOKIE_MODE || "true";
  const extraHTTPHeaders = {};

  if (bypassSecret) {
    extraHTTPHeaders["x-vercel-protection-bypass"] = bypassSecret;
    extraHTTPHeaders["x-vercel-set-bypass-cookie"] = bypassCookieMode;
  }

  return {
    baseURL,
    bypassCookieMode,
    bypassSecret,
    extraHTTPHeaders,
    localBaseUrl,
    localPort,
    previewBaseUrl,
    usePreviewTarget,
  };
}
