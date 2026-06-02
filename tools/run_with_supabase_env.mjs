import { spawnCommand, assertSupabaseEnv, parseSupabaseEnvMode, resolveSupabaseEnv } from "./supabase_env.mjs";

const separatorIndex = process.argv.indexOf("--");
if (separatorIndex === -1 || separatorIndex === process.argv.length - 1) {
  console.error("Usage: node tools/run_with_supabase_env.mjs --env local|remote -- <command> [args...]");
  process.exit(1);
}

const mode = parseSupabaseEnvMode(process.argv.slice(2, separatorIndex), "remote");
const command = process.argv[separatorIndex + 1];
const args = process.argv.slice(separatorIndex + 2);
const supabaseEnv = await resolveSupabaseEnv(mode);
assertSupabaseEnv(supabaseEnv);

const result = spawnCommand(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    ...supabaseEnv,
  },
});

process.exit(result.status ?? 1);
