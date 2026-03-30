import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer, request as httpRequest } from "node:http";

const host = "127.0.0.1";
const port = 4173;
const root = process.cwd();
const localApiHost = "127.0.0.1";
const localApiPort = 8787;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function proxyApi(request, response, url) {
  const upstream = httpRequest(
    {
      hostname: localApiHost,
      port: localApiPort,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: {
        ...request.headers,
        host: `${localApiHost}:${localApiPort}`,
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }
  );

  upstream.on("error", () => {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        error:
          "Nie mozna polaczyc z lokalnym API na http://127.0.0.1:8787. Uruchom worker albo ustaw apiBase w assets/js/config.js.",
      })
    );
  });

  request.pipe(upstream);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    proxyApi(request, response, url);
    return;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 Not Found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Podglad lokalny: http://${host}:${port}`);
});
