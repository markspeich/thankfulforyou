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
    })).toBe(WORKTREE_PORT_BASE + 410);
  });

  it("honors an explicit PORT override", () => {
    expect(resolveDevPort({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: { PORT: "4999" },
    })).toBe(4999);
  });

  it("falls back to a deterministic path hash outside a worktree", () => {
    const first = resolveDevPort({
      cwd: "C:/Users/Mark/CodexProjects/thankfulforyou",
      env: {},
    });
    const second = resolveDevPort({
      cwd: "C:/Users/Mark/CodexProjects/thankfulforyou",
      env: {},
    });

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(WORKTREE_PORT_BASE);
    expect(first).toBeLessThan(WORKTREE_PORT_BASE + 500);
  });

  it("builds a local base URL from the shared port resolution", () => {
    expect(resolveDevBaseUrl({
      cwd: "C:/Users/Mark/.codex/worktrees/3910/thankfulforyou",
      env: {},
    })).toBe("http://127.0.0.1:4710");
  });

  it("uses the legacy default when no path context exists", () => {
    expect(resolveDevPort({ cwd: "", env: {} })).toBe(DEFAULT_DEV_PORT);
  });

  it("reuses a persisted worktree port when PORT is unset", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const state = { port: 4666 };
    const port = await allocateDevPort({
      cwd,
      env: {},
      readState: () => state,
      writeState: () => {},
      isPortAvailable: async () => true,
    });

    expect(port).toBe(4666);
  });

  it("persists the first available candidate when no state exists", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";
    const candidate = computeWorktreePort(cwd);
    const writes = [];
    const port = await allocateDevPort({
      cwd,
      env: {},
      readState: () => null,
      writeState: (state) => writes.push(state),
      isPortAvailable: async (checkedPort) => checkedPort !== candidate,
    });

    expect(port).toBe(candidate + 1);
    expect(writes).toEqual([
      expect.objectContaining({
        port: candidate + 1,
        worktreeRoot: cwd,
      }),
    ]);
  });

  it("wraps allocation within the worktree port range", async () => {
    const cwd = "C:/Users/Mark/.codex/worktrees/9999/thankfulforyou";
    const checked = [];
    const port = await allocateDevPort({
      cwd,
      env: {},
      readState: () => null,
      writeState: () => {},
      isPortAvailable: async (checkedPort) => {
        checked.push(checkedPort);
        return checked.length === 2;
      },
    });

    expect(checked[0]).toBe(WORKTREE_PORT_BASE + (9999 % WORKTREE_PORT_SPAN));
    expect(port).toBe(WORKTREE_PORT_BASE);
  });
});
