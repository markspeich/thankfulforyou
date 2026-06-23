import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearDevServerPid,
  readDevServerState,
  writeDevServerState,
} from "../../tools/dev_server_state.mjs";

const tempDirs = [];

function makeTempCwd() {
  const cwd = mkdtempSync(join(tmpdir(), "tfy-dev-state-"));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("dev server state", () => {
  it("clears only the selected role pid from paired server state", () => {
    const cwd = makeTempCwd();
    writeDevServerState({
      port: 4679,
      pid: 222,
      startedAt: "test-start",
      ports: { user: 4678, test: 4679 },
      servers: {
        user: { port: 4678, pid: 111, startedAt: "user-start" },
        test: { port: 4679, pid: 222, startedAt: "test-start" },
      },
    }, { cwd });

    clearDevServerPid({ cwd, role: "test" });

    expect(readDevServerState({ cwd })).toEqual({
      port: 4679,
      ports: { user: 4678, test: 4679 },
      servers: {
        user: { port: 4678, pid: 111, startedAt: "user-start" },
        test: { port: 4679 },
      },
    });
  });
});
