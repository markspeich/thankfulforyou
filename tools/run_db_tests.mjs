import {
  assertSupabaseEnv,
  parseSupabaseEnvMode,
  resolveSupabaseEnv,
  spawnCommand,
} from "./supabase_env.mjs";

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

if (mode === "local") {
  run("npx", ["supabase", "db", "reset", "--local"]);
}

const supabaseEnv = await resolveSupabaseEnv(mode);
assertSupabaseEnv(supabaseEnv);

run("vitest", ["run", "--config", "vitest.db.config.js"], {
  env: {
    ...process.env,
    ...supabaseEnv,
  },
});
