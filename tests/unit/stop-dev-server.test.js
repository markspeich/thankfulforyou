import { describe, expect, it } from "vitest";

import {
  planDevServerStop,
  stopDevServer,
} from "../../tools/stop_dev_server.mjs";

describe("stop dev server", () => {
  const cwd = "C:/Users/Mark/.codex/worktrees/440a/thankfulforyou";

  it("does nothing when this worktree has no recorded server state", async () => {
    const result = await stopDevServer({
      cwd,
      readState: () => null,
      findListeningPid: async () => null,
      getProcessInfo: async () => null,
      killProcess: async () => {
        throw new Error("should not kill");
      },
    });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("missing-state");
  });

  it("stops the recorded pid when it belongs to this worktree server", async () => {
    const killed = [];
    const result = await stopDevServer({
      cwd,
      readState: () => ({ pid: 123, port: 4668, worktreeRoot: cwd }),
      findListeningPid: async () => null,
      getProcessInfo: async () => ({
        pid: 123,
        commandLine: `node --watch ${cwd}/tools/dev_server.mjs`,
      }),
      killProcess: async (pid) => killed.push(pid),
      clearPid: () => {},
    });

    expect(result).toEqual({ stopped: true, pid: 123, source: "state-pid" });
    expect(killed).toEqual([123]);
  });

  it("stops the recorded pid with a relative command when it listens on this worktree port", async () => {
    const killed = [];
    const result = await stopDevServer({
      cwd,
      readState: () => ({ pid: 123, port: 4668, worktreeRoot: cwd }),
      findListeningPid: async (port) => (port === 4668 ? 123 : null),
      getProcessInfo: async () => ({
        pid: 123,
        commandLine: "node --watch tools/dev_server.mjs",
      }),
      killProcess: async (pid) => killed.push(pid),
      clearPid: () => {},
    });

    expect(result).toEqual({ stopped: true, pid: 123, source: "state-pid" });
    expect(killed).toEqual([123]);
  });


  it("stops the user role server when user and test servers are both recorded", async () => {
    const killed = [];
    const result = await stopDevServer({
      cwd,
      readState: () => ({
        servers: {
          user: { pid: 111, port: 4678, worktreeRoot: cwd },
          test: { pid: 222, port: 4679, worktreeRoot: cwd },
        },
      }),
      findListeningPid: async () => null,
      getProcessInfo: async ({ pid }) => ({
        pid,
        commandLine: `node --watch ${cwd}/tools/dev_server.mjs`,
      }),
      killProcess: async (pid) => killed.push(pid),
      clearPid: () => {},
    });

    expect(result).toEqual({ stopped: true, pid: 111, source: "state-pid" });
    expect(killed).toEqual([111]);
  });
  it("refuses to stop a pid whose command line belongs to another worktree", async () => {
    const result = await stopDevServer({
      cwd,
      readState: () => ({ pid: 123, port: 4668, worktreeRoot: cwd }),
      findListeningPid: async () => null,
      getProcessInfo: async () => ({
        pid: 123,
        commandLine: "node --watch C:/Users/Mark/.codex/worktrees/9999/thankfulforyou/tools/dev_server.mjs",
      }),
      killProcess: async () => {
        throw new Error("should not kill");
      },
    });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("recorded-pid-mismatch");
  });

  it("falls back to the recorded port when the pid is stale", async () => {
    const killed = [];
    const result = await stopDevServer({
      cwd,
      readState: () => ({ pid: 123, port: 4668, worktreeRoot: cwd }),
      findListeningPid: async (port) => (port === 4668 ? 456 : null),
      getProcessInfo: async ({ pid }) => (pid === 123
        ? null
        : {
          pid,
          commandLine: `node --watch ${cwd}/tools/dev_server.mjs`,
        }),
      killProcess: async (pid) => killed.push(pid),
      clearPid: () => {},
    });

    expect(result).toEqual({ stopped: true, pid: 456, source: "state-port" });
    expect(killed).toEqual([456]);
  });

  it("does not plan a stop when the candidate process is unrelated", () => {
    expect(planDevServerStop({
      cwd,
      candidatePid: 456,
      processInfo: {
        pid: 456,
        commandLine: "node --watch C:/elsewhere/tools/dev_server.mjs",
      },
    })).toEqual({
      ok: false,
      reason: "process-mismatch",
    });
  });
});
