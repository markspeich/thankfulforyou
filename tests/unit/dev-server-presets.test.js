import { spawn } from "node:child_process";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  WORKTREE_PORT_BASE,
  WORKTREE_PORT_SPAN,
  computeWorktreePort,
  isPortAvailable,
} from "../../tools/dev_port.mjs";

const sessions = [];
const reservedPorts = new Set();

async function reserveAvailableDevServerTestPort() {
  const firstCandidate = computeWorktreePort(process.cwd());
  const startOffset = firstCandidate - WORKTREE_PORT_BASE;

  for (let attempt = 0; attempt < WORKTREE_PORT_SPAN; attempt += 1) {
    const candidate = WORKTREE_PORT_BASE + ((startOffset + attempt) % WORKTREE_PORT_SPAN);
    if (
      !reservedPorts.has(candidate)
      && await isPortAvailable(candidate, "127.0.0.1")
      && await isPortAvailable(candidate, "::")
    ) {
      reservedPorts.add(candidate);
      return candidate;
    }
  }

  throw new Error("No available dev server test port found.");
}

function startDevServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/dev_server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    sessions.push(child);
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for dev server start.\n${stdout}\n${stderr}`));
    }, 10000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(`http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Dev server exited early with code ${code}.\n${stdout}\n${stderr}`));
    });
  });
}

function putMalformedJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({
      method: "PUT",
      host: "127.0.0.1",
      port,
      path,
      headers: {
        "Content-Type": "application/json",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body,
        });
      });
    });

    req.on("error", reject);
    req.end("{not-json");
  });
}

function putMalformedPresetSnapshotJson(port) {
  return putMalformedJson(port, "/api/preset-snapshot");
}

function postMalformedOrdersJson(port) {
  return new Promise((resolve, reject) => {
    const req = request({
      method: "POST",
      host: "127.0.0.1",
      port,
      path: "/api/orders",
      headers: {
        "Content-Type": "application/json",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          contentType: response.headers["content-type"],
          statusCode: response.statusCode,
          body,
        });
      });
    });

    req.on("error", reject);
    req.end("{not-json");
  });
}

afterEach(() => {
  while (sessions.length) {
    const child = sessions.pop();
    if (child && !child.killed) {
      child.kill();
    }
  }
});

describe("dev server preset api wrapper", () => {
  it("returns 400 for malformed preset snapshot json payloads", async () => {
    const port = await reserveAvailableDevServerTestPort();
    await startDevServer(port);

    const response = await putMalformedPresetSnapshotJson(port);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Preset snapshot payload must be valid JSON." });
  }, 15000);
});

describe("dev server orders api wrapper", () => {
  it("routes orders requests through the API handler instead of serving api/orders.js", async () => {
    const port = await reserveAvailableDevServerTestPort();
    await startDevServer(port);

    const response = await postMalformedOrdersJson(port);

    expect(response.statusCode).toBe(400);
    expect(response.contentType).toContain("application/json");
    expect(JSON.parse(response.body)).toEqual({ error: "API payload must be valid JSON." });
  }, 15000);
});
