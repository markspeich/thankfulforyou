import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildApiQuery } from "../../tools/dev_server_request.mjs";

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

function patchMalformedJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({
      method: "PATCH",
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

function stopDevServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
    if (!child.killed) {
      child.kill();
    }
  });
}

afterEach(async () => {
  const children = sessions.splice(0);
  await Promise.all(children.map(stopDevServer));
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

describe("dev server Etsy api wrapper", () => {
  it("routes Etsy connection requests through the API handler", async () => {
    const port = await reserveAvailableDevServerTestPort();
    await startDevServer(port);
    const response = await putMalformedJson(port, "/api/etsy-connection");
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "API payload must be valid JSON." });
  }, 15000);
});
describe("dev server Etsy callback wrapper", () => {
  it("maps callback query parameters exactly into API request context", () => {
    const requestUrl = new URL("/api/etsy-callback?code=query-code&state=query-state", "http://localhost");
    expect(buildApiQuery(requestUrl)).toEqual({ code: "query-code", state: "query-state" });
  });
  it("passes callback query parameters to handler redirect behavior", async () => {
    const port = await reserveAvailableDevServerTestPort();
    await startDevServer(port);
    const response = await new Promise((resolve, reject) => {
      const req = request({ method: "GET", host: "127.0.0.1", port, path: "/api/etsy-callback?code=query-code&state=query-state" }, (res) => {
        res.resume();
        res.on("end", () => resolve({ statusCode: res.statusCode, location: res.headers.location, cookie: res.headers["set-cookie"] }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(response).toMatchObject({ statusCode: 302, location: "/orders?etsy=connection-error" });
    expect(response.cookie?.[0]).toContain("Max-Age=0");
  }, 15000);
});
describe("dev server fonts api wrapper", () => {
  it("parses PATCH JSON bodies before routing to the fonts API handler", async () => {
    const port = await reserveAvailableDevServerTestPort();
    await startDevServer(port);

    const response = await patchMalformedJson(port, "/api/fonts?fontId=candlepin");

    expect(response.statusCode).toBe(400);
    expect(response.contentType).toContain("application/json");
    expect(JSON.parse(response.body)).toEqual({ error: "API payload must be valid JSON." });
  }, 15000);
});

describe("dev server Etsy import wrapper", () => {
  it("maps /api/etsy-import to its API handler", async () => {
    const source = await readFile("tools/dev_server.mjs", "utf8");
    expect(source).toContain('"/api/etsy-import": "../api/etsy-import.js"');
  });
});
