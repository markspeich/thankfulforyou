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

export function clearDevServerPid(options = {}) {
  const current = readDevServerState(options);
  if (!current) {
    return null;
  }

  const { pid, startedAt, ...rest } = current;
  writeDevServerState(rest, options);
  return rest;
}
