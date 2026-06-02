import { spawnSync } from "node:child_process";
import { loadEnvFile } from "./env_file.mjs";
import { setupWorktreeEnv } from "./setup_worktree_env.mjs";

export const REQUIRED_SUPABASE_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

export function parseSupabaseStatusEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

export function buildLocalSupabaseEnv(values) {
  return {
    SUPABASE_URL: values.API_URL,
    SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY || values.ANON_KEY,
    SUPABASE_ANON_KEY: values.ANON_KEY || values.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY || values.SECRET_KEY,
  };
}

export function validateSupabaseEnv(values, requiredKeys = REQUIRED_SUPABASE_ENV_KEYS) {
  return requiredKeys.filter((key) => typeof values[key] !== "string" || values[key].trim() === "");
}

function quoteWindowsShellArg(arg) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function buildWindowsShellCommand(command, args) {
  return [command, ...args].map(quoteWindowsShellArg).join(" ");
}

export function spawnCommand(command, args, options = {}) {
  return process.platform === "win32"
    ? spawnSync(buildWindowsShellCommand(command, args), {
      shell: true,
      ...options,
    })
    : spawnSync(command, args, options);
}

export function readLocalSupabaseEnv() {
  const result = spawnCommand("npx", ["supabase", "status", "--output", "env"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  return buildLocalSupabaseEnv(parseSupabaseStatusEnv(result.stdout));
}

export async function resolveRemoteSupabaseEnv({
  cwd = process.cwd(),
  env = process.env,
  seedPath,
} = {}) {
  const targetEnv = { ...env };
  const setupOptions = { cwd, write: true };
  if (seedPath) {
    setupOptions.seedPath = seedPath;
  }

  const setup = await setupWorktreeEnv(setupOptions);
  if (!setup.valid) {
    console.error("Remote Supabase environment is incomplete.");
    console.error(`Missing required keys: ${setup.missingKeys.join(", ")}`);
    console.error(`Add them to .env.local or to the machine-local seed file: ${setup.seedPath}`);
    process.exit(1);
  }

  loadEnvFile({ cwd, env: targetEnv });

  return Object.fromEntries(
    Object.entries(targetEnv).filter(([key]) => key.startsWith("SUPABASE_")),
  );
}

export function parseSupabaseEnvMode(argv, fallback = "local") {
  const envIndex = argv.indexOf("--env");
  if (envIndex === -1) {
    return fallback;
  }

  const mode = argv[envIndex + 1];
  if (mode !== "local" && mode !== "remote") {
    console.error("--env must be either local or remote.");
    process.exit(1);
  }

  return mode;
}

export async function resolveSupabaseEnv(mode, options = {}) {
  if (mode === "local") {
    return readLocalSupabaseEnv();
  }

  if (mode === "remote") {
    return resolveRemoteSupabaseEnv(options);
  }

  console.error("Supabase env mode must be either local or remote.");
  process.exit(1);
}

export function assertSupabaseEnv(values) {
  const missingKeys = validateSupabaseEnv(values);
  if (missingKeys.length) {
    console.error(`Missing ${missingKeys.join(", ")} from Supabase environment.`);
    process.exit(1);
  }
}
