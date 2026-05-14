import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
};

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
  if (request.method === "POST" && request.url === "/api/export-svg") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const python = spawn("python", ["tools/export_svg.py"], { cwd: root });
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
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end(stderr || "SVG export failed");
          return;
        }

        response.writeHead(200, {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"badge-reel-layout.svg\"",
        });
        response.end(stdout);
      });
      python.stdin.end(body);
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
