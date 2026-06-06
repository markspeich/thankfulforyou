import path from "node:path";
import net from "node:net";
import {
  readDevServerState,
  mergeDevServerState,
} from "./dev_server_state.mjs";

export const DEFAULT_DEV_PORT = 4173;
export const WORKTREE_PORT_BASE = 4300;
export const WORKTREE_PORT_SPAN = 500;

function parsePort(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }

  return parsed;
}

function hashString(value) {
  let hash = 0;
  for (const character of value) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function extractWorktreeId(workspacePath) {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    return null;
  }

  const match = workspacePath.match(/[\\/]worktrees[\\/]([^\\/]+)(?:[\\/]|$)/i);
  if (!match) {
    return null;
  }

  return /^\d+$/.test(match[1]) ? Number(match[1]) : match[1];
}

export function computeWorktreePort(workspacePath) {
  const worktreeId = extractWorktreeId(workspacePath);
  if (worktreeId !== null) {
    const worktreePortOffset = typeof worktreeId === "number"
      ? worktreeId % WORKTREE_PORT_SPAN
      : hashString(worktreeId) % WORKTREE_PORT_SPAN;
    return WORKTREE_PORT_BASE + worktreePortOffset;
  }

  if (typeof workspacePath === "string" && workspacePath.trim()) {
    const normalizedPath = path.resolve(workspacePath);
    return WORKTREE_PORT_BASE + (hashString(normalizedPath) % WORKTREE_PORT_SPAN);
  }

  return DEFAULT_DEV_PORT;
}

export function resolveDevPort({ cwd = process.cwd(), env = process.env } = {}) {
  const explicitPort = parsePort(env?.PORT);
  if (explicitPort) {
    return explicitPort;
  }

  if (typeof cwd !== "string" || !cwd.trim()) {
    return DEFAULT_DEV_PORT;
  }

  const statePort = parsePort(readDevServerState({ cwd })?.port);
  return statePort ?? computeWorktreePort(cwd);
}

export function resolveDevBaseUrl({ cwd = process.cwd(), env = process.env, hostname = "127.0.0.1" } = {}) {
  return `http://${hostname}:${resolveDevPort({ cwd, env })}`;
}

export async function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolveAvailability) => {
    const server = net.createServer();
    server.once("error", () => resolveAvailability(false));
    server.once("listening", () => {
      server.close(() => resolveAvailability(true));
    });
    server.listen(port, host);
  });
}

export async function allocateDevPort({
  cwd = process.cwd(),
  env = process.env,
  readState = () => readDevServerState({ cwd }),
  writeState = (state) => mergeDevServerState(state, { cwd }),
  isPortAvailable: isCandidatePortAvailable = isPortAvailable,
} = {}) {
  const explicitPort = parsePort(env?.PORT);
  if (explicitPort) {
    return explicitPort;
  }

  const statePort = parsePort(readState()?.port);
  if (statePort) {
    return statePort;
  }

  const firstCandidate = computeWorktreePort(cwd);
  const startOffset = firstCandidate - WORKTREE_PORT_BASE;

  for (let attempt = 0; attempt < WORKTREE_PORT_SPAN; attempt += 1) {
    const offset = (startOffset + attempt) % WORKTREE_PORT_SPAN;
    const candidate = WORKTREE_PORT_BASE + offset;
    if (await isCandidatePortAvailable(candidate)) {
      writeState({
        worktreeRoot: cwd,
        port: candidate,
        assignedAt: new Date().toISOString(),
      });
      return candidate;
    }
  }

  throw new Error(`No available dev server ports in ${WORKTREE_PORT_BASE}-${WORKTREE_PORT_BASE + WORKTREE_PORT_SPAN - 1}.`);
}
