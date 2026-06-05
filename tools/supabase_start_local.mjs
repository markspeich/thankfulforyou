import { generateSupabaseWorktreeConfig } from "./supabase_worktree_config.mjs";
import { spawnCommand } from "./supabase_env.mjs";

const config = await generateSupabaseWorktreeConfig();
console.log(`Supabase workdir: ${config.workdir}`);
console.log(`Supabase project: ${config.projectId}`);

const result = spawnCommand("npx", ["supabase", "--workdir", config.workdir, "start"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
