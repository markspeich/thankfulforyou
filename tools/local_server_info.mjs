import {
  TEST_OPERATOR_EMAIL,
  TEST_OPERATOR_PASSWORD,
} from "./initialize_app.mjs";
import { resolveDevBaseUrl } from "./dev_port.mjs";
import {
  computeSupabaseWorktreePorts,
  resolveSupabaseWorktreeId,
} from "./supabase_worktree_config.mjs";

export function buildLocalServerInfo({
  cwd = process.cwd(),
  appBaseUrl = resolveDevBaseUrl({ cwd }),
  ports,
} = {}) {
  const defaultPorts = computeSupabaseWorktreePorts(resolveSupabaseWorktreeId(cwd));
  const resolvedPorts = {
    ...defaultPorts,
    ...ports,
  };

  return {
    serverUrl: appBaseUrl,
    testUser: TEST_OPERATOR_EMAIL,
    testPassword: TEST_OPERATOR_PASSWORD,
    supabaseStudioUrl: `http://127.0.0.1:${resolvedPorts.studio}`,
  };
}

export function formatLocalServerInfo(info) {
  return [
    `Server URL: ${info.serverUrl}`,
    `Test user: ${info.testUser}`,
    `Test password: ${info.testPassword}`,
    `Supabase Studio: ${info.supabaseStudioUrl}`,
  ];
}
