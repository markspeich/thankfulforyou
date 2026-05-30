import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./env_file.mjs";

const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function defaultSeedPath() {
  return process.env.TFU_SHARED_ENV_PATH
    || join(homedir(), "CodexProjects", "thankfulforyou", ".env.local.shared");
}

function hasValue(values, key) {
  return typeof values[key] === "string" && values[key].trim() !== "";
}

function formatEnvLine(key, value) {
  return /^[^\s#'"]+$/.test(value)
    ? `${key}=${value}`
    : `${key}=${JSON.stringify(value)}`;
}

function mergeEnvSource(existingSource, valuesToMerge) {
  const lines = existingSource ? existingSource.split(/\r?\n/) : [];
  const handledKeys = new Set();
  const mergedLines = lines.map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/);
    if (!match) {
      return line;
    }

    const key = match[2];
    if (!Object.hasOwn(valuesToMerge, key)) {
      return line;
    }

    handledKeys.add(key);
    return formatEnvLine(key, valuesToMerge[key]);
  });

  for (const [key, value] of Object.entries(valuesToMerge)) {
    if (!handledKeys.has(key)) {
      mergedLines.push(formatEnvLine(key, value));
    }
  }

  return `${mergedLines.join("\n").replace(/\n+$/, "")}\n`;
}

export async function setupWorktreeEnv({
  cwd = process.cwd(),
  seedPath = defaultSeedPath(),
  envFilename = ".env.local",
  requiredKeys = REQUIRED_ENV_KEYS,
  write = true,
} = {}) {
  const envPath = join(cwd, envFilename);
  const envSource = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const seedSource = existsSync(seedPath) ? await readFile(seedPath, "utf8") : "";
  const envValues = parseEnvFile(envSource);
  const seedValues = parseEnvFile(seedSource);

  const valuesToMerge = {};
  for (const key of requiredKeys) {
    if (!hasValue(envValues, key) && hasValue(seedValues, key)) {
      valuesToMerge[key] = seedValues[key];
      envValues[key] = seedValues[key];
    }
  }

  const copiedKeys = Object.keys(valuesToMerge);
  if (write && copiedKeys.length) {
    await writeFile(envPath, mergeEnvSource(envSource, valuesToMerge), "utf8");
  }

  const missingKeys = requiredKeys.filter((key) => !hasValue(envValues, key));
  return {
    envPath,
    seedPath,
    copiedKeys,
    missingKeys,
    valid: missingKeys.length === 0,
  };
}

async function main() {
  const checkOnly = process.argv.includes("--check-only");
  const result = await setupWorktreeEnv({ write: !checkOnly });

  if (!result.valid) {
    console.error("Production batch environment is incomplete.");
    console.error(`Missing required keys: ${result.missingKeys.join(", ")}`);
    console.error(`Add them to .env.local or to the machine-local seed file: ${result.seedPath}`);
    process.exitCode = 1;
    return;
  }

  if (result.copiedKeys.length) {
    console.log(`Prepared .env.local from seed file: ${result.copiedKeys.join(", ")}`);
    return;
  }

  console.log("Worktree environment ready.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unable to prepare worktree environment.");
    process.exitCode = 1;
  });
}
