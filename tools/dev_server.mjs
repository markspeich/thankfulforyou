import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { buildPublicAppConfigScript } from "./app_config.mjs";
import { resolveDevPort } from "./dev_port.mjs";
import { loadEnvFile } from "./env_file.mjs";

const port = resolveDevPort();
const root = process.cwd();
loadEnvFile({ cwd: root });
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
const queueSnapshots = new Map();
const presetSnapshots = new Map();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
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

  if (requestUrl.pathname === "/api/shared-session" || requestUrl.pathname === "/api/shared-queue") {
    const bodyText = request.method === "PUT" ? await readRequestBody(request) : "";
    let payload = undefined;

    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        sendJson(response, 400, { error: "Shared queue payload must be valid JSON." });
        return;
      }
    }

    try {
      const modulePath = requestUrl.pathname === "/api/shared-session"
        ? "../api/shared-session.js"
        : "../api/shared-queue.js";
      const { default: handler } = await import(modulePath);
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
          sendJson(response, this.statusCode || 200, jsonPayload);
        },
      };

      await handler(req, res);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unable to process shared queue request.",
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/queue-snapshot") {
    const workspaceKey = requestUrl.searchParams.get("workspaceKey") || "primary";

    if (request.method === "GET") {
      const snapshot = queueSnapshots.get(workspaceKey);
      if (!snapshot) {
        sendJson(response, 404, { error: "Queue snapshot not found." });
        return;
      }

      sendJson(response, 200, { workspaceKey, snapshot });
      return;
    }

    if (request.method === "DELETE") {
      queueSnapshots.delete(workspaceKey);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "PUT") {
      readRequestBody(request).then((body) => {
        let payload = null;

        try {
          payload = JSON.parse(body);
        } catch {
          sendJson(response, 400, { error: "Queue snapshot payload must be valid JSON." });
          return;
        }

        if (!payload || typeof payload !== "object" || typeof payload.workspaceKey !== "string") {
          sendJson(response, 400, { error: "Queue snapshot payload must include a workspaceKey." });
          return;
        }

        queueSnapshots.set(payload.workspaceKey, payload.snapshot ?? null);
        sendJson(response, 200, {
          workspaceKey: payload.workspaceKey,
          snapshot: payload.snapshot ?? null,
        });
      });
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
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
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, async () => {
  try {
    presetSnapshots.set("primary", await loadBundledPresetSnapshot());
    console.log(`Badge reel layout tool: http://localhost:${port}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    server.close();
  }
});
