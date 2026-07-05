import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { buildPublicAppConfigScript } from "./app_config.mjs";
import { allocateDevPort } from "./dev_port.mjs";
import { clearDevServerPid, mergeDevServerState, readDevServerState } from "./dev_server_state.mjs";
import { buildLocalServerInfo, formatLocalServerInfo } from "./local_server_info.mjs";

const serverRole = process.env.DEV_SERVER_PORT_ROLE === "test" ? "test" : "user";
const port = await allocateDevPort({ role: serverRole });
const root = process.cwd();
const productionBatchLogPath = process.env.PRODUCTION_BATCH_LOG_PATH
  || join(process.platform === "win32" ? "C:\\tmp" : "/tmp", "thankfulforyou-production-batch.log");
const pythonCommand = process.env.PYTHON || (process.platform === "win32" ? "py" : "python3");
const pythonScriptArgs = process.env.PYTHON
  ? ["tools/export_svg.py"]
  : process.platform === "win32"
    ? ["-3.11", "tools/export_svg.py"]
    : ["tools/export_svg.py"];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
};
const presetSnapshots = new Map();
const appRouteRoots = new Set(["orders", "production-batch", "presets", "fonts", "fixed-designs", "size-guides"]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function appendProductionBatchLog(entry) {
  try {
    await mkdir(dirname(productionBatchLogPath), { recursive: true });
    await appendFile(productionBatchLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("Unable to write production batch log:", error instanceof Error ? error.message : error);
  }
}

function summarizeProductionBatchPayload(payload) {
  const snapshot = payload?.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null;
  const orderItems = Array.isArray(snapshot?.orderItems) ? snapshot.orderItems : [];

  return {
    changedOrderItemIds: Array.isArray(payload?.changedOrderItemIds) ? payload.changedOrderItemIds : null,
    batchId: snapshot?.batch?.id || null,
    workspaceId: snapshot?.batch?.workspaceId || null,
    activeOrderItemId: snapshot?.activeOrderItemId || null,
    orderCount: orderItems.length,
    orders: orderItems.map((order) => ({
      id: order?.id || null,
      revision: order?.revision ?? null,
      status: order?.status || null,
      textPreview: typeof order?.text === "string" ? order.text.replace(/\s+/g, " ").slice(0, 60) : "",
      savedSettingsSignature: typeof order?.savedSettingsSignature === "string" ? order.savedSettingsSignature.slice(0, 80) : null,
      completedSettingsSignature: typeof order?.completedSettingsSignature === "string" ? order.completedSettingsSignature.slice(0, 80) : null,
      pendingAnalysisSignature: typeof order?.pendingAnalysisSignature === "string" ? order.pendingAnalysisSignature.slice(0, 80) : null,
      cachedBuildSignature: typeof order?.cachedBuild?.signature === "string" ? order.cachedBuild.signature.slice(0, 80) : null,
    })),
  };
}

function readRequestBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
  });
}

function runGeometryScript(input, { onSuccess, onError }) {
  const python = spawn(pythonCommand, pythonScriptArgs, { cwd: root });
  let stdout = "";
  let stderr = "";

  python.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  python.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  python.on("close", (code) => {
    if (code !== 0) {
      onError(stderr || "Geometry processing failed");
      return;
    }

    onSuccess(stdout);
  });
  python.stdin.end(input);
}

function resolvePath(url) {
  const requested = new URL(url, `http://localhost:${port}`).pathname;
  const filePath = requested === "/" ? "/index.html" : requested;
  const normalized = normalize(join(root, filePath));

  if (!normalized.startsWith(root)) {
    return null;
  }

  if (!existsSync(normalized)) {
    const withJsExtension = `${normalized}.js`;
    if (existsSync(withJsExtension)) {
      return withJsExtension;
    }
  }

  const routeRoot = requested.split("/").filter(Boolean)[0] || "";
  if (!existsSync(normalized) && !extname(requested) && appRouteRoots.has(routeRoot)) {
    return join(root, "index.html");
  }

  return normalized;
}

async function loadBundledPresetSnapshot() {
  const manifest = JSON.parse(await readFile(join(root, "public", "presets", "manifest.json"), "utf8"));
  const presetDefinitions = await Promise.all(
    (manifest.presets || []).map(async (entry) => {
      const presetPath = join(root, entry.path);
      return JSON.parse(await readFile(presetPath, "utf8"));
    }),
  );

  return {
    version: 1,
    defaultPresetId: manifest.defaultPresetId,
    presets: presetDefinitions,
  };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://localhost:${port}`);

  if (requestUrl.pathname === "/app-config.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(buildPublicAppConfigScript());
    return;
  }

  if (
    requestUrl.pathname === "/api/batch-session"
    || requestUrl.pathname === "/api/orders"
    || requestUrl.pathname === "/api/production-batch"
    || requestUrl.pathname === "/api/fonts"
    || requestUrl.pathname === "/api/fixed-designs"
  ) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const bodyText = request.method === "PUT" || request.method === "POST" || request.method === "PATCH"
      ? await readRequestBody(request)
      : "";
    let payload = undefined;

    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        sendJson(response, 400, { error: "API payload must be valid JSON." });
        return;
      }
    }

    try {
      const modulePathByPathname = {
        "/api/batch-session": "../api/batch-session.js",
        "/api/orders": "../api/orders.js",
        "/api/production-batch": "../api/production-batch.js",
        "/api/fonts": "../api/fonts.js",
        "/api/fixed-designs": "../api/fixed-designs.js",
      };
      const modulePath = modulePathByPathname[requestUrl.pathname];
      const { default: handler } = await import(modulePath);
      const shouldLogProductionBatch = requestUrl.pathname === "/api/production-batch";
      const req = {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
        ),
        query: Object.fromEntries(requestUrl.searchParams.entries()),
        body: payload,
      };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(name, value) {
          response.setHeader(name, value);
        },
        json(jsonPayload) {
          const statusCode = this.statusCode || 200;
          if (shouldLogProductionBatch) {
            void appendProductionBatchLog({
              at: new Date().toISOString(),
              requestId,
              method: request.method,
              path: requestUrl.pathname,
              query: Object.fromEntries(requestUrl.searchParams.entries()),
              durationMs: Date.now() - startedAt,
              statusCode,
              request: request.method === "PUT" ? summarizeProductionBatchPayload(payload) : null,
              response: {
                error: typeof jsonPayload?.error === "string" ? jsonPayload.error : null,
                details: jsonPayload?.details ?? null,
                orderCount: Array.isArray(jsonPayload?.orderItems) ? jsonPayload.orderItems.length : null,
                activeOrderItemId: jsonPayload?.activeOrderItemId ?? null,
              },
            });
          }
          sendJson(response, statusCode, jsonPayload);
        },
      };

      await handler(req, res);
    } catch (error) {
      if (requestUrl.pathname === "/api/production-batch") {
        void appendProductionBatchLog({
          at: new Date().toISOString(),
          requestId,
          method: request.method,
          path: requestUrl.pathname,
          query: Object.fromEntries(requestUrl.searchParams.entries()),
          durationMs: Date.now() - startedAt,
          statusCode: 500,
          request: request.method === "PUT" ? summarizeProductionBatchPayload(payload) : null,
          response: {
            error: error instanceof Error ? error.message : "Unable to process production batch request.",
            stack: error instanceof Error ? error.stack : null,
          },
        });
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unable to process production batch request.",
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/preset-snapshot") {
    const workspaceKey = requestUrl.searchParams.get("workspaceKey") || "primary";

    if (request.method === "GET") {
      const snapshot = presetSnapshots.get(workspaceKey);
      if (!snapshot) {
        sendJson(response, 404, { error: "Preset snapshot not found." });
        return;
      }

      sendJson(response, 200, { workspaceKey, snapshot });
      return;
    }

    if (request.method === "PUT") {
      readRequestBody(request).then((body) => {
        let payload = null;

        try {
          payload = JSON.parse(body);
        } catch {
          sendJson(response, 400, { error: "Preset snapshot payload must be valid JSON." });
          return;
        }

        if (
          !payload
          || typeof payload !== "object"
          || typeof payload.workspaceKey !== "string"
          || !payload.snapshot
          || typeof payload.snapshot !== "object"
        ) {
          sendJson(response, 400, { error: "Preset snapshot payload must include a workspaceKey and snapshot." });
          return;
        }

        presetSnapshots.set(payload.workspaceKey, payload.snapshot);
        sendJson(response, 200, {
          workspaceKey: payload.workspaceKey,
          snapshot: payload.snapshot,
        });
      });
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (
    request.method === "POST"
    && (request.url === "/api/export-svg" || request.url === "/api/layout-analyze")
  ) {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const isAnalyzeRequest = request.url === "/api/layout-analyze";
      runGeometryScript(body, {
        onSuccess: (stdout) => {
          const headers = isAnalyzeRequest
            ? { "Content-Type": "application/json; charset=utf-8" }
            : {
                "Content-Type": "image/svg+xml; charset=utf-8",
                "Content-Disposition": "attachment; filename=\"badge-reel-layout.svg\"",
              };

          response.writeHead(200, headers);
          response.end(stdout);
        },
        onError: (message) => {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(message);
        },
      });
    });
    return;
  }

  if (requestUrl.pathname === "/api/presets" && (request.method === "POST" || request.method === "PUT")) {
    readRequestBody(request).then(async (body) => {
      let payload = {};

      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        sendJson(response, 400, { error: "Preset payload must be valid JSON." });
        return;
      }

      try {
        const { default: handler } = await import("../api/presets.js");
        const req = { method: request.method, body: payload };
        const res = {
          status(code) {
            this.statusCode = code;
            return this;
          },
          setHeader(name, value) {
            response.setHeader(name, value);
          },
          json(payload) {
            sendJson(response, this.statusCode || 200, payload);
          },
        };
        await handler(req, res);
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to save preset." });
      }
    });
    return;
  }

  const filePath = resolvePath(request.url || "/");

  if (!filePath || !existsSync(filePath)) {
    const notFoundPath = join(root, "404.html");
    if (existsSync(notFoundPath)) {
      response.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      createReadStream(notFoundPath).pipe(response);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Page not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, async () => {
  try {
    const startedAt = new Date().toISOString();
    const currentState = readDevServerState({ cwd: root }) || {};
    mergeDevServerState({
      worktreeRoot: root,
      port,
      pid: process.pid,
      startedAt,
      ports: {
        ...(currentState.ports && typeof currentState.ports === "object" ? currentState.ports : {}),
        [serverRole]: port,
      },
      servers: {
        ...(currentState.servers && typeof currentState.servers === "object" ? currentState.servers : {}),
        [serverRole]: {
          worktreeRoot: root,
          port,
          pid: process.pid,
          startedAt,
        },
      },
    }, { cwd: root });
    presetSnapshots.set("primary", await loadBundledPresetSnapshot());
    console.log(`Badge reel layout tool: http://localhost:${port}`);
    for (const line of formatLocalServerInfo(buildLocalServerInfo())) {
      console.log(line);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    server.close();
  }
});

function shutdown() {
  clearDevServerPid({ cwd: root, role: serverRole });
}

process.once("exit", shutdown);
process.once("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
