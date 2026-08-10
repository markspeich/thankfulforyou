import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCommand } from "./supabase_env.mjs";

export const PRODUCTION_PROJECT_REF = "oezjskcygvfyezvoulzw";
const MIGRATION_FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

export async function readLocalMigrationVersions(cwd = process.cwd()) {
  const migrationsDir = resolve(cwd, "supabase", "migrations");
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => MIGRATION_FILE_PATTERN.exec(entry.name)?.[1] ?? null)
    .filter(Boolean)
    .sort();
}

export function parseRemoteMigrationVersions(stdout) {
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.result)
          ? parsed.result
          : [];

  return rows
    .map((row) => String(row?.version || "").trim())
    .filter(Boolean)
    .sort();
}

export function parseMigrationListOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed?.migrations)) {
      return parsed.migrations.map((row) => ({
        local: String(row?.local || "").trim() || null,
        remote: String(row?.remote || "").trim() || null,
      }));
    }
  } catch {
    // Older Supabase CLI versions print a table instead of JSON.
  }

  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/.exec(line);
    if (!match) {
      continue;
    }
    rows.push({
      local: match[1] || null,
      remote: match[2] || null,
    });
  }
  return rows;
}

export function findMissingMigrationVersions({ localVersions, remoteVersions }) {
  const remote = new Set(remoteVersions);
  return localVersions.filter((version) => !remote.has(version));
}

export function summarizeMigrationListDrift(rows) {
  return {
    localOnlyVersions: rows.filter((row) => row.local && !row.remote).map((row) => row.local),
    remoteOnlyVersions: rows.filter((row) => row.remote && !row.local).map((row) => row.remote),
  };
}

function runSupabaseCli(args, { commandLabel }) {
  const result = spawnCommand("npx", ["supabase", ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = result.stderr || result.stdout || "";
    if (output) {
      process.stderr.write(output);
    }
    throw new Error(commandLabel);
  }

  return result.stdout;
}

export function ensureProductionLink() {
  runSupabaseCli(["link", "--project-ref", PRODUCTION_PROJECT_REF], {
    commandLabel: `Unable to link Supabase CLI to production project ${PRODUCTION_PROJECT_REF}.`,
  });
}

export function readProductionMigrationList() {
  return runSupabaseCli(["migration", "list", "--linked"], {
    commandLabel: "Unable to read production migration history.",
  });
}

export async function checkMigrationDrift({
  linkProduction = true,
  migrationListOutput = null,
} = {}) {
  if (linkProduction) {
    ensureProductionLink();
  }
  const output = migrationListOutput ?? readProductionMigrationList();
  const rows = parseMigrationListOutput(output);
  const drift = summarizeMigrationListDrift(rows);

  return {
    rows,
    ...drift,
    missingVersions: drift.localOnlyVersions,
  };
}

export function isMainModule(moduleUrl, argvPath) {
  if (!argvPath) {
    return false;
  }
  return resolve(fileURLToPath(moduleUrl)) === resolve(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  checkMigrationDrift()
    .then((result) => {
      if (result.localOnlyVersions.length || result.remoteOnlyVersions.length) {
        console.error("Production Supabase migration history does not match checked-in migrations.");
        if (result.localOnlyVersions.length) {
          console.error("Local-only migrations:");
          for (const version of result.localOnlyVersions) {
            console.error(`- ${version}`);
          }
        }
        if (result.remoteOnlyVersions.length) {
          console.error("Remote-only migrations:");
          for (const version of result.remoteOnlyVersions) {
            console.error(`- ${version}`);
          }
        }
        process.exit(1);
      }

      console.log(`Production Supabase migration history matches ${result.rows.length} checked-in migrations.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
