import { describe, expect, it } from "vitest";

describe("run_playwright helper", () => {
  it("targets the current worktree dev URL and port for local test runs", async () => {
    const { resolveRunPlaywrightOptions } = await import("../../tools/run_playwright.mjs");
    const { resolveDevBaseUrl, resolveDevPort } = await import("../../tools/dev_port.mjs");
    const cwd = "C:/Users/Mark/.codex/worktrees/78b9/thankfulforyou";
    const env = {};

    const options = resolveRunPlaywrightOptions({
      argv: ["test", "tests/e2e/orders-workspace.spec.js"],
      cwd,
      env,
    });

    expect(options.cliArgs).toEqual(["test", "tests/e2e/orders-workspace.spec.js"]);
    expect(options.childEnv.PLAYWRIGHT_BASE_URL).toBe(resolveDevBaseUrl({ cwd, env }));
    expect(options.childEnv.PORT).toBe(String(resolveDevPort({ cwd, env })));
    expect(options.childEnv.PLAYWRIGHT_TARGET).toBeUndefined();
  });

  it("preserves preview targeting without forcing a local base URL", async () => {
    const { resolveRunPlaywrightOptions } = await import("../../tools/run_playwright.mjs");

    const options = resolveRunPlaywrightOptions({
      argv: ["preview", "test"],
      cwd: "C:/Users/Mark/.codex/worktrees/78b9/thankfulforyou",
      env: { PLAYWRIGHT_BASE_URL: "https://preview.example.test" },
    });

    expect(options.cliArgs).toEqual(["test"]);
    expect(options.childEnv.PLAYWRIGHT_BASE_URL).toBe("https://preview.example.test");
    expect(options.childEnv.PLAYWRIGHT_TARGET).toBe("preview");
  });

  it("prefixes local spec-file arguments with the Playwright test command", async () => {
    const { resolveRunPlaywrightOptions } = await import("../../tools/run_playwright.mjs");

    const options = resolveRunPlaywrightOptions({
      argv: ["tests/e2e/orders-workspace.spec.js"],
      cwd: "C:/Users/Mark/.codex/worktrees/78b9/thankfulforyou",
      env: {},
    });

    expect(options.cliArgs).toEqual(["test", "tests/e2e/orders-workspace.spec.js"]);
  });
});
