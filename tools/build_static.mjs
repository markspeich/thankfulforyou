import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPublicAppConfigScript } from "./app_config.mjs";

const root = process.cwd();
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of ["index.html", "src", "public"]) {
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
}

writeFileSync(join(dist, "app-config.js"), buildPublicAppConfigScript(), "utf8");
