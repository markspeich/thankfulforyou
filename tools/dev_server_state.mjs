import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function resolveDevServerStatePath(cwd = process.cwd()) {
  return join(resolve(cwd), ".local", "dev-server.json");
}

export function readDevServerState({ cwd = process.cwd(), statePath = resolveDevServerStatePath(cwd) } = {}) {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDevServerState(state, {
  cwd = process.cwd(),
  statePath = resolveDevServerStatePath(cwd),
} = {}) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function mergeDevServerState(patch, options = {}) {
  const current = readDevServerState(options) || {};
  const next = {
    ...current,
    ...patch,
  };
  writeDevServerState(next, options);
  return next;
}

function withoutRuntimeFields(server) {
  if (!server || typeof server !== "object") {
    return server;
  }

  const { pid, startedAt, ...rest } = server;
  return rest;
}

export function clearDevServerPid({ role, ...options } = {}) {
  const current = readDevServerState(options);
  if (!current) {
    return null;
  }

  if (role && current.servers && typeof current.servers === "object") {
    const servers = {
      ...current.servers,
      [role]: withoutRuntimeFields(current.servers[role]),
    };
    const next = { ...current, servers };

    if (current.pid === current.servers?.[role]?.pid) {
      const { pid, startedAt, ...rest } = next;
      writeDevServerState(rest, options);
      return rest;
    }

    writeDevServerState(next, options);
    return next;
  }

  const { pid, startedAt, ...rest } = current;
  writeDevServerState(rest, options);
  return rest;
}