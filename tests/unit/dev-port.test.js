import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_PORT,
  WORKTREE_PORT_BASE,
  WORKTREE_PORT_SPAN,
  allocateDevPort,
  computeWorktreePort,
  extractWorktreeId,
  resolveDevBaseUrl,
  resolveDevPort,
} from "../../tools/dev_port.mjs";

describe("dev port helper", () => {
  it("extracts the numeric worktree id from a Codex worktree path", () => {
    expect(extractWorktreeId("C:/Users/Mark/.codex/worktrees/3910/thankfulforyou")).toBe(3910);
    expect(extractWorktreeId("C:\\Users\\Mark\\.codex\\worktrees\\17\\demo")).toBe(17);
    expect(extractWorktreeId("C:/Users/Mark/CodexProjects/thankfulforyou")).toBeNull();
  });

  it("extracts alphanumeric Codex worktree ids", () => {
    expect(extractWorktreeId("C:/Users/Mark/.codex/worktrees/440a/thankfulforyou")).toBe("440a");
  });

  it("derives a stable port from the worktree id when PORT is unset", () => {
    expect(resolveDevPort({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: {},
    })).toBe(WORKTREE_PORT_BASE + 320);
  });

  it("derives adjacent stable user and test ports for each worktree", () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou";

    expect(computeWorktreePort(cwd, { role: "user" })).toBe(WORKTREE_PORT_BASE + 320);
    expect(computeWorktreePort(cwd, { role: "test" })).toBe(WORKTREE_PORT_BASE + 321);
    expect(resolveDevPort({ cwd, env: { DEV_SERVER_PORT_ROLE: "test" } })).toBe(WORKTREE_PORT_BASE + 321);
  });

  it("honors an explicit PORT override", () => {
    expect(resolveDevPort({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: { PORT: "4999" },
    })).toBe(4999);
  });

  it("falls back to a deterministic path hash outside a worktree", () => {
    const first = computeWorktreePort("C:/Users/Mark/CodexProjects/thankfulforyou");
    const second = computeWorktreePort("C:/Users/Mark/CodexProjects/thankfulforyou");

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(WORKTREE_PORT_BASE);
    expect(first).toBeLessThan(WORKTREE_PORT_BASE + WORKTREE_PORT_SPAN);
  });

  it("builds a local base URL from the shared port resolution", () => {
    expect(resolveDevBaseUrl({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: {},
    })).toBe("http://127.0.0.1:4620");
    expect(resolveDevBaseUrl({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: { DEV_SERVER_PORT_ROLE: "test" },
    })).toBe("http://127.0.0.1:4621");
  });

  it("uses the legacy default when no path context exists", () => {
    expect(resolveDevPort({ cwd: "", env: {} })).toBe(DEFAULT_DEV_PORT);
  });

  it("reuses a persisted worktree port when PORT is unset", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const state = { ports: { user: computeWorktreePort(cwd, { role: "user" }) } };
    const port = await allocateDevPort({
      cwd,
      env: {},
      readState: () => state,
      writeState: () => {},
      isPortAvailable: async () => true,
    });

    expect(port).toBe(computeWorktreePort(cwd, { role: "user" }));
  });


  it("ignores stale persisted ports that do not match the deterministic role port", () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const candidate = computeWorktreePort(cwd, { role: "user" });

    expect(resolveDevPort({
      cwd,
      env: {},
      readState: () => ({ ports: { user: candidate + 2 } }),
    })).toBe(candidate);
  });
  it("uses the role-specific persisted port instead of another role's port", () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const userPort = computeWorktreePort(cwd, { role: "user" });
    const testPort = computeWorktreePort(cwd, { role: "test" });

    expect(resolveDevPort({
      cwd,
      env: { DEV_SERVER_PORT_ROLE: "test" },
      readState: () => ({ ports: { user: userPort } }),
    })).toBe(testPort);
  });

  it("persists the assigned role candidate when no state exists", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const candidate = computeWorktreePort(cwd, { role: "test" });
    const writes = [];
    const port = await allocateDevPort({
      cwd,
      env: { DEV_SERVER_PORT_ROLE: "test" },
      readState: () => null,
      writeState: (state) => writes.push(state),
      isPortAvailable: async () => true,
    });

    expect(port).toBe(candidate);
    expect(writes).toEqual([
      expect.objectContaining({
        ports: expect.objectContaining({ test: candidate }),
        worktreeRoot: cwd,
      }),
    ]);
  });

  it("fails instead of silently switching when the assigned role port is occupied", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/9999/thankfulforyou";
    const candidate = computeWorktreePort(cwd, { role: "user" });
    const checked = [];

    await expect(allocateDevPort({
      cwd,
      env: {},
      readState: () => null,
      writeState: () => {},
      isPortAvailable: async (checkedPort) => {
        checked.push(checkedPort);
        return false;
      },
    })).rejects.toThrow(`Assigned user dev server port ${candidate} is already in use`);

    expect(checked).toEqual([candidate]);
  });
});
