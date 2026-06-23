import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearDevServerPid,
  readDevServerState,
} from "./dev_server_state.mjs";

const execFileAsync = promisify(execFile);

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function normalizeRole(role) {
  return role === "test" ? "test" : "user";
}

function selectServerState(state, role) {
  if (state?.servers?.[role]) {
    return state.servers[role];
  }

  return state;
}

function isDevServerCommand(processInfo) {
  return normalizePathText(processInfo?.commandLine).includes("tools/dev_server.mjs");
}

function processMatchesWorktreeServer({ cwd, processInfo }) {
  const commandLine = normalizePathText(processInfo?.commandLine);
  if (!isDevServerCommand(processInfo)) {
    return false;
  }

  const normalizedRoot = normalizePathText(resolve(cwd));
  return commandLine.includes(normalizedRoot);
}

export function planDevServerStop({ cwd = process.cwd(), candidatePid, processInfo } = {}) {
  if (!candidatePid) {
    return { ok: false, reason: "missing-pid" };
  }

  if (!processMatchesWorktreeServer({ cwd, processInfo })) {
    return { ok: false, reason: "process-mismatch" };
  }

  return { ok: true, pid: candidatePid };
}

async function defaultGetProcessInfo({ pid }) {
  if (!pid) {
    return null;
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`,
      ]);
      const commandLine = stdout.trim();
      return commandLine ? { pid, commandLine } : null;
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    const commandLine = stdout.trim();
    return commandLine ? { pid, commandLine } : null;
  } catch {
    return null;
  }
}

async function defaultFindListeningPid(port) {
  if (!port) {
    return null;
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess`,
      ]);
      const pid = Number(stdout.trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    const pid = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function defaultKillProcess(pid) {
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  process.kill(pid, "SIGTERM");
}

export async function stopDevServer({
  cwd = process.cwd(),
  env = process.env,
  role,
  readState = () => readDevServerState({ cwd }),
  findListeningPid = defaultFindListeningPid,
  getProcessInfo = defaultGetProcessInfo,
  killProcess = defaultKillProcess,
  clearPid = (resolvedRole) => clearDevServerPid({ cwd, role: resolvedRole }),
} = {}) {
  const resolvedRole = normalizeRole(role || env?.DEV_SERVER_PORT_ROLE);
  const rootState = readState();
  const state = selectServerState(rootState, resolvedRole);
  if (!state?.port && !state?.pid) {
    return { stopped: false, reason: "missing-state" };
  }

  if (state?.pid) {
    const processInfo = await getProcessInfo({ pid: state.pid });
    if (processInfo) {
      const plan = planDevServerStop({ cwd, candidatePid: state.pid, processInfo });
      if (!plan.ok) {
        const listeningPid = await findListeningPid(state.port);
        if (listeningPid !== state.pid || !isDevServerCommand(processInfo)) {
          return { stopped: false, reason: "recorded-pid-mismatch" };
        }
      }

      await killProcess(state.pid);
      clearPid(resolvedRole);
      return { stopped: true, pid: state.pid, source: "state-pid" };
    }
  }

  const listeningPid = await findListeningPid(state.port);
  if (!listeningPid) {
    clearPid(resolvedRole);
    return { stopped: false, reason: "not-running" };
  }

  const processInfo = await getProcessInfo({ pid: listeningPid });
  const plan = planDevServerStop({ cwd, candidatePid: listeningPid, processInfo });
  if (!plan.ok) {
    return { stopped: false, reason: "listening-pid-mismatch" };
  }

  await killProcess(plan.pid);
  clearPid(resolvedRole);
  return { stopped: true, pid: plan.pid, source: "state-port" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await stopDevServer();
  if (result.stopped) {
    console.log(`Stopped dev server process ${result.pid} (${result.source}).`);
  } else {
    console.log(`No dev server stopped (${result.reason}).`);
  }
}