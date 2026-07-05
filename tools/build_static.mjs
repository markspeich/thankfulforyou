import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPublicAppConfigScript } from "./app_config.mjs";
import { loadEnvFile } from "./env_file.mjs";

const root = process.cwd();
const dist = join(root, "dist");
loadEnvFile({ cwd: root });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of ["index.html", "404.html", "src", "public"]) {
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
}

for (const browserDependency of [
  "node_modules/@supabase/supabase-js/dist/umd/supabase.js",
]) {
  cpSync(join(root, browserDependency), join(dist, browserDependency), { recursive: true });
}

writeFileSync(join(dist, "app-config.js"), buildPublicAppConfigScript(), "utf8");
