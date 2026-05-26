import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCliPath = require.resolve("playwright/cli");
const [targetOrCommand, ...restArgs] = process.argv.slice(2);

const knownTargets = new Set(["preview", "local"]);
const target = knownTargets.has(targetOrCommand) ? targetOrCommand : "local";
const cliArgs = knownTargets.has(targetOrCommand)
  ? (restArgs.length ? restArgs : ["test"])
  : (process.argv.slice(2).length ? process.argv.slice(2) : ["test"]);
const childEnv = {
  ...process.env,
};

if (target === "preview") {
  childEnv.PLAYWRIGHT_TARGET = "preview";
} else {
  delete childEnv.PLAYWRIGHT_TARGET;
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
