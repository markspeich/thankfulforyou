import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveDevBaseUrl, resolveDevPort } from "./dev_port.mjs";

const require = createRequire(import.meta.url);
const playwrightPackagePath = require.resolve("playwright/package.json");
const playwrightCliPath = path.join(path.dirname(playwrightPackagePath), "cli.js");

const knownTargets = new Set(["preview", "local"]);
const playwrightCommands = new Set([
  "clear-cache",
  "codegen",
  "cr",
  "debug",
  "ff",
  "help",
  "install",
  "install-deps",
  "merge-reports",
  "open",
  "pdf",
  "run-server",
  "screenshot",
  "show-report",
  "test",
  "wk",
]);

function normalizeCliArgs(argv) {
  if (!argv.length) {
    return ["test"];
  }

  const [firstArg] = argv;
  if (typeof firstArg === "string" && !firstArg.startsWith("-") && !playwrightCommands.has(firstArg)) {
    return ["test", ...argv];
  }

  return argv;
}

export function resolveRunPlaywrightOptions({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const [targetOrCommand, ...restArgs] = argv;
  const target = knownTargets.has(targetOrCommand) ? targetOrCommand : "local";
  const cliArgs = knownTargets.has(targetOrCommand)
    ? normalizeCliArgs(restArgs)
    : normalizeCliArgs(argv);
  const childEnv = { ...env };

  if (target === "preview") {
    childEnv.PLAYWRIGHT_TARGET = "preview";
  } else {
    const localPort = resolveDevPort({ cwd, env });
    const localBaseUrl = resolveDevBaseUrl({ cwd, env });
    childEnv.PLAYWRIGHT_BASE_URL = localBaseUrl;
    childEnv.PORT = String(localPort);
    delete childEnv.PLAYWRIGHT_TARGET;
  }

  return {
    childEnv,
    cliArgs,
    target,
  };
}

function run() {
  const { childEnv, cliArgs, target } = resolveRunPlaywrightOptions();
  if (target === "local") {
    console.log(`Playwright local target: ${childEnv.PLAYWRIGHT_BASE_URL}`);
  }

  const child = spawn(process.execPath, [playwrightCliPath, ...cliArgs], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
