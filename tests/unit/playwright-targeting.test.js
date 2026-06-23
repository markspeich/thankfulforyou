import { describe, expect, it } from "vitest";

import { resolveDevBaseUrl } from "../../tools/dev_port.mjs";
import { resolvePlaywrightRuntimeOptions } from "../../tools/playwright_targeting.mjs";

const rootCwd = "C:/Users/Mark/CodexProjects/thankfulforyou";
const previewUrl = "https://preview.example.com/";

describe("playwright targeting", () => {
  it("defaults to the local worktree test URL even when .env.local contains a preview URL", () => {
    const result = resolvePlaywrightRuntimeOptions({
      cwd: rootCwd,
      env: {},
      envFileValues: {
        PLAYWRIGHT_BASE_URL: previewUrl,
      },
    });

    expect(result.baseURL).toBe(result.localBaseUrl);
    expect(result.baseURL).toBe(resolveDevBaseUrl({ cwd: rootCwd, env: { DEV_SERVER_PORT_ROLE: "test" } }));
    expect(result.localPortRole).toBe("test");
    expect(result.usePreviewTarget).toBe(false);
  });

  it("uses the preview URL only when preview targeting is explicitly requested", () => {
    const result = resolvePlaywrightRuntimeOptions({
      cwd: rootCwd,
      env: {
        PLAYWRIGHT_TARGET: "preview",
      },
      envFileValues: {
        PLAYWRIGHT_BASE_URL: previewUrl,
      },
    });

    expect(result.baseURL).toBe(previewUrl);
    expect(result.usePreviewTarget).toBe(true);
  });

  it("still lets an explicit PLAYWRIGHT_BASE_URL override everything", () => {
    const result = resolvePlaywrightRuntimeOptions({
      cwd: rootCwd,
      env: {
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4888",
        PLAYWRIGHT_TARGET: "preview",
      },
      envFileValues: {
        PLAYWRIGHT_BASE_URL: previewUrl,
      },
    });

    expect(result.baseURL).toBe("http://127.0.0.1:4888");
    expect(result.usePreviewTarget).toBe(false);
  });
});
