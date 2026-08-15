import {
  assertSupabaseEnv,
  parseSupabaseEnvMode,
  resolveSupabaseEnv,
  spawnCommand,
} from "./supabase_env.mjs";
import { generateSupabaseWorktreeConfig } from "./supabase_worktree_config.mjs";

function run(command, args, options = {}) {
  const result = spawnCommand(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const mode = parseSupabaseEnvMode(process.argv.slice(2), "local");
const testTargets = process.argv.slice(2).filter((argument, index, argumentsList) => (
  argument !== "--env" && argumentsList[index - 1] !== "--env"
));

if (mode === "local") {
  const config = await generateSupabaseWorktreeConfig();
  run("npx", ["supabase", "--workdir", config.workdir, "db", "reset", "--local"]);
}

const supabaseEnv = await resolveSupabaseEnv(mode);
assertSupabaseEnv(supabaseEnv);

run("vitest", ["run", "--config", "vitest.db.config.js", ...testTargets], {
  env: {
    ...process.env,
    ...supabaseEnv,
  },
});
