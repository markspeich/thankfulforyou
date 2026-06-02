import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = process.platform === "win32"
    ? spawnSync([command, ...args].join(" "), {
      stdio: "inherit",
      shell: true,
      ...options,
    })
    : spawnSync(command, args, {
      stdio: "inherit",
      ...options,
    });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readLocalSupabaseEnv() {
  const result = process.platform === "win32"
    ? spawnSync("npx supabase status --output env", {
      encoding: "utf8",
      shell: true,
    })
    : spawnSync("npx", ["supabase", "status", "--output", "env"], {
      encoding: "utf8",
    });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) {
      values[match[1]] = match[2];
    }
  }

  return {
    SUPABASE_URL: values.API_URL,
    SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY || values.ANON_KEY,
    SUPABASE_ANON_KEY: values.ANON_KEY || values.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY || values.SECRET_KEY,
  };
}

run("node", ["tools/setup_worktree_env.mjs"]);
run("npx", ["supabase", "db", "reset", "--local"]);

const supabaseEnv = readLocalSupabaseEnv();
for (const [key, value] of Object.entries(supabaseEnv)) {
  if (!value) {
    console.error(`Missing ${key} from local Supabase status output.`);
    process.exit(1);
  }
}

run("vitest", ["run", "--config", "vitest.db.config.js"], {
  env: {
    ...process.env,
    ...supabaseEnv,
  },
});
