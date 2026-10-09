import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A static server for the e2e tests and visual review. `astro preview` does not support the Vercel
 * adapter, so this serves the build output the way Vercel would: clean URLs, the headers from
 * vercel.json (the Content-Security-Policy included, so a violation fails a test), Range requests
 * for audio, and 404.html for unknown paths. The API routes are functions and are not served here;
 * they are covered by unit tests with injected fetch.
 *
 * Usage: node e2e/staticServer.mjs [directory] [port]
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

function loadHeaderRules() {
  const config = JSON.parse(readFileSync(join(HERE, "..", "vercel.json"), "utf8"));
  return (config.headers ?? []).map((rule) => ({
    // vercel.json sources use "(.*)" as a wildcard. Swap it out first so its own dot is not escaped.
    pattern: new RegExp(
      `^${rule.source.replaceAll("(.*)", "*").replaceAll(".", "\\.").replaceAll("*", ".*")}$`,
    ),
    headers: rule.headers,
  }));
}

export function startServer({ root, port }) {
  const rules = loadHeaderRules();

  function headersFor(pathname) {
    const headers = {};
    for (const rule of rules) {
      if (!rule.pattern.test(pathname)) continue;
      for (const { key, value } of rule.headers) headers[key] = value;
    }
    return headers;
  }

  function resolveFile(pathname) {
    const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    const target = join(root, clean);
    if (!target.startsWith(root)) return null;
    for (const candidate of [target, join(target, "index.html"), `${target}.html`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function send(request, response, file, status) {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const stats = statSync(file);
    const headers = {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      ...headersFor(pathname),
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range && status === 200) {
      const start = range[1] === "" ? Math.max(0, stats.size - Number(range[2])) : Number(range[1]);
      const end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : stats.size - 1;
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Length": end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(status, { ...headers, "Content-Length": stats.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  }

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/api/models" && request.method === "GET") {
      // A small fixed list, so the Model page renders in tests without a Nebius key.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          provider: "nebius",
          models: [
            { id: "deepseek-ai/DeepSeek-V3.2", context_length: 163840 },
            { id: "meta-llama/Llama-3.3-70B-Instruct", context_length: 131072 },
            { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 262144 },
          ],
        }),
      );
      return;
    }
    if (pathname.startsWith("/api/")) {
      response.writeHead(501, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not served by the static test server" }));
      return;
    }
    const file = resolveFile(pathname);
    if (file) {
      send(request, response, file, 200);
      return;
    }
    const notFound = join(root, "404.html");
    if (existsSync(notFound)) send(request, response, notFound, 404);
    else {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${root} at http://127.0.0.1:${port}`);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(HERE, "..", "dist"));
  const port = Number(process.argv[3] ?? process.env.PORT ?? 4321);
  if (!existsSync(root)) {
    console.error(`No build output at ${root}. Run the build first.`);
    process.exit(1);
  }
  startServer({ root, port });
}
