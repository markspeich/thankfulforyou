import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function stripOptionalQuotes(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function parseEnvFile(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = stripOptionalQuotes(normalizedLine.slice(separatorIndex + 1));
  }

  return values;
}

export function loadEnvFile({
  cwd = process.cwd(),
  env = process.env,
  filename = ".env.local",
  override = false,
} = {}) {
  const path = join(cwd, filename);
  if (!existsSync(path)) {
    return {
      loaded: false,
      path,
      keys: [],
    };
  }

  const parsed = parseEnvFile(readFileSync(path, "utf8"));
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!override && typeof env[key] === "string" && env[key]) {
      continue;
    }

    env[key] = value;
    keys.push(key);
  }

  return {
    loaded: true,
    path,
    keys,
  };
}
