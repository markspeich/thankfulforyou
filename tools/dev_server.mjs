import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
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
  ".otf": "font/otf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
};

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

  return normalized;
}

const server = createServer((request, response) => {
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

server.listen(port, () => {
  console.log(`Badge reel layout tool: http://localhost:${port}`);
});
