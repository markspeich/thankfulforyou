import path from "node:path";

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

  const match = workspacePath.match(/[\\/]worktrees[\\/](\d+)(?:[\\/]|$)/i);
  return match ? Number(match[1]) : null;
}

export function computeWorktreePort(workspacePath) {
  const worktreeId = extractWorktreeId(workspacePath);
  if (worktreeId !== null) {
    return WORKTREE_PORT_BASE + (worktreeId % WORKTREE_PORT_SPAN);
  }

  if (typeof workspacePath === "string" && workspacePath.trim()) {
    const normalizedPath = path.resolve(workspacePath);
    return WORKTREE_PORT_BASE + (hashString(normalizedPath) % WORKTREE_PORT_SPAN);
  }

  return DEFAULT_DEV_PORT;
}

export function resolveDevPort({ cwd = process.cwd(), env = process.env } = {}) {
  return parsePort(env?.PORT) ?? computeWorktreePort(cwd);
}

export function resolveDevBaseUrl({ cwd = process.cwd(), env = process.env, hostname = "127.0.0.1" } = {}) {
  return `http://${hostname}:${resolveDevPort({ cwd, env })}`;
}
