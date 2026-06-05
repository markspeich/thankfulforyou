import { generateSupabaseWorktreeConfig } from "./supabase_worktree_config.mjs";
import { spawnCommand } from "./supabase_env.mjs";

const passthroughArgs = process.argv.slice(2);
const config = await generateSupabaseWorktreeConfig();

const result = spawnCommand("npx", [
  "supabase",
  "--workdir",
  config.workdir,
  "stop",
  ...passthroughArgs,
], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
