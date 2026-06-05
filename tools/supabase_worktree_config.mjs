import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDevBaseUrl } from "./dev_port.mjs";

export const SUPABASE_WORKTREE_PORT_BASE = 55000;
export const SUPABASE_WORKTREE_PORT_SLOT_COUNT = 300;
export const SUPABASE_WORKTREE_PORT_BLOCK_SIZE = 20;

const PORT_OFFSETS = {
  api: 0,
  db: 1,
  dbShadow: 2,
  studio: 3,
  inbucket: 4,
  dbPooler: 5,
  analytics: 6,
  edgeInspector: 7,
};

function hashString(value) {
  let hash = 0;
  for (const character of value) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function sanitizeId(value) {
  const sanitized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "default";
}

export function extractWorktreeKey(workspacePath) {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    return null;
  }

  const match = workspacePath.match(/[\\/]worktrees[\\/]([^\\/]+)(?:[\\/]|$)/i);
  return match ? sanitizeId(match[1]) : null;
}

export function resolveSupabaseWorktreeId(workspacePath = process.cwd()) {
  const worktreeKey = extractWorktreeKey(workspacePath);
  if (worktreeKey) {
    return worktreeKey;
  }

  const normalizedPath = path.resolve(workspacePath || ".");
  const basename = sanitizeId(path.basename(normalizedPath));
  return `${basename}-${hashString(normalizedPath).toString(36)}`;
}

export function computeSupabaseWorktreePorts(worktreeId) {
  const slot = hashString(worktreeId) % SUPABASE_WORKTREE_PORT_SLOT_COUNT;
  const blockStart = SUPABASE_WORKTREE_PORT_BASE + (slot * SUPABASE_WORKTREE_PORT_BLOCK_SIZE);

  return {
    api: blockStart + PORT_OFFSETS.api,
    db: blockStart + PORT_OFFSETS.db,
    dbShadow: blockStart + PORT_OFFSETS.dbShadow,
    studio: blockStart + PORT_OFFSETS.studio,
    inbucket: blockStart + PORT_OFFSETS.inbucket,
    dbPooler: blockStart + PORT_OFFSETS.dbPooler,
    analytics: blockStart + PORT_OFFSETS.analytics,
    edgeInspector: blockStart + PORT_OFFSETS.edgeInspector,
  };
}

export function resolveSupabaseWorktreePaths({ cwd = process.cwd(), worktreeId } = {}) {
  const id = worktreeId || resolveSupabaseWorktreeId(cwd);
  const workdir = path.join(cwd, ".local", "supabase", id);

  return {
    id,
    workdir,
    supabaseDir: path.join(workdir, "supabase"),
    configPath: path.join(workdir, "supabase", "config.toml"),
    seedPath: path.join(workdir, "supabase", "seed.sql"),
    migrationsPath: path.join(workdir, "supabase", "migrations"),
  };
}

function rewriteConfigValue(line, key, value) {
  const escapedValue = typeof value === "number"
    ? String(value)
    : JSON.stringify(value);
  return line.replace(new RegExp(`^(\\s*${key}\\s*=\\s*).*$`), `$1${escapedValue}`);
}

export function buildGeneratedSupabaseConfig(canonicalConfig, {
  projectId,
  ports,
  appBaseUrl,
}) {
  let section = "";

  return canonicalConfig.split(/\r?\n/).map((line) => {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      return line;
    }

    if (/^\s*project_id\s*=/.test(line)) {
      return rewriteConfigValue(line, "project_id", projectId);
    }

    if (section === "api" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.api);
    }

    if (section === "db" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.db);
    }

    if (section === "db" && /^\s*shadow_port\s*=/.test(line)) {
      return rewriteConfigValue(line, "shadow_port", ports.dbShadow);
    }

    if (section === "db.pooler" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.dbPooler);
    }

    if (section === "studio" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.studio);
    }

    if (section === "studio" && /^\s*api_url\s*=/.test(line)) {
      return rewriteConfigValue(line, "api_url", `http://127.0.0.1:${ports.api}`);
    }

    if (section === "inbucket" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.inbucket);
    }

    if (section === "auth" && /^\s*site_url\s*=/.test(line)) {
      return rewriteConfigValue(line, "site_url", appBaseUrl);
    }

    if (section === "auth" && /^\s*additional_redirect_urls\s*=/.test(line)) {
      return rewriteConfigValue(line, "additional_redirect_urls", [appBaseUrl]);
    }

    if (section === "edge_runtime" && /^\s*inspector_port\s*=/.test(line)) {
      return rewriteConfigValue(line, "inspector_port", ports.edgeInspector);
    }

    if (section === "analytics" && /^\s*port\s*=/.test(line)) {
      return rewriteConfigValue(line, "port", ports.analytics);
    }

    return line;
  }).join("\n");
}

export async function generateSupabaseWorktreeConfig({ cwd = process.cwd() } = {}) {
  const paths = resolveSupabaseWorktreePaths({ cwd });
  const ports = computeSupabaseWorktreePorts(paths.id);
  const projectId = `thankfulforyou-${paths.id}`;
  const appBaseUrl = resolveDevBaseUrl({ cwd });

  const canonicalConfig = await readFile(path.join(cwd, "supabase", "config.toml"), "utf8");
  const generatedConfig = buildGeneratedSupabaseConfig(canonicalConfig, {
    projectId,
    ports,
    appBaseUrl,
  });

  await mkdir(paths.supabaseDir, { recursive: true });
  await writeFile(paths.configPath, generatedConfig);
  await rm(paths.migrationsPath, { recursive: true, force: true });
  await cp(path.join(cwd, "supabase", "migrations"), paths.migrationsPath, {
    recursive: true,
    force: true,
  });
  await cp(path.join(cwd, "supabase", "seed.sql"), paths.seedPath, {
    force: true,
  });

  return {
    ...paths,
    projectId,
    ports,
    appBaseUrl,
  };
}
