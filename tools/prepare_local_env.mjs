import { pathToFileURL } from "node:url";
import { spawnCommand } from "./supabase_env.mjs";
import { generateSupabaseWorktreeConfig } from "./supabase_worktree_config.mjs";
import { buildLocalServerInfo, formatLocalServerInfo } from "./local_server_info.mjs";

export function buildPrepareLocalEnvSteps(workdir) {
  return [
    {
      label: "Start isolated Supabase stack",
      command: "npx",
      args: ["supabase", "--workdir", workdir, "start"],
    },
    {
      label: "Reset local schema and seed",
      command: "npx",
      args: ["supabase", "--workdir", workdir, "db", "reset", "--local"],
    },
    {
      label: "Initialize app test data",
      command: "node",
      args: ["tools/run_with_supabase_env.mjs", "--env", "local", "--", "node", "tools/initialize_app.mjs"],
    },
    {
      label: "Print local Supabase status env",
      command: "npx",
      args: ["supabase", "--workdir", workdir, "status", "--output", "env"],
    },
  ];
}

function formatStep(step) {
  return `${step.command} ${step.args.join(" ")}`;
}

export async function prepareLocalEnv({
  generateConfig = generateSupabaseWorktreeConfig,
  spawn = spawnCommand,
  log = console.log,
} = {}) {
  const config = await generateConfig();
  const steps = buildPrepareLocalEnvSteps(config.workdir);

  log(`Supabase workdir: ${config.workdir}`);
  log(`Supabase project: ${config.projectId || "(generated)"}`);
  for (const line of formatLocalServerInfo(buildLocalServerInfo({
    appBaseUrl: config.appBaseUrl,
    ports: config.ports,
  }))) {
    log(line);
  }

  for (const step of steps) {
    log(`\n> ${step.label}`);
    log(formatStep(step));
    const result = spawn(step.command, step.args, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`${step.label} failed with exit code ${result.status ?? 1}.`);
    }
  }

  return config;
}

async function main() {
  await prepareLocalEnv();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
