import { describe, expect, it, vi } from "vitest";

import {
  buildPrepareLocalEnvSteps,
  prepareLocalEnv,
} from "../../tools/prepare_local_env.mjs";

describe("prepare local env tool", () => {
  it("builds the repeatable per-worktree preparation sequence", () => {
    expect(buildPrepareLocalEnvSteps("C:/repo/.local/supabase/42f4")).toEqual([
      {
        label: "Start isolated Supabase stack",
        command: "npx",
        args: ["supabase", "--workdir", "C:/repo/.local/supabase/42f4", "start"],
      },
      {
        label: "Reset local schema and seed",
        command: "npx",
        args: ["supabase", "--workdir", "C:/repo/.local/supabase/42f4", "db", "reset", "--local"],
      },
      {
        label: "Initialize app test data",
        command: "node",
        args: ["tools/run_with_supabase_env.mjs", "--env", "local", "--", "node", "tools/initialize_app.mjs"],
      },
      {
        label: "Print local Supabase status env",
        command: "npx",
        args: ["supabase", "--workdir", "C:/repo/.local/supabase/42f4", "status", "--output", "env"],
      },
    ]);
  });

  it("generates config once and runs each preparation step", async () => {
    const calls = [];
    const logs = [];
    const generateConfig = vi.fn().mockResolvedValue({
      id: "42f4",
      workdir: "C:/repo/.local/supabase/42f4",
      projectId: "thankfulforyou-42f4",
      ports: { api: 58920, db: 58921, studio: 58923 },
      appBaseUrl: "http://127.0.0.1:4668",
    });
    const spawn = vi.fn((command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    });

    const result = await prepareLocalEnv({
      generateConfig,
      spawn,
      log: (message) => logs.push(message),
    });

    expect(generateConfig).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => [call.command, call.args])).toEqual(
      buildPrepareLocalEnvSteps("C:/repo/.local/supabase/42f4")
        .map((step) => [step.command, step.args]),
    );
    expect(result).toMatchObject({
      id: "42f4",
      workdir: "C:/repo/.local/supabase/42f4",
      projectId: "thankfulforyou-42f4",
    });
    expect(logs).toContain("Server URL: http://127.0.0.1:4668");
    expect(logs).toContain("Test user: test.operator@example.com");
    expect(logs).toContain("Test password: TestOperator123!");
    expect(logs).toContain("Supabase Studio: http://127.0.0.1:58923");
  });

  it("stops when a preparation step fails", async () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    await expect(prepareLocalEnv({
      generateConfig: async () => ({ workdir: "C:/repo/.local/supabase/42f4" }),
      spawn,
    })).rejects.toThrow("Reset local schema and seed failed with exit code 1.");

    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
