import path from "node:path";
import net from "node:net";
import {
  readDevServerState,
  mergeDevServerState,
} from "./dev_server_state.mjs";

export const DEFAULT_DEV_PORT = 4173;
export const WORKTREE_PORT_BASE = 4300;
export const WORKTREE_PORT_SPAN = 500;
export const WORKTREE_PORTS_PER_SLOT = 2;
export const WORKTREE_PORT_SLOT_COUNT = Math.floor(WORKTREE_PORT_SPAN / WORKTREE_PORTS_PER_SLOT);
export const DEV_PORT_ROLES = Object.freeze({
  USER: "user",
  TEST: "test",
});

const ROLE_OFFSETS = Object.freeze({
  [DEV_PORT_ROLES.USER]: 0,
  [DEV_PORT_ROLES.TEST]: 1,
});

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

function normalizeRole(role) {
  return Object.hasOwn(ROLE_OFFSETS, role) ? role : DEV_PORT_ROLES.USER;
}

function resolveRole({ role, env = process.env } = {}) {
  return normalizeRole(role || env?.DEV_SERVER_PORT_ROLE);
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

function computeWorktreeSlot(workspacePath) {
  const worktreeId = extractWorktreeId(workspacePath);
  if (worktreeId !== null) {
    return typeof worktreeId === "number"
      ? worktreeId % WORKTREE_PORT_SLOT_COUNT
      : hashString(worktreeId) % WORKTREE_PORT_SLOT_COUNT;
  }

  if (typeof workspacePath === "string" && workspacePath.trim()) {
    const normalizedPath = path.resolve(workspacePath);
    return hashString(normalizedPath) % WORKTREE_PORT_SLOT_COUNT;
  }

  return null;
}

export function computeWorktreePort(workspacePath, { role } = {}) {
  const slot = computeWorktreeSlot(workspacePath);
  if (slot === null) {
    return DEFAULT_DEV_PORT;
  }

  const normalizedRole = normalizeRole(role);
  return WORKTREE_PORT_BASE + (slot * WORKTREE_PORTS_PER_SLOT) + ROLE_OFFSETS[normalizedRole];
}

function readRolePort(state, role) {
  return parsePort(state?.ports?.[role]);
}

export function resolveDevPort({
  cwd = process.cwd(),
  env = process.env,
  role,
  readState = () => readDevServerState({ cwd }),
} = {}) {
  const explicitPort = parsePort(env?.PORT);
  if (explicitPort) {
    return explicitPort;
  }

  if (typeof cwd !== "string" || !cwd.trim()) {
    return DEFAULT_DEV_PORT;
  }

  const resolvedRole = resolveRole({ role, env });
  const candidate = computeWorktreePort(cwd, { role: resolvedRole });
  const statePort = readRolePort(readState(), resolvedRole);
  return statePort === candidate ? statePort : candidate;
}

export function resolveDevBaseUrl({ cwd = process.cwd(), env = process.env, hostname = "127.0.0.1", role } = {}) {
  return `http://${hostname}:${resolveDevPort({ cwd, env, role })}`;
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
  role,
  readState = () => readDevServerState({ cwd }),
  writeState = (state) => mergeDevServerState(state, { cwd }),
  isPortAvailable: isCandidatePortAvailable = isPortAvailable,
} = {}) {
  const explicitPort = parsePort(env?.PORT);
  if (explicitPort) {
    return explicitPort;
  }

  const resolvedRole = resolveRole({ role, env });
  const currentState = readState() || {};
  const candidate = computeWorktreePort(cwd, { role: resolvedRole });
  const statePort = readRolePort(currentState, resolvedRole);
  if (statePort === candidate) {
    return statePort;
  }
  if (!await isCandidatePortAvailable(candidate)) {
    throw new Error(
      `Assigned ${resolvedRole} dev server port ${candidate} is already in use. `
      + "Stop that server or set PORT explicitly for a one-off override.",
    );
  }

  writeState({
    worktreeRoot: cwd,
    port: candidate,
    ports: {
      ...(currentState.ports && typeof currentState.ports === "object" ? currentState.ports : {}),
      [resolvedRole]: candidate,
    },
    assignedAt: new Date().toISOString(),
  });
  return candidate;
}
